/* @jsx h */
import { Context, Schema, h } from 'koishi'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { basename } from 'path'
import { lookup as mimeLookup } from 'mime-types'  // npm i mime-types

export const name = 'steam-workshop-downloader'
export interface Config {}
export const Config: Schema<Config> = Schema.object({})

// ================= 工具函数 =================
async function sendAnyFile(session: any, absPath: string) {
  const buf = await fs.readFile(absPath)
  const mime = (mimeLookup(absPath) as string) || 'application/octet-stream'
  const b64  = Buffer.from(buf).toString('base64')
  const src  = `data:${mime};base64,${b64}`
  await session.send(<file src={src} title={basename(absPath)} />)
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true }).catch(() => void 0)
}

/** 递归找到目录下“第一个”文件（非目录） */
async function findFirstFile(dir: string): Promise<string | null> {
  let entries: any[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      const sub = await findFirstFile(p)
      if (sub) return sub
    } else {
      return p // 只取第一个文件
    }
  }
  return null
}

/** 将 exec 封装为 Promise */
function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stdout, stderr }))
      resolve({ stdout, stderr })
    })
  })
}

/** 从文本中提取所有可能的 Workshop modID（只保留纯数字，自动去重） */
function extractModIds(text: string): string[] {
  if (!text) return []
  const ids = new Set<string>()

  // 常见链接形式：
  // https://steamcommunity.com/sharedfiles/filedetails/?id=3551753322
  // https://steamcommunity.com/workshop/filedetails/?id=3551753322
  const httpRe = /https?:\/\/steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/\?[^ \n]*?\bid=(\d+)/gi
  // steam://url/CommunityFilePage/3551753322
  const schemeRe = /steam:\/\/url\/CommunityFilePage\/(\d+)/gi

  let m: RegExpExecArray | null
  while ((m = httpRe.exec(text))) ids.add(m[1])
  while ((m = schemeRe.exec(text))) ids.add(m[1])

  // 兜底：有人只贴“id=xxxx”或纯数字
  const looseRe = /\b(?:id=)?(\d{6,})\b/g
  while ((m = looseRe.exec(text))) ids.add(m[1])

  return [...ids]
}

/** 调用官方公开接口获取条目详情 */
async function getWorkshopDetails(modId: string): Promise<any | null> {
  const url = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/'
  const body = new URLSearchParams()
  body.set('itemcount', '1')
  body.set('publishedfileids[0]', modId)
  const resp = await fetch(url, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (!resp.ok) return null
  const json = await resp.json().catch(() => null)
  const list = json?.response?.publishedfiledetails
  if (!Array.isArray(list) || !list.length) return null
  return list[0]  // 单个
}

/** 根据 modId 解析 appId */
async function resolveAppAndChildren(modId: string): Promise<
  { type: 'item', appId: string, modId: string }[] | { type: 'none' }
> {
  const d = await getWorkshopDetails(modId)
  if (!d || d?.result !== 1) return { type: 'none' }

  // type 文档：0=普通物品/Mod；2=合集；其它类型此处不处理
  const typeNum = Number(d.file_type ?? d.consumer_type ?? d.type ?? 0)
  const consumerAppId = String(d.consumer_app_id ?? d.appid ?? '')

  if (typeNum === 2 && Array.isArray(d.children) && d.children.length) {
    // 合集：把 children 展开，并逐个解析 appId
    const tasks: { type: 'item', appId: string, modId: string }[] = []
    for (const ch of d.children) {
      const cid = String(ch.publishedfileid)
      const cd = await getWorkshopDetails(cid)
      if (cd && cd.result === 1) {
        const ca = String(cd.consumer_app_id ?? cd.appid ?? '')
        if (ca) tasks.push({ type: 'item', appId: ca, modId: cid })
      }
    }
    return tasks.length ? tasks : { type: 'none' }
  }

  if (consumerAppId) {
    return [{ type: 'item', appId: consumerAppId, modId }]
  }

  return { type: 'none' }
}

// ================= 主逻辑 =================
export function apply(ctx: Context) {
  ctx.logger.success('steam-workshop-downloader')

  // 路径与参数（按你的原先逻辑）
  const pluginPath = ctx.baseDir + '/node_modules/koishi-plugin-steam-workshop-downloader/src'
  const steamcmdPath = pluginPath + '/steamcmd-linux/linux32/steamcmd'
  const downloadDirectory = pluginPath + '/downloads'

  ctx.middleware(async (session, next) => {
    const text = session.content || ''
    const modIDs = extractModIds(text)

    if (modIDs.length === 0) {
      return next()
    }

    await ensureDir(downloadDirectory)
    await session.send(`检测到 ${modIDs.length} 个创意工坊链接，开始解析 AppID 并下载…`)

    // 顺序处理，避免 steamcmd 并发冲突
    for (const modID of modIDs) {
      try {
        await session.send(` 解析 modID=${modID} 的 AppID…`)
        const resolved = await resolveAppAndChildren(modID)

        if (resolved === null || (resolved as any).type === 'none' || (Array.isArray(resolved) && resolved.length === 0)) {
          await session.send(`❌ 无法解析 AppID 或条目不可用（modID=${modID}）。`)
          continue
        }

        const items = Array.isArray(resolved) ? resolved : []
        // 如果是合集，会有多个条目；普通物品则只有一个
        for (const it of items) {
          const { appId, modId } = it
          const command =
            `${steamcmdPath} ` +
            `+force_install_dir "${downloadDirectory}" ` +
            `+login anonymous ` +
            `+workshop_download_item ${appId} ${modId} ` +
            `+quit`

          ctx.logger.info('执行命令: ' + command)
          await session.send(`开始下载（AppID=${appId}, modID=${modId}）…`)
          const { stdout, stderr } = await execAsync(command)
          if (stderr) ctx.logger.warn(`stderr(app ${appId}, mod ${modId}): ${stderr}`)
          ctx.logger.info(`stdout(app ${appId}, mod ${modId}): ${stdout}`)

          const workshopDir = path.join(
            downloadDirectory,
            'steamapps',
            'workshop',
            'content',
            String(appId),
            String(modId),
          )

          const file = await findFirstFile(workshopDir)
          if (file) {
            ctx.logger.success(`下载完成：${file}`)
            await session.send(`下载完成（AppID=${appId}, modID=${modId}），正在发送文件…`)
            await sendAnyFile(session, file)
          } else {
            await session.send(`下载完成但未找到文件：${workshopDir}`)
          }
        }
      } catch (err: any) {
        ctx.logger.error(`下载失败(mod ${modID}): ${err?.message || err}`)
        await session.send(`❌ 下载失败（modID=${modID}）：${err?.message || err}`)
      }
    }

    return
  })
}
