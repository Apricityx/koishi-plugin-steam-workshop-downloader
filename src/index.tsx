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
import fs from "node:fs";
import {steamLogin, steamLogout} from "./utils/steam_controller";
import { getPluginLogger } from "./utils/plugin_logger";

export const name = 'steam-workshop-downloader'
export const usage = descriptionHtml
// 注册 zip-encrypted 格式（只需注册一次）
try {
  archiver.registerFormat('zip-encrypted', zipEncrypted)
} catch (e) {
  // do nothing
}
// 注册黑名单数据库
declare module 'koishi' {
  interface Tables {
    blackList: BackList
  }
}

export interface BackList {
  id: number
}

export interface Config {
  debug: boolean
  download_server: string
  download_port: number
  enable_download_server: boolean
  enable_proxy: boolean
  proxy_address: string
  include_download_address: boolean
  append_workshop_link_in_progress_message: boolean
  force_anonymous_download: boolean
  enable_no_public: boolean
  file_directory: string
  steam_api_key: string
  steam_account_name: string
  default_game_id: number
  download_size_limit: number
}

let ctx_: Context
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    debug: Schema.boolean().description('是否启动调试模式').default(false),
    steam_account_name: Schema.string().description('steam账号名称，请使用指令"登录steam"来登录steamcmd'),
    download_size_limit: Schema.number().default(1024).description("下载大小限制，单位MB"),
    append_workshop_link_in_progress_message: Schema.boolean().description('在“正在下载”提示末尾附上创意工坊链接').default(false),
    force_anonymous_download: Schema.boolean().description('是否强制使用匿名账号（anonymous）下载（开启后不会使用已登录账号，也不会提示登录失效）').default(false),
  }).description('基础配置'),

  Schema.object({
  }).description('群文件清理设置'),

  Schema.object({
    enable_download_server: Schema.boolean().description('是否启用下载服务器（HTTP 文件服务）').default(true),
  }).description('下载服务器设置'),

  Schema.union([
    Schema.object({
      enable_download_server: Schema.const(true).required(),
      include_download_address: Schema.boolean().description('是否发送下载链接').default(false),
      download_server: Schema.string().description('koishi的地址').default('http://your_server.com'),
      download_port: Schema.number().description('koishi的端口').default(5140),
    }),
    Schema.object({
      enable_download_server: Schema.const(false).required(),
    }),
  ]) as any,

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
  required: ['database'],
  optional: ['server', 'puppeteer'], // 如果要使用搜索功能则需要puppeteer
}

// ================= 主逻辑 =================
// 如果要使用代理，必须在Proxy-Agent和配置中都设置
export let proxy_address = ''

export async function apply(ctx: Context, config: Config) {


  const logger = getPluginLogger(ctx, config.debug, name)
  if (!config.steam_api_key) {
    logger.warn("steam api key未设置，可能会导致无法获取mod信息，请前往 https://steamcommunity.com/dev/apikey 申请")
  }
  proxy_address = config.proxy_address
  ctx_ = ctx


  if (config.enable_download_server) {
    if (ctx.server) {
      init_server(ctx, config.debug)
    } else {
      logger.warn('已启用下载服务器，但未安装/启用 @koishijs/plugin-server，下载服务器功能不可用。')
    }
  }

const resolveSteamcmdPath = () => {
  // 优先使用本插件 lib 目录下自带的 steamcmd（更不受 pnpm / workspace 影响）
  const pluginLibDir = (typeof __dirname !== 'undefined') ? __dirname : ctx.baseDir
  const candidates = [
    path.resolve(pluginLibDir, 'steamcmd-linux', 'linux32', 'steamcmd'),
    path.resolve(ctx.baseDir, 'node_modules', 'koishi-plugin-steam-workshop-downloader', 'lib', 'steamcmd-linux', 'linux32', 'steamcmd'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  return candidates[0]
}
  ctx.middleware(async (session, next) => {
    try {
      const handled = await download_file_and_send(session, session.content, ctx, config)
      if (!handled) return next()
    } catch (err: any) {
      logger.error('自动下载处理中间件异常：' + String(err?.message ?? err))
      return next()
    }
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
const binary_cards = await renderHtmlToImage(ctx, rendered_html, { height: 100 }, logger)

// 记录并可撤回本次搜索提示消息，避免超时/取消后刷屏
const searchMsgIds: string[] = []
const trackIds = (ids: any) => {
  if (!ids) return
  if (Array.isArray(ids)) {
    for (const id of ids) if (id) searchMsgIds.push(String(id))
  } else {
    searchMsgIds.push(String(ids))
  }
}
const retractSearchMsgs = async () => {
  const unique = Array.from(new Set(searchMsgIds)).reverse()
  for (const id of unique) {
    try {
      await _.session.bot.deleteMessage(_.session.channelId, id)
    } catch {
      // ignore
    }
  }
}

let download_prompt = '\n30s内发送模组编号可以直接下载模组\n若模组已下载但长时间没有发送，请在编号后带-nsfw参数，例如"1 -nsfw"\n[0] 不执行下载操作'
let index = 0
for (const item of data.publishedfiledetails || []) {
  index++
  download_prompt += `\n[${index}] ${item.title}`
}

const ids = await _.session.send([
  h.quote(_.session.messageId),
  h.image(binary_cards, 'image/webp'),
  h.text(`【页码 （${parseInt(page) || 1} / ${Math.ceil(data.total / 5)}） 发送"下一页"来翻页】\n可以使用创意工坊搜索 [搜索内容] [页码] 来查看其他页面${download_prompt}`),
])
trackIds(ids)

let id = await _.session.prompt(90 * Time.second)
if (!id) {
  await retractSearchMsgs()
  await _.session.send([h.quote(_.session.messageId), h.text("输入超时，已结束搜索交互 "), h.at(_.session.userId)])
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
  await retractSearchMsgs()
  await _.session.execute(`创意工坊搜索 ${search_content} ${parseInt(page) + 1} ${game_id}`)
  return
}

// 如果id在0-5之间则下载对应的mod
const id_num = parseInt(id)
if (isNaN(id_num) || id_num < 0 || id_num > (data.publishedfiledetails?.length || 0)) {
  await retractSearchMsgs()

  // 如果用户输入不为数字则尝试作为命令执行
  const text = id
  await (async () => {
    try {
      const result = await _.session.execute(text)
      return result !== undefined
    } catch {
      return false
    }
  })()

  await _.session.send([h.quote(_.session.messageId), h.text("输入其他内容，已结束搜索交互 "), h.at(_.session.userId)])
  return
}

if (id_num === 0) {
  await retractSearchMsgs()
  await _.session.send([h.quote(_.session.messageId), h.text("已取消下载 "), h.at(_.session.userId)])
  return
}

await retractSearchMsgs()
logger.debug('https://steamcommunity.com/sharedfiles/filedetails/?id=' + data.publishedfiledetails![id_num - 1].publishedfileid + (nsfw ? ' nsfw' : ''))
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
        const steamcmdPath = resolveSteamcmdPath()
        const result = await steamLogin(steamcmdPath, account_name, password, steam_guard_code, ctx, config.debug)
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
      const steamcmdPath = resolveSteamcmdPath()
      await _.session.send("是否确认登出steam? (y/N)")
      const confirmation = await _.session.prompt(30 * Time.second)
      if (confirmation?.toLowerCase() !== 'y') {
        return [h.quote(_.session.messageId), h.text("已取消登出")]
      } else {
        await steamLogout(steamcmdPath, ctx, config.debug)
        return [h.quote(_.session.messageId), h.text("已登出steam")]
      }
    })
  /**
   * 黑名单
   */


// 这里是新增表的接口类型


  ctx.model.extend('blackList', {
    // 各字段的类型声明
    id: 'unsigned',
  })

  ctx.command('创意工坊黑名单添加 <id>')
    .action(async (_, id) => {
      // 约束id必须为数字
      logger.info(id)
      if (id === undefined || isNaN(Number(id)) || id === '') {
        return h.text('指令用法：创意工坊黑名单添加 [mod id]')
      }
      try {
        await ctx.database.create('blackList', { id: Number(id) })
      } catch (err: any) {
        const msg = String(err?.message ?? err)
        if (msg.startsWith('UNIQUE constraint failed:')) {
          return h.text('该mod已在黑名单中，无需重复添加')
        }
        return h.text('添加黑名单失败，发生错误：' + msg)
      }
      return h.text(`已将mod ${id} 添加到黑名单，后续下载将被阻止`)
    })


  /**
   * 群文件管理（OneBot / go-cqhttp 扩展）
   * 注意：这是危险操作，默认需要 -f 才会执行
   */
    /**
   * 清空群文件（仅删除群根目录的文件，不删除任何文件夹）
   * - 默认需要 -f 才会执行（危险操作）
   * - 不会删除「发送指令后」新上传/修改的文件（通过 modify_time 判断）
   */
  ctx.command('清空群文件 [group_id]', '清空指定群的群文件根目录（仅支持 OneBot）', { authority: 4 })
    .option('force', '-f 直接执行（不再二次确认）')
    .action(async ({ session, options }, group_id) => {
      if (!session) return
      const logger = getPluginLogger(ctx, config.debug, 'steam-workshop-downloader')

      const onebot: any = (session as any).onebot
      if (!onebot) return '仅支持 OneBot 适配器。'

      const gid = String(group_id || session.guildId || '')
      if (!gid) return '请在群聊中使用此指令，或手动指定 group_id。'
      const gidParam: any = /^\d+$/.test(gid) ? Number(gid) : gid

      // 以“指令消息时间”为界：不删除发送指令之后的新文件
      const startTs = Math.floor(((session as any).timestamp ?? Date.now()) / 1000)

      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
      const LIST_FILE_COUNT = 9999

      const unwrapFile = (x: any) => x?.file_info ?? x?.fileInfo ?? x?.file ?? x
      const normalize = (resp: any) => {
        const data = resp?.data ?? resp
        const files = Array.isArray(data?.files) ? data.files : []
        const folders = Array.isArray(data?.folders) ? data.folders : []
        return { files, folders }
      }

      const getFileMeta = (file: any) => {
        const f = unwrapFile(file)
        const fileId = String(f?.file_id ?? f?.fileId ?? f?.id ?? '')
        const busid = f?.busid ?? f?.busId ?? f?.bus_id
        const name = String(f?.file_name ?? f?.fileName ?? f?.name ?? '')
        const modifyTime = Number(f?.modify_time ?? f?.modifyTime ?? f?.update_time ?? f?.updateTime ?? 0) || 0
        return { fileId, busid, name, modifyTime }
      }

      const toErrText = (e: any) => {
        if (!e) return 'unknown error'
        const msg = String(e?.message ?? e?.msg ?? e)
        const wording = e?.wording ? String(e.wording) : ''
        const retcode = e?.retcode ?? e?.code
        const extra = [
          (retcode !== undefined ? `retcode=${retcode}` : ''),
          (wording ? `wording=${wording}` : ''),
        ].filter(Boolean).join(' ')
        return extra ? `${msg} (${extra})` : msg
      }

      // 尝试找到一个“原始 action 请求”入口：rawRequest(action, params)
      // 注意：Typed wrapper（例如 getGroupRootFiles）可能不会把额外参数（如 file_count）转发到底层。
      // 因此这里会优先选择更“原始”的入口。
      const rawRequest: null | ((action: string, params: any) => Promise<any>) = (() => {
        const internal = (session.bot as any)?.internal
        const onebotAny = onebot as any

        // 1) 一些实现暴露 internal._get(action, params)
        if (internal && typeof internal._get === 'function') {
          return async (action: string, params: any) => await internal._get(action, params)
        }

        // 2) 兼容一些常见命名：_request / request / call
        if (typeof onebotAny?._request === 'function') {
          return async (action: string, params: any) => await onebotAny._request(action, params)
        }
        if (typeof onebotAny?.request === 'function') {
          return async (action: string, params: any) => await onebotAny.request(action, params)
        }
        if (internal && typeof internal._request === 'function') {
          return async (action: string, params: any) => await internal._request(action, params)
        }
        if (internal && typeof internal.request === 'function') {
          return async (action: string, params: any) => await internal.request(action, params)
        }
        if (internal && typeof internal.call === 'function') {
          return async (action: string, params: any) => await internal.call(action, params)
        }
        // 某些实现会把 action 直接作为 snake_case 方法暴露
        return null
      })()

      const listRoot = async () => {
        // **优先**走 raw action request：确保 file_count 会被转发（NapCat 支持 file_count 获取 >50 条）
        if (rawRequest) {
          try {
            return await rawRequest('get_group_root_files', { group_id: gidParam, file_count: LIST_FILE_COUNT })
          } catch (e) {
            logger.debug('[清空群文件] rawRequest(get_group_root_files) failed, fallback to typed wrappers: ' + toErrText(e))
          }
        }

        // fallback：一些 OneBot 实现仅提供 typed wrapper（可能会忽略 file_count，但至少还能工作）
        if (typeof onebot.getGroupRootFiles === 'function') {
          try { return await onebot.getGroupRootFiles({ group_id: gidParam, file_count: LIST_FILE_COUNT } as any) } catch {}
          try { return await onebot.getGroupRootFiles(gidParam, LIST_FILE_COUNT) } catch {}
          return await onebot.getGroupRootFiles(gidParam)
        }
        if (typeof onebot.get_group_root_files === 'function') {
          try { return await onebot.get_group_root_files({ group_id: gidParam, file_count: LIST_FILE_COUNT } as any) } catch {}
          try { return await onebot.get_group_root_files(gidParam, LIST_FILE_COUNT) } catch {}
          try { return await onebot.get_group_root_files(gidParam) } catch {}
          return await onebot.get_group_root_files({ group_id: gidParam } as any)
        }
        throw new Error('OneBot 实现不支持 get_group_root_files')
      }

      let resp: any
      try {
        resp = await listRoot()
      } catch (e: any) {
        logger.warn('[清空群文件] 获取群文件列表失败：' + toErrText(e))
        return [h.quote(session.messageId), h.text('获取群文件列表失败：' + toErrText(e))]
      }

      const { files, folders } = normalize(resp)

      // 只处理根目录文件，忽略文件夹
      const candidates: any[] = []
      for (const f of files) {
        const meta = getFileMeta(f)
        if (meta.fileId) candidates.push(f)
      }

      if (!options.force) {
        return [
          h.quote(session.messageId),
          h.text(`将清空群 ${gid} 的群文件根目录：预计删除 ${candidates.length} 个文件 \n这是不可逆操作。\n\n如确认执行，请发送：清空群文件 ${gid} -f`),
        ]
      }

      await session.send([h.quote(session.messageId), h.text(`开始清空群文件，预计清理文件 ${candidates.length} 个，不删除文件夹`)])
      logger.info(`[清空群文件] start group=${gid} rootFiles=${files.length} candidates=${candidates.length} folders=${folders.length} startTs=${startTs}`)

      let deletedFiles = 0
      let failed = 0
      const failDetails: string[] = []

      const deleteFile = async (file: any) => {
        const { fileId, busid, name } = getFileMeta(file)
        if (!fileId) return
        try {
          const params: any = { group_id: gidParam, file_id: fileId }
          if (busid !== undefined) params.busid = busid

          if (rawRequest) {
            logger.debug(`[清空群文件] rawRequest action=delete_group_file params=${JSON.stringify(params)}`)
            await rawRequest('delete_group_file', params)
          } else {
            const internal = (session.bot as any)?.internal
            if (internal && typeof internal.delete_group_file === 'function') {
              await internal.delete_group_file(params)
            } else if (typeof onebot?.delete_group_file === 'function') {
              await onebot.delete_group_file(params)
            } else if (typeof onebot?.request === 'function') {
              await onebot.request('delete_group_file', params)
            } else if (typeof onebot?.deleteGroupFile === 'function') {
              // 位置参数形式（尽量兼容 go-cqhttp 扩展）
              if (busid !== undefined) await onebot.deleteGroupFile(gidParam, fileId, busid)
              else await onebot.deleteGroupFile(gidParam, fileId)
            } else {
              throw new Error('No available OneBot delete_group_file API on current session/bot.')
            }
          }

          deletedFiles++
        } catch (e: any) {
          failed++
          const reason = toErrText(e)
          failDetails.push(`[文件] ${name || fileId}：${reason}`)
          logger.warn(`[清空群文件] delete file failed id=${fileId} busid=${busid ?? '-'} err=${reason}`)
        }
        // 适当降速以避免风控
        await sleep(200)
      }

      if (config.debug) {
        const names = candidates.slice(0, 200).map((x) => {
          const m = getFileMeta(x)
          return m.name || m.fileId
        }).filter(Boolean)
        logger.debug(`[清空群文件] candidates (shown ${names.length}/${candidates.length}): ${names.join(', ')}`)
      }

      for (const f of candidates) {
        await deleteFile(f)
      }

      const summary: string[] = []
      summary.push(`清空完成：已删除文件 ${deletedFiles} 个。`)
      if (failed) summary.push(`失败 ${failed} 次。`)
      if (failed && failDetails.length) {
        summary.push('')
        summary.push('失败原因（最多 5 条）：')
        for (const line of failDetails.slice(0, 5)) summary.push('- ' + line)
      }
      if (!failed) summary.push('无失败。')

      logger.info(`[清空群文件] done group=${gid} deletedFiles=${deletedFiles} failed=${failed}`)
      return [h.quote(session.messageId), h.text(summary.join('\n'))]
    })

}

const search_workshop = async (
  query: string,
  steam_api_key: string,
  gameId: number,
  page = 1,
  numPerPage = 5,
) => {
  const params = new URLSearchParams()
  params.set('key', steam_api_key)
  params.set('appid', String(gameId))
  params.set('search_text', query)
  params.set('page', String(page))
  params.set('numperpage', String(numPerPage))
  // params.set('return_tags', 'true')
  // params.set('return_vote_data', 'true')
  params.set('return_details', 'true')
  params.set('language', "6")

  const url = `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?${params.toString()}`
  // ctx_.logger('steam-workshop-downloader').info('搜索创意工坊，url：' + params.toString())
  const data = await ctx_.http.get<QueryFilesResp>(url, {
    headers: {Accept: 'application/json'},
  })
  return data.response
}
