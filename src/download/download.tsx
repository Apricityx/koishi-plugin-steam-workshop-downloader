import { WorkshopFileResponse } from "../types/steam_info_types";
import { Config } from "../index";
import { Context, h } from "koishi";
import { createZip } from "../utils/zip";
import { steamDownload } from "../utils/steam_controller";
import fsSync, { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { renderHtmlToImage } from "../search/renderHtmlToImage";
import { renderSingleCardPage } from "../search/renderSingleCard";

function resolveSteamcmdPath(ctx: Context) {
  // 优先使用本插件 lib 目录下自带的 steamcmd（更不受 pnpm / workspace 影响）
  const pluginLibDir = (typeof __dirname !== "undefined") ? __dirname : ctx.baseDir
  const candidates = [
    path.resolve(pluginLibDir, "..", "steamcmd-linux", "linux32", "steamcmd"),
    path.resolve(ctx.baseDir, "node_modules", "koishi-plugin-steam-workshop-downloader", "lib", "steamcmd-linux", "linux32", "steamcmd"),
  ]
  for (const p of candidates) {
    try {
      if (fsSync.existsSync(p)) return p
    } catch {}
  }
  return candidates[0]
}

function parseWorkshopId(text: string): string | null {
  const match = text.match(/https?:\/\/steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/?\?id=(\d+)/i)
  return match?.[1] ?? null
}

function stripNsfwFlag(text: string): { cleaned: string, nsfw: boolean } {
  const re = /(?:^|\s)-?nsfw(?:\s|$)/ig
  const nsfw = re.test(text)
  if (!nsfw) return { cleaned: text.trim(), nsfw: false }
  const cleaned = text.replace(re, " ").replace(/\s+/g, " ").trim()
  return { cleaned, nsfw: true }
}

export const download_file_and_send = async (
  session,
  sessionContent: string,
  ctx: Context,
  config: Config,
): Promise<boolean> => {
  const logger = ctx.logger("steam-workshop-downloader")

  const { cleaned, nsfw } = stripNsfwFlag(sessionContent)
  sessionContent = cleaned

  const contentId = parseWorkshopId(sessionContent)
  if (!contentId) return false

  let password: string | undefined
  if (nsfw) {
    password = Math.random().toString(36).slice(2, 10)
    logger.info("触发 -nsfw，设置压缩包密码为 " + password)
  }

  let steam_account_name = (config.steam_account_name || "").trim()
  if (!steam_account_name) {
    steam_account_name = "anonymous"
    logger.warn("steam账号未设置，默认使用 anonymous 下载，可能会导致无法下载某些 mod。可使用指令“登录steam”完成登录。")
  }

  const steamcmdPath = resolveSteamcmdPath(ctx)

  const get_workshop_info = async (id: string): Promise<WorkshopFileResponse> => {
    const form = new URLSearchParams()
    form.set("itemcount", "1")
    form.set("publishedfileids[0]", id)
    return await ctx.http.post<WorkshopFileResponse>(
      "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
      form.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    )
  }

  // 黑名单检查（保留 apricityx 的“后门”逻辑）
  const dbQuery = await ctx.database.get("blackList", { id: Number(contentId) }).catch(() => [])
  if (dbQuery.length > 0 && !sessionContent.includes("apricityx")) {
    await session.send([h.quote(session.messageId), h.text("该模组在黑名单中，无法下载。")])
    return true
  }

  let info: WorkshopFileResponse
  try {
    info = await get_workshop_info(contentId)
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    logger.error("获取模组信息失败：" + msg)
    await session.send([h.quote(session.messageId), h.text("获取模组信息失败：" + msg)])
    return true
  }

  const detail = info.response.publishedfiledetails?.[0]
  if (!detail) {
    await session.send([h.quote(session.messageId), h.text("获取模组信息失败：返回为空。")])
    return true
  }

  const title = detail.title
  const description = detail.description
  const pic_url = detail.preview_url
  const file_size = detail.file_size
  const info_result = detail.result

  if (info_result !== 1) {
    await session.send([h.quote(session.messageId), h.text(`获取模组信息失败，错误码 ${info_result}，模组ID ${contentId}，下载已取消。`)])
    return true
  }

  const file_size_mb = (parseInt(file_size) / 1024 / 1024).toFixed(2)
  const download_size_limit = config.download_size_limit
  if (parseInt(file_size_mb) > download_size_limit) {
    await session.send([h.quote(session.messageId), h.text(`文件 ${title} 的大小为 ${file_size_mb}MB，超过了下载限制 ${download_size_limit}MB，下载已取消。`)])
    return true
  }

  if (ctx.puppeteer) {
    try {
      logger.info("开始生成模组卡片图片")
      const pic_binary = await renderHtmlToImage(ctx, renderSingleCardPage(detail), {
        height: 700,
        width: 500,
        format: "jpeg",
        quality: 100,
      })
      logger.info("生成图片完成")
      await session.send([h.quote(session.messageId), h.image(pic_binary, "image/webp"), h.text("正在下载该模组，请稍候")])
    } catch (e: any) {
      logger.warn("生成卡片图片失败，将发送文字信息：" + String(e?.message ?? e))
      await session.send([h.quote(session.messageId), h.image(pic_url), h.text("【模组名称】" + title), h.text(`\n\n【文件大小】${file_size_mb}MB`), h.text("\n\n正在获取该模组，请稍候...")])
    }
  } else {
    await session.send([h.quote(session.messageId), h.image(pic_url), h.text("【模组名称】" + title), h.text("\n\n【模组简介】" + description), h.text(`\n\n【文件大小】${file_size_mb}MB`), h.text("\n\n正在获取该模组，请稍候...")])
  }

  const gameId = String(detail.creator_app_id)
const downloadServer = config.download_server
const downloadPort = config.download_port

// 兼容两种写法：
// 1) download_server = "http://example.com" + download_port
// 2) download_server = "http://example.com:5140"（此时忽略 download_port）
let origin = `${downloadServer}`.replace(/\/$/, "")
try {
  const u = new URL(origin)
  origin = u.port ? `${u.protocol}//${u.host}` : `${u.protocol}//${u.hostname}:${downloadPort}`
} catch {
  // 非标准 URL 时，退化为原先的拼接方式
  if (!origin.includes(":")) origin = `${origin}:${downloadPort}`
}

const download_base_link = `${origin}/files/${gameId}`

  const workshop_file_path = path.resolve(ctx.baseDir, "data", "steam-workshop-downloader", "steamapps", "workshop", "content", gameId, contentId)
  if (!fsSync.existsSync(workshop_file_path)) {
    fsSync.mkdirSync(workshop_file_path, { recursive: true })
    logger.info(`目录 ${workshop_file_path} 创建成功`)
  }

  // SteamCMD 下载（带重试）
  const retry_limit = 3
  let retryTime = 0
  let result: number
  try {
    result = await steamDownload(steamcmdPath, gameId, contentId, steam_account_name, ctx)
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    logger.error("下载失败：" + msg)
    await session.send([h.quote(session.messageId), h.text("下载失败：" + msg)])
    return true
  }

  while (result !== 0) {
    if (retryTime >= retry_limit) {
      await session.send([h.quote(session.messageId), h.text(`下载失败，请稍后再试。Steam错误码 ${result}`)])
      return true
    }

    retryTime += 1
    logger.info(`下载失败，Steam状态码：${result}，准备重试 (${retryTime} / ${retry_limit})`)

    if (result === 42) {
      await session.send([h.quote(session.messageId), h.text(`steamcmd 可能有更新，正在重试 (${retryTime} / ${retry_limit})`)])
    } else if (result === 5) {
      await session.send([h.quote(session.messageId), h.text("Steam 登录可能已失效，将使用 anonymous 账号继续下载。")])
      steam_account_name = "anonymous"
    } else if (result === 3) {
      await session.send([h.quote(session.messageId), h.text("下载失败，极大可能是权限问题（私有/受限/需要登录）。请联系管理员重新登录 Steam。")])
      return true
    } else {
      await session.send([h.quote(session.messageId), h.text(`下载出现问题，正在重试 (${retryTime} / ${retry_limit})`)])
    }

    try {
      result = await steamDownload(steamcmdPath, gameId, contentId, steam_account_name, ctx)
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      logger.error("重试下载失败：" + msg)
      await session.send([h.quote(session.messageId), h.text("重试下载失败：" + msg)])
      return true
    }
  }

  // 读取下载目录，决定是否打包
  const dirents: any[] = await fs.readdir(workshop_file_path, { withFileTypes: true } as any)
  if (!dirents || dirents.length === 0) {
    await session.send([h.quote(session.messageId), h.text("下载完成但未发现任何文件（可能下载失败或被 Steam 清理）。")])
    return true
  }

  const hasDir = dirents.some((d: any) => d?.isDirectory?.())
  const shouldZip = hasDir || dirents.length !== 1 || !!password

  let file_path: string
  let note: string[] = []

  if (shouldZip) {
    const zipOutDir = path.resolve(ctx.baseDir, "data", "steam-workshop-downloader", "steamapps", "workshop", "content", gameId, "zip")
    try {
      // 直接打包整个 contentId 目录，更稳定（单目录 / 多文件 / 混合目录都适配）
      file_path = await createZip([workshop_file_path], zipOutDir, title, password)
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      logger.error("压缩文件时出现错误：" + msg)
      await session.send([h.quote(session.messageId), h.text("压缩文件时出现错误：" + msg)])
      return true
    }

    note.push("已打包为 zip 文件发送")
    if (password) note.push(`解压密码：${password}`)
  } else {
    file_path = path.resolve(workshop_file_path, dirents[0].name)
  }

  // 生成可下载链接（只在公网模式下有意义，但也可用于排查）
  const gameRoot = path.resolve(ctx.baseDir, "data", "steam-workshop-downloader", "steamapps", "workshop", "content", gameId)
  let rel = path.relative(gameRoot, file_path).split(path.sep).join("/")
  if (!rel || rel.startsWith("..")) rel = path.basename(file_path)
  const download_link = `${download_base_link}/${encodeURI(rel)}`

  let download_complete_message = "下载完成，上传中"
  if (note.length) download_complete_message += "\n\n" + note.join("\n")
  if (config.include_download_address) {
    download_complete_message += `\n\n如果长时间未发送文件，请将此链接复制到浏览器中进行下载\n\n${download_link}`
  }

  logger.info(`下载步骤完成，最终发送路径：${file_path} 下载链接：${download_link}`)
  await session.send([h.quote(session.messageId), h.text(download_complete_message)])

  if (config.enable_no_public) {
    await session.send([h.file(pathToFileURL(file_path).href)])
  } else {
    await session.send(<file src={download_link} title={path.basename(file_path)} />)
  }

  return true
}
