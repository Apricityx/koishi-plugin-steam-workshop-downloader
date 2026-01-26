import { spawn } from "node:child_process"
import { proxy_address } from "../index"
import { Context } from "koishi"
import path from "node:path"
import readline from "node:readline"

type RunResult = { code: number | null, result_output: string }

function buildEnv() {
  const env: Record<string, string> = { ...(process.env as any) }
  if (proxy_address && proxy_address.trim().length > 0) {
    env.http_proxy = proxy_address
    env.https_proxy = proxy_address
    if (!env.no_proxy) env.no_proxy = "localhost"
  }
  return env as any
}

export const runFile = (
  file: string,
  args: string[] = [],
  timeoutMs: number,
  logger?: any,
): Promise<RunResult> => {
  const logInfo = (line: string) => (logger?.info ? logger.info(line) : console.log(line))
  const logErr = (line: string) => (logger?.error ? logger.error(line) : console.error(line))

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(file, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildEnv(),
    })

    let result_output = ""

    const rlOut = readline.createInterface({ input: child.stdout! })
    rlOut.on("line", (line) => {
      logInfo(`[SteamCMD] ${line}`)
      result_output += line + "\n"
    })

    const rlErr = readline.createInterface({ input: child.stderr! })
    rlErr.on("line", (line) => {
      logErr(`[SteamCMD] ${line}`)
      result_output += line + "\n"
    })

    let timer: NodeJS.Timeout | undefined
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL")
        } catch {}
        reject(new Error(`timeout after ${timeoutMs} ms`))
      }, timeoutMs)
    }

    child.on("error", (e) => {
      if (timer) clearTimeout(timer)
      rlOut.close()
      rlErr.close()
      reject(e)
    })

    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      rlOut.close()
      rlErr.close()
      resolve({ code, result_output })
    })
  })
}

let isDownloading = false

export const steamDownload = async (
  steamCmdPath: string,
  gameId: string,
  contentId: string,
  steam_account_name: string,
  ctx: Context,
) => {
  const logger = ctx.logger("steam-workshop-downloader:steamcmd")
  if (isDownloading) {
    throw new Error("已有下载任务在进行中，请稍后再试")
  }

  const args = [
    "+@ShutdownOnFailedCommand", "1",
    "+@NoPromptForPassword", "1",
    "+force_install_dir", path.resolve(ctx.baseDir, "data", "steam-workshop-downloader"),
    "+login", steam_account_name,
    "+workshop_download_item", gameId, contentId,
    "+quit",
  ]

  try {
    isDownloading = true
    const result = await runFile(steamCmdPath, args, 1000_000, logger)
    let code = result.code
    // steamcmd 某些情况下会 exit 0 但输出里有 ERROR!
    if (result.result_output.includes("ERROR!")) code = 3
    return code ?? -1
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (msg.includes("timeout")) throw new Error("下载超时，请稍后再试")
    throw new Error("未知错误：" + msg)
  } finally {
    isDownloading = false
  }
}

export const steamLogin = async (
  steamCmdPath: string,
  steam_account_name: string,
  steam_account_pass: string,
  steam_guard_code: string,
  ctx: Context,
) => {
  const logger = ctx.logger("steam-workshop-downloader:steamcmd")
  const args = [
    "+@NoPromptForPassword", "1",
    "+@ShutdownOnFailedCommand", "1",
    "+set_steam_guard_code", steam_guard_code,
    "+login", steam_account_name, steam_account_pass,
    "+quit",
  ]
  const result = await runFile(steamCmdPath, args, 60_000, logger)
  return result.code
}

export const steamLogout = async (steamCmdPath: string, ctx: Context) => {
  const logger = ctx.logger("steam-workshop-downloader:steamcmd")
  const result = await runFile(steamCmdPath, ["+logout", "+quit"], 10_000, logger)
  return result.code
}

// code:
// 0 - 成功
// 42 - Unknown（常见于 steamcmd 更新/内部错误）
// 5 - 登录失败/令牌失效
//
// download code
// 0 - 成功
// 3 - 权限问题（输出含 ERROR!）
// 5 - 登录掉了
