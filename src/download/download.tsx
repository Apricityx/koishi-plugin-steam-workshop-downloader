import {WorkshopFileResponse} from "../types/steam_info_types";
import {Config} from "../index";
import {Context, h} from "koishi";
import {createZip} from "../utils/zip";
import {steamDownload} from "../utils/steam_controller";
import fsy, {promises as fs} from 'node:fs'
import {pathToFileURL} from 'node:url'
import path from 'node:path'

export const download_file_and_send = async (session, sessionContent: string, ctx: Context, config: Config) => {
  const steamcmdPath = path.resolve(ctx.baseDir, 'node_modules', 'koishi-plugin-steam-workshop-downloader', 'lib', 'steamcmd-linux', 'linux32', 'steamcmd')
  const logger = ctx.logger
  const get_workshop_info = async (contentId: string): Promise<WorkshopFileResponse> => {
    const form = new URLSearchParams()
    form.set("itemcount", "1")
    form.set("publishedfileids[0]", contentId)
    return await ctx.http.post<WorkshopFileResponse>(
      'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      form.toString(),
      {
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      }
    )
  }
  // 去掉消息两端的空格
  let password = null
  if (sessionContent.includes('nsfw')) {
    sessionContent = sessionContent.replace('nsfw', '')
    password = Math.random().toString(36).substring(2, 10)
    logger.info('触发nsfw，设置密码为 ' + password)
  }
  console.log(sessionContent)
  let temp = sessionContent.split('https://steamcommunity.com/sharedfiles/filedetails/?id=')
  if (temp.length < 2) {
    temp = sessionContent.split('https://steamcommunity.com/workshop/filedetails/?id=')
  }
  console.log(temp)
  if (temp.length !== 2) return
  let contentId = temp[1]
  contentId = contentId.trim()
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
  await session.send([h.quote(session.messageId), h.img(pic_url), h.text("【模组名称】" + title), h.text('\n\n【模组简介】' + description), h.text(`\n\n【文件大小】${file_size_mb}MB`), h.text("\n\n正在获取该模组，请稍候...")])
  const gameId = String(info.response.publishedfiledetails[0].creator_app_id)
  const downloadServer = config.download_server
  const downloadPort = config.download_port
  logger.info(`用户 ${session.userId} 下载了 ${contentId}，游戏ID为 ${gameId}，下载链接：${downloadServer}:${downloadPort}/files/${gameId}/${contentId}/`)
  const download_base_link = `${downloadServer}:${downloadPort}/files/${gameId}`
  const workshop_file_path = path.resolve(ctx.baseDir, 'data', 'steam-workshop-downloader', 'steamapps', 'workshop', 'content', gameId, contentId)
  // 如果文件夹不存在则创建
  if (!fsy.existsSync(workshop_file_path)) {
    // 递归创建目录，即使父目录也不存在
    fsy.mkdirSync(workshop_file_path, {recursive: true});
    logger.info(`目录 ${workshop_file_path} 创建成功！`);
  }
  let flag = 1;
  let entries = await fs.readdir(workshop_file_path)
  const retry_limit = 3; // 最大重试次数
  let retryTime = 0; // 最大重试次数
  while (entries.length === 0 || flag) {
    if (retryTime >= retry_limit) {
      await session.send([h.quote(session.messageId), h.text('下载失败，请稍后再试')])
      return
    }
    try {
      if (retryTime !== 0 || !flag) {
        await session.send([h.quote(session.messageId), h.text(`下载时出现问题，可能是steamcmd有更新，正在重试 (${retryTime} / ${retry_limit})`)])
      }
      retryTime += 1
      await steamDownload(steamcmdPath, gameId, contentId, ctx)
      entries = await fs.readdir(workshop_file_path)
      flag = 0
    } catch (e) {
      await session.send([h.quote(session.messageId), h.text('下载时出现问题：' + e.message),])
      return
    }
  }
  const file_directory = config.file_directory || ''
  const file_bot_path = path.resolve(file_directory, 'data', 'steam-workshop-downloader', 'steamapps', 'workshop', 'content', gameId, contentId)
  // 如果文件大于2则先压缩后发送
  logger.info('下载完成，文件数量：' + entries.length)
  const files_full_path = entries.map((entry) => path.resolve(workshop_file_path, entry))
  logger.info(files_full_path)
  let file_path = path.resolve(ctx.baseDir, 'data', 'steam-workshop-downloader', 'steamapps', 'workshop', 'content', gameId, contentId)
  let download_complete_message = '下载完成，上传中'

  let download_link = ''
  if (entries.length >= 2) {
    file_path = await createZip(files_full_path, path.resolve(ctx.baseDir, 'data', 'steam-workshop-downloader', 'steamapps', 'workshop', 'content', gameId, 'zip'), title, password)
    logger.info("文件过多，已压缩为zip文件，路径：" + file_path)
    download_complete_message += `\n\n因为文件数量较多，将压缩为zip文件发送`
    if (password) {
      download_complete_message += `\n\n解压密码为 ${password}`
    }
    if (config.include_download_address) {
      download_complete_message += `\n\n如果长时间未发送文件，请将此链接复制到浏览器中进行下载\n\n${download_link}`
    }
  } else {
    if (password) {
      file_path = await createZip(files_full_path, path.resolve(ctx.baseDir, 'data', 'steam-workshop-downloader', 'steamapps', 'workshop', 'content', gameId, 'zip'), title, password)
      download_complete_message += `\n\n因请求中含有nsfw标识，将加密压缩包，解压密码为 ${password}`
      if (config.include_download_address) {
        download_complete_message += `\n\n如果长时间未发送文件，请将此链接复制到浏览器中进行下载\n\n${download_link}`
      }
    } else {
      if (config.include_download_address) {
        download_complete_message += `\n\n如果长时间未发送文件，请将此链接复制到浏览器中进行下载\n\n${download_link}`
      }
      file_path = files_full_path[0]
    }
  }
  download_link = download_base_link + file_path.split(path.resolve(ctx.baseDir, 'data', 'steam-workshop-downloader', 'steamapps', 'workshop', 'content', gameId))[1].replace(/\\/g, '/')
  logger.info(`下载步骤完成，最终发送路径：${file_path} 最终下载链接：${download_link}`)
  await session.send([h.quote(session.messageId), h.text(download_complete_message)])
  if (config.enable_no_public) {
    await session.send([h.file(pathToFileURL(file_path).href)])
  } else {
    await session.send(<file src={download_link}
                             title={path.basename(file_path)}
    />)
  }
}

