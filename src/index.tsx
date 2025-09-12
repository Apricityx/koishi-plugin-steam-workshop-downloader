import {Context, Schema, h} from 'koishi'
import {pathToFileURL} from 'url'
import {init_server} from "./file_server";
import path from 'node:path'
import {steamDownload} from "./steam-controller";
import {WorkshopFileResponse} from "./steam_info_types";
import {promises as fs} from 'node:fs'
import fsy from 'node:fs'
import {zipDirectory} from "./utils";
import {descriptionHtml} from "./docs/desc";

export const name = 'steam-workshop-downloader'
export const usage = descriptionHtml

export interface Config {
  debug: boolean
  download_server: string
  download_port: number
  enable_proxy: boolean
  proxy_address: string
  include_download_address: boolean
  enable_no_public: boolean
  file_directory: string
}

let ctx_: Context
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    debug: Schema.boolean().description('是否启动调试模式').default(false),
  }).description('基础配置'),

  Schema.object({
    include_download_address: Schema.boolean().description('是否发送下载链接').default(false),
    download_server: Schema.string().description('koishi的公网地址').default('http://your_server.com'),
    download_port: Schema.number().description('koishi的端口').default(5140),
  }).description('下载服务器配置'),

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
    enable_no_public: Schema.boolean().description('是否启用无公网文件传输').default(false),
  }).description('无公网文件传输设置'),

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
export const inject = ['server'] as const

// ================= 主逻辑 =================
// 如果要使用代理，必须在Proxy-Agent和配置中都设置
export let proxy_address = ''

export async function apply(ctx: Context, config: Config) {
  proxy_address = config.proxy_address
  ctx_ = ctx
  const steamcmdPath = path.resolve(ctx.baseDir, 'node_modules', 'koishi-plugin-steam-workshop-downloader', 'lib', 'steamcmd-linux', 'linux32', 'steamcmd')
  const logger = ctx.logger(name)
  init_server(ctx)
  ctx.middleware(async (session, next) => {
    if ((session.content.split('https://steamcommunity.com/sharedfiles/filedetails/?id=')).length !== 2) return
    let contentId = session.content.split('https://steamcommunity.com/sharedfiles/filedetails/?id=')[1]
    if (contentId.includes('&')) {
      contentId = contentId.split('&')[0]
    }
    if (contentId.length === 0 || isNaN(Number(contentId))) return
    const info: WorkshopFileResponse = await get_workshop_info(contentId)
    const title = info.response.publishedfiledetails[0].title
    let description = info.response.publishedfiledetails[0].description
    const pic_url = info.response.publishedfiledetails[0].preview_url
    const file_size = info.response.publishedfiledetails[0].file_size
    const file_size_mb = (parseInt(file_size) / 1024 / 1024).toFixed(2)
    if (description.length > 200) {
      description = description.substring(0, 200) + '...'
    }
    await session.send([h.quote(session.messageId), h.img(pic_url), h.text("【模组名称】" + title), h.text('\n\n【模组简介】' + description), h.text(`\n\n【文件大小】${file_size_mb}mb`), h.text("\n\n正在获取该模组，请稍候...")])
    const gameId = String(info.response.publishedfiledetails[0].creator_app_id)
    const contentName = info.response.publishedfiledetails[0].title
    const downloadServer = config.download_server
    const downloadPort = config.download_port
    logger.info(`用户 ${session.userId} 下载了 ${contentId}，游戏ID为 ${gameId}，下载链接：${downloadServer}:${downloadPort}/files/${gameId}/${contentId}/`)
    const download_base_link = `${downloadServer}:${downloadPort}/files/${gameId}/${contentId}/`
    const file_path = path.resolve(ctx.baseDir, 'data', 'steam-workshop-downloader', 'steamapps', 'workshop', 'content', gameId, contentId)
    // 如果文件夹不存在则创建
    if (!fsy.existsSync(file_path)) {
      // 递归创建目录，即使父目录也不存在
      fsy.mkdirSync(file_path, {recursive: true});
      logger.info(`目录 ${file_path} 创建成功！`);
    }
    let entries = await fs.readdir(file_path)
    const retry_limit = 3; // 最大重试次数
    let retryTime = 0; // 最大重试次数
    while (entries.length === 0) {
      if (retryTime >= retry_limit) {
        await session.send([h.quote(session.messageId), h.text('下载失败，请稍后再试')])
        return
      }
      try {
        if (retryTime !== 0) {
          await session.send([h.quote(session.messageId), h.text(`下载时出现问题，可能是steamcmd有更新，正在重试 (${retryTime} / ${retry_limit})`)])
        }
        retryTime += 1
        await steamDownload(steamcmdPath, gameId, contentId, ctx)
        entries = await fs.readdir(file_path)
      } catch (e) {
        await session.send([h.quote(session.messageId), h.text('下载时出现问题：' + e.message),])
        return
      }
    }
    const file_directory = config.file_directory || ''
    const file_bot_path = path.resolve(file_directory, 'data', 'steam-workshop-downloader', 'steamapps', 'workshop', 'content', gameId, contentId)
    // 如果文件大于2则先压缩后发送
    if (entries.length >= 2
    ) {
      const zip_path = path.resolve(ctx.baseDir, 'data', 'steam-workshop-downloader', 'steamapps', 'workshop', 'content', gameId, 'zip', `${contentName}.zip`)
      const base_dir = path.resolve(ctx.baseDir, 'data', 'steam-workshop-downloader', 'steamapps', 'workshop', 'content', gameId, contentId)
      await zipDirectory(base_dir, zip_path)
      const download_link = (download_base_link + path.basename(`${contentName}.zip`)).replace(contentId, 'zip')
      logger.info(download_link)
      session.send([h.quote(session.messageId), h.text(`下载完成，上传中\n\n因为文件数量较多，将压缩为zip文件发送${config.include_download_address ? `\n\n如果长时间未发送文件，请将此链接复制到浏览器中进行下载\n\n${download_link}` : ``}`)])
      if (config.enable_no_public) {
        await session.send([h.file(pathToFileURL(path.resolve(file_bot_path.replace(contentId, 'zip'), `${contentName}.zip`)).href)])
      } else {
        await session.send(<file src={download_link} title={`${contentName}.zip`}/>)
      }
    } else {
      const download_link = download_base_link + path.basename(entries[0])
      console.log(download_base_link, download_link)
      session.send([h.quote(session.messageId), h.text(`下载完成，上传中 ${config.include_download_address ? `\n\n如果长时间未发送文件，请将此链接复制到浏览器中进行下载\n\n${download_link}` : ``}`)])
      const file_name = path.basename(entries[0])
      if (config.enable_no_public) {
        await session.send([h.file(pathToFileURL(path.resolve(file_bot_path, file_name)).href)])
      } else {
        await session.send(<file src={download_link} title={file_name}/>)
      }
    }
  })
}

const get_workshop_info = async (contentId: string): Promise<WorkshopFileResponse> => {
  const form = new URLSearchParams()
  form.set("itemcount", "1")
  form.set("publishedfileids[0]", contentId)
  return await ctx_.http.post<WorkshopFileResponse>(
    'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
    form.toString(),
    {
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    }
  )
}
