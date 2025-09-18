import {Context, h, Schema} from 'koishi'
import {init_server} from "./file_server";
import {QueryFilesResp, WorkshopFileResponse} from "./types/steam_info_types";
import {descriptionHtml} from "./docs/desc";
import archiver from 'archiver'
import zipEncrypted from 'archiver-zip-encrypted'  // 新增：加密插件
import {renderCardListPage} from "./search/renderCardListPage";
import {renderHtmlToImage} from "./search/renderHtmlToImage";
import {download_file_and_send} from "./download/download";
import {Time} from 'koishi'
import path from "node:path";
import {steamLogin, steamLogout} from "./utils/steam_controller";

export const name = 'steam-workshop-downloader'
export const usage = descriptionHtml
// 注册 zip-encrypted 格式（只需注册一次）
try {
  archiver.registerFormat('zip-encrypted', zipEncrypted)
} catch (e) {
  // do nothing
}

export interface Config {
  debug: boolean
  download_server: string
  download_port: number
  enable_proxy: boolean
  proxy_address: string
  include_download_address: boolean
  enable_no_public: boolean
  file_directory: string
  steam_api_key: string
  steam_account_name: string
  default_game_id: number
}

let ctx_: Context
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    debug: Schema.boolean().description('是否启动调试模式').default(false),
    steam_account_name: Schema.string().description('steam账号名称，请使用指令"登录steam"来登录steamcmd')
  }).description('基础配置'),

  Schema.object({
    include_download_address: Schema.boolean().description('是否发送下载链接').default(false),
    download_server: Schema.string().description('koishi的地址').default('http://your_server.com'),
    download_port: Schema.number().description('koishi的端口').default(5140),
  }).description('下载服务器配置'),

  Schema.object({
    steam_api_key: Schema.string().description('Steam API Key，可以在 https://steamcommunity.com/dev/apikey 申请'),
    default_game_id: Schema.number().description('当搜索时不提供GameID默认用于搜索时指定游戏（例如杀戮尖塔的ID为646570）').default(646570),
  }).description("创意工坊搜索设置"),

  Schema.object({
    enable_proxy: Schema.boolean().description('是否启用代理').default(false),
  }).description('代理设置'),

  Schema.union([
    Schema.object({
      enable_proxy: Schema.const(true).required(),
      proxy_address: Schema.string().description('代理地址').default('http://127.0.0.1:7897'),
    }),
    Schema.object({}) as any,
  ]) as any,

  Schema.object({
    enable_no_public: Schema.boolean().description('是否启用本地文件传输模式').default(false),
  }).description('本地文件传输模式'),

  Schema.union([
    Schema.object({
      enable_no_public: Schema.const(true).required(),
      file_directory: Schema.string().description('bot端可以访问到的baseDir文件地址（即为koishi.yml所在目录）').default('/app/koishi'),
    }),
    Schema.object({}) as any,
  ]) as any,

]) as any

declare module 'koishi' {
  interface Context {
    // 使用插件导出的类型（如果需要）
    server: import('@koishijs/plugin-server').Server
  }
}
export const inject = {
  required: ['server'],
  optional: ['puppeteer'], // 如果要使用搜索功能则需要puppeteer
}

// ================= 主逻辑 =================
// 如果要使用代理，必须在Proxy-Agent和配置中都设置
export let proxy_address = ''

export async function apply(ctx: Context, config: Config) {


  const logger = ctx.logger(name)
  if (!config.steam_api_key) {
    logger.warn("steam api key未设置，可能会导致无法获取mod信息，请前往 https://steamcommunity.com/dev/apikey 申请")
  }
  proxy_address = config.proxy_address
  ctx_ = ctx

  init_server(ctx)
  ctx.middleware(async (session, next) => {
    await download_file_and_send(session, session.content, ctx, config)
  })

  ctx.command('创意工坊搜索 <search_content> [page] [game_id]')
    .action(async (_, search_content, page, game_id) => {

        logger.info("用户 " + _.session.userId + " 搜索了 " + search_content + " 页码：" + (page || '1') + " 游戏ID：" + (game_id || config.default_game_id))

        if (!ctx_.puppeteer) return "未安装puppeteer，无法使用搜索功能"
        if (!config.steam_api_key) return "未设置steam api key，无法使用搜索功能"
        if (page === undefined) page = '1'
        if (!search_content) return "指令用法：创意工坊搜索 [搜索内容] (页码) (游戏id)\n[]为必填，()为选填"
        if (game_id === undefined) {
          game_id = String(config.default_game_id)
        }
        const data = await search_workshop(search_content, config.steam_api_key, parseInt(game_id), parseInt(page), 5)
        let rendered_html: string
        try {
          rendered_html = renderCardListPage(data?.publishedfiledetails || [])
        } catch (e) {
          logger.warn('puppeteer渲染HTML失败', e)
          return "渲染图片失败，服务器网络可能无法访问steam网络，请稍候再试"
        }
        const binary_cards = await renderHtmlToImage(ctx, rendered_html, {height: 100})
        let download_prompt = '\n30s内发送模组编号可以直接下载模组\n若模组已下载但长时间没有发送，请在编号后带-nsfw参数，例如"1 -nsfw"\n[0] 不执行下载操作'
        let index = 0
        for (const item of data.publishedfiledetails || []) {
          index++
          download_prompt += `\n[${index}] ${item.title}`
        }
        await _.session.send([h.quote(_.session.messageId), h.image(binary_cards, 'image/png'), h.text(`【页码 （${parseInt(page) || 0} / ${Math.ceil(data.total / 5)}） 发送"下一页"来翻页】\n可以使用创意工坊搜索 [搜索内容] [页码] 来查看其他页面${download_prompt}`)])
        let id = await _.session.prompt(30 * Time.second)
        if (!id) {
          return
        }
        let nsfw = false
        if (id.includes('-nsfw')) {
          nsfw = true
          id = id.replace('-nsfw', '')
          id = id.trim()
        }

        // 如果用户输入下一页则翻页
        if (id === '下一页') {
          await _.session.execute(`创意工坊搜索 ${search_content} ${parseInt(page) + 1} ${game_id}`)
          return
        }

        // 如果id在0-5之间则下载对应的mod
        const id_num = parseInt(id)
        if (isNaN(id_num) || id_num < 0 || id_num > (data.publishedfiledetails?.length || 0)) {
          // 如果用户输入不为数字则尝试作为命令执行
          const text = id;
          await (async () => {
            try {
              // session.execute 会按当前会话解析并尝试执行命令
              // 若确实匹配到命令，它会把执行结果返回（string/segment/void 皆有可能）
              const result = await _.session.execute(text)
              return result !== undefined
            } catch {
              // 不是有效命令或执行失败，就当没匹配到
              return false
            }
          })()
          return
          // return [h.quote(_.session.messageId), h.text("输入有误，已取消下载")]
        }
        if (id_num === 0) return [h.quote(_.session.messageId), h.text("已取消下载")]
        console.log('https://steamcommunity.com/sharedfiles/filedetails/?id=' + data.publishedfiledetails![id_num - 1].publishedfileid + (nsfw ? ' nsfw' : ''))
        await download_file_and_send(_.session, 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + data.publishedfiledetails![id_num - 1].publishedfileid + (nsfw ? ' nsfw' : ''), ctx, config)
        return
      }
    )

  ctx.command('登录steam')
    .action(async (_, search_content, page, game_id) => {
      await _.session.send([h.quote(_.session.messageId), h.text("警告⚠️ 进行此操作时请在控制台或者在私聊中进行，避免账号信息泄露\n在确认当前聊天安全的情况下，发送confirm开始登录")])
      const user_confirmation = await _.session.prompt(30 * Time.second)
      if (user_confirmation !== 'confirm') {
        return [h.quote(_.session.messageId), h.text("已取消登录")]
      }
      const account_name = config.steam_account_name
      if (!account_name || account_name.trim().length === 0) {
        return [h.quote(_.session.messageId), h.text("steam账号名称未设置，请前往插件配置中设置")]
      }
      await _.session.send([h.quote(_.session.messageId), h.text(`即将进行账户${config.steam_account_name}\n请在120s内输入steam账号密码`)])
      const password = await _.session.prompt(120 * Time.second)
      await _.session.send([h.quote(_.session.messageId), h.text(`请等待steam guard手机令牌转一圈后输入令牌`)])
      const steam_guard_code = await _.session.prompt(120 * Time.second)
      await _.session.send([h.quote(_.session.messageId), h.text(`正在登录steam，请稍候`)])
      try {
        const steamcmdPath = path.resolve(ctx.baseDir, 'node_modules', 'koishi-plugin-steam-workshop-downloader', 'lib', 'steamcmd-linux', 'linux32', 'steamcmd')
        const result = await steamLogin(steamcmdPath, account_name, password, steam_guard_code, ctx)
        let text: string
        switch (result) {
          case 0:
            text = "登录成功，可以开始下载需要登录的mod了"
            break
          case 5:
            text = "登录失败，错误的密码或steam guard代码，如果令牌刷新了才完成登录过程请等待令牌转一圈后再尝试登录"
            logger.error(text)
            break
          case 42:
            text = "登录失败，steamcmd更新了，请重新登录"
            logger.error(text)
            break
          default:
            text = "登录失败，未知错误，请查看控制台日志并联系开发者"
            logger.error(text)
            break
        }
        return [h.quote(_.session.messageId), h.text(text)]
      } catch (e) {
        logger.error("登陆失败", e)
        await _.session.send([h.quote(_.session.messageId), h.text(`登录失败，请查看控制台日志并联系开发者`)])
      }
    })

  ctx.command('登出steam')
    .action(async (_) => {
      const steamcmdPath = path.resolve(ctx.baseDir, 'node_modules', 'koishi-plugin-steam-workshop-downloader', 'lib', 'steamcmd-linux', 'linux32', 'steamcmd')
      await _.session.send("是否确认登出steam? (y/N)")
      const confirmation = await _.session.prompt(30 * Time.second)
      if (confirmation?.toLowerCase() !== 'y') {
        return [h.quote(_.session.messageId), h.text("已取消登出")]
      } else {
        await steamLogout(steamcmdPath, ctx)
        return [h.quote(_.session.messageId), h.text("已登出steam")]
      }
    })
}

const search_workshop = async (
  query: string,
  steam_api_key: string,
  gameId: number = ctx_.config.default_game_id,
  page = 1,
  numPerPage = 5,
) => {
  const params = new URLSearchParams()
  params.set('key', steam_api_key)
  params.set('appid', String(gameId))
  params.set('search_text', query)
  params.set('page', String(page))
  params.set('numperpage', String(numPerPage))
  params.set('return_tags', 'true')
  params.set('return_vote_data', 'true')
  params.set('return_details', 'true')

  const url = `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?${params.toString()}`
  // ctx_.logger('steam-workshop-downloader').info('搜索创意工坊，url：' + params.toString())
  const data = await ctx_.http.get<QueryFilesResp>(url, {
    headers: {Accept: 'application/json'},
  })
  return data.response
}
