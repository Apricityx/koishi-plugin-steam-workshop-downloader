/* @jsx h */
import { Context, Schema, h } from 'koishi'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import express from 'express'

export const name = 'steam-workshop-downloader'

export interface Config {
  debug: boolean
  download_server: string
  download_port: number
  enable_proxy: boolean
  proxy_address: string
  appid: string
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    debug: Schema.boolean().description('是否启动调试模式').default(false),
  }).description('基础配置'),

  Schema.object({
    download_server: Schema.string().description('koishi所在服务器的地址').default('your_server.com'),
    download_port: Schema.number().description('一个可用的端口').default(11451),
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
    appid: Schema.string().description('目标游戏的 AppID（必填）').required(),
  }),
]) as any

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true }).catch(() => void 0)
}

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
      return p
    }
  }
  return null
}

function pickEnv(env: NodeJS.ProcessEnv | Record<string, string>, keys: string[]) {
  const out: Record<string, string | undefined> = {}
  for (const k of keys) out[k] = (env as any)[k]
  return out
}

function runCommand(
  logger: Context['logger'],
  command: string,
  opts?: {
    cwd?: string
    extraEnv?: Record<string, string>
    printEnvKeys?: string[]
    debug?: boolean
  }
): Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: NodeJS.Signals | null }> {
  const cwd = opts?.cwd || process.cwd()
  const env = { ...process.env, ...(opts?.extraEnv || {}) }

  let outBuf = ''
  let errBuf = ''
  const append = (buf: string, chunk: string) => {
    buf += chunk
    if (buf.length > 4096) buf = buf.slice(buf.length - 4096)
    return buf
  }

  if (opts?.debug) {
    logger.info(`[run] cwd=${cwd}`)
    logger.info(`[run] command=/bin/sh -lc ${JSON.stringify(command)}`)
    if (opts?.printEnvKeys?.length) {
      const kv: Record<string, string | undefined> = {}
      for (const k of opts.printEnvKeys) kv[k] = (env as any)[k]
      logger.info(`[run] selected env: ${JSON.stringify(kv, null, 2)}`)
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-lc', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { outBuf = append(outBuf, chunk); logger.info(`[stdout] ${chunk.trimEnd()}`) })
    child.stderr.on('data', (chunk: string) => { errBuf = append(errBuf, chunk); logger.warn(`[stderr] ${chunk.trimEnd()}`) })
    child.on('error', (err: any) => {
      const diag = {
        where: 'spawn.error',
        message: err?.message,
        code: err?.code,
        errno: err?.errno,
        syscall: err?.syscall,
        path: err?.path,
        spawnargs: err?.spawnargs,
        command,
        cwd,
        env_pick: pickEnv(env, ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']),
        stdout_tail_4kb: outBuf,
        stderr_tail_4kb: errBuf,
        stack: (err?.stack || '').split('\n').slice(0, 12).join('\n'),
      }
      logger.error(`[run] child error:\n${JSON.stringify(diag, null, 2)}`)
      reject(Object.assign(new Error('spawn error'), { cause: diag }))
    })
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        if (opts?.debug) logger.info(`[run] exit code 0, signal=${signal ?? 'null'}`)
        resolve({ stdout: outBuf, stderr: errBuf, exitCode: code, signal })
      } else {
        const diag = {
          where: 'close',
          exitCode: code,
          signal,
          command,
          cwd,
          env_pick: pickEnv(env, ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']),
          stdout_tail_4kb: outBuf,
          stderr_tail_4kb: errBuf,
        }
        logger.error(`[run] non-zero exit:\n${JSON.stringify(diag, null, 2)}`)
        const err = new Error(`command failed with code=${code}, signal=${signal ?? 'null'}`)
        ;(err as any).diag = diag
        reject(err)
      }
    })
  })
}

// ============== Express 下载直连（单例） ==============
let expressServer: import('http').Server | null = null
let baseDownloadURL = '' // e.g. http://your_server.com:11451/file
function ensureDownloadServer(ctx: Context, baseDir: string, host: string, port: number) {
  if (expressServer) return

  const app = express()
  // 强制下载响应头（先于静态）
  app.use('/file', (req, res, next) => {
    const filename = path.basename(req.path)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    next()
  })
  app.use('/file', express.static(baseDir, { dotfiles: 'deny', fallthrough: false }))

  expressServer = app.listen(port, '0.0.0.0', () => {
    baseDownloadURL = `http://${host}:${port}/file`
    ctx.logger.success(`[download] ${baseDownloadURL} -> ${baseDir}/<path>`)
    console.log(`[download] base URL: ${baseDownloadURL}`)
  })

  ctx.on('dispose', () => {
    if (expressServer) {
      expressServer.close(() => ctx.logger.info('[download] express server closed'))
      expressServer = null
      baseDownloadURL = ''
    }
  })
}

// ================= 主逻辑 =================
export function apply(ctx: Context, config: Config) {
  ctx.logger.success('steam-workshop-downloader')

  if (!config.appid) {
    ctx.logger.error('配置项 appid 为空：请在配置文件中填写目标游戏的 AppID。')
  }

  const pluginPath = path.join(ctx.baseDir, 'node_modules/koishi-plugin-steam-workshop-downloader/lib')
  const steamcmdPath = path.join(pluginPath, 'steamcmd-linux/linux32/steamcmd')
  const downloadDirectory = path.join(pluginPath, 'downloads')

  // 启动一次 express 文件服务
  ensureDownloadServer(ctx, downloadDirectory, config.download_server, config.download_port)

  const steamcmdEnv =
    config.enable_proxy && config.proxy_address
      ? { http_proxy: config.proxy_address, https_proxy: config.proxy_address, all_proxy: config.proxy_address }
      : undefined

  if (config.enable_proxy) {
    ctx.logger.info(`[proxy] 已启用代理: ${config.proxy_address}`)
    if (config.debug) ctx.logger.info(`[proxy] 注入给 steamcmd 的环境变量: ${JSON.stringify(steamcmdEnv, null, 2)}`)
  }

  ctx.middleware(async (session, next) => {
    const text = session.content || ''
    if (!text.startsWith('https://steamcommunity.com/')) return next()

    const modIDs = extractModIds(text)
    if (modIDs.length === 0) return next()

    if (!config.appid) {
      await session.send('❌ 未配置 appid，请在配置文件中填写目标游戏的 AppID。')
      return
    }

    await ensureDir(downloadDirectory)
    await session.send(`检测到 ${modIDs.length} 个创意工坊链接，将按配置的 AppID=${config.appid} 进行下载…`)

    for (const modID of modIDs) {
      try {
        const appId = String(config.appid).trim()
        const command =
          `${steamcmdPath} +force_install_dir "${downloadDirectory}" +login anonymous +workshop_download_item ${appId} ${modID} +quit`

        if (config.debug) ctx.logger.info('执行命令: ' + command)
        await session.send(`开始下载（AppID=${appId}, modID=${modID}）…`)

        await runCommand(ctx.logger, command, {
          cwd: pluginPath,
          extraEnv: steamcmdEnv,
          printEnvKeys: ['http_proxy', 'https_proxy', 'all_proxy'],
          debug: !!config.debug,
        })

        const workshopDir = path.join(downloadDirectory, 'steamapps', 'workshop', 'content', appId, String(modID))
        const file = await findFirstFile(workshopDir)
        if (file) {
          // 生成基于 express 的直连地址
          const rel = path.relative(downloadDirectory, file).split(path.sep).join('/')
          const url = `${baseDownloadURL}/${rel}`

          // 打到控制台
          console.log(`[download] file ready: ${url}`)

          ctx.logger.success(`下载完成：${file}`)
          // 在“正在发送文件…”后面贴上直连地址
          await session.send(`下载完成（AppID=${appId}, modID=${modID}），正在上传文件… \n如果上传时间过长，可能是bot超过了文件限额，可以将该链接复制到浏览器下载：\n{url}`)

          // 如果你不再需要 base64 发送，可删除下面这行：
          // await sendAnyFile(session, file)
        } else {
          await session.send(`下载完成但未找到文件：${workshopDir}`)
        }
      } catch (err: any) {
        ctx.logger.error(`下载失败(mod ${modID}) 大概率是steamcmd抽风了，可以稍后重试: ${err?.message || err}`)
        if (err?.diag) ctx.logger.error(`[diag] ${JSON.stringify(err.diag, null, 2)}`)
        else if (err?.stack) ctx.logger.error(`[stack] ${String(err.stack).split('\n').slice(0, 20).join('\n')}`)
        await session.send(`❌ 下载失败（modID=${modID}）：${err?.message || err}`)
      }
    }
  })
}

/** 从文本中提取所有可能的 Workshop modID（只保留纯数字，自动去重） */
function extractModIds(text: string): string[] {
  if (!text) return []
  const ids = new Set<string>()
  const httpRe = /https?:\/\/steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/\?[^ \n]*?\bid=(\d+)/gi
  const schemeRe = /steam:\/\/url\/CommunityFilePage\/(\d+)/gi
  let m: RegExpExecArray | null
  while ((m = httpRe.exec(text))) ids.add(m[1])
  while ((m = schemeRe.exec(text))) ids.add(m[1])
  const looseRe = /\b(?:id=)?(\d{6,})\b/g
  while ((m = looseRe.exec(text))) ids.add(m[1])
  return [...ids]
}
