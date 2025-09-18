import {spawn} from 'node:child_process'
import {proxy_address} from "../index";
import {Context} from "koishi";
import path from "node:path";

let _ctx: Context

import readline from 'node:readline'

export const runFile = (
  file: string,
  args: string[] = [],
  timeoutMs: number
): Promise<{ code: number | null, result_output: string }> => {
  return new Promise<{ code: number | null, result_output: string }>((resolve, reject) => {
    const child = spawn(file, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'], // 用管道拿到输出
      env: {
        http_proxy: proxy_address,
        https_proxy: proxy_address,
        no_proxy: 'localhost',
        // 如果需要保留彩色日志，可以加：FORCE_COLOR: '1'
      },
    })
    let result_output: string = ''
    // 按行转发 stdout
    const rlOut = readline.createInterface({input: child.stdout!})
    rlOut.on('line', (line) => {
      _ctx.logger.info(`[SteamCMD] ${line}`)
      result_output += line + '\n'
    })

    // 按行转发 stderr（也走 console.log；想分开可用 console.error）
    const rlErr = readline.createInterface({input: child.stderr!})
    rlErr.on('line', (line) => {
      _ctx.logger.error(`[SteamCMD] ${line}`)
      result_output += line + '\n'
    })

    let timer: NodeJS.Timeout | undefined
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`timeout after ${timeoutMs} ms`))
      }, timeoutMs)
    }

    child.on('error', reject)
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      rlOut.close()
      rlErr.close()
      resolve({code, result_output})
    })
  })
}


let isDownloading = false
export const steamDownload = async (steamCmdPath: string, gameId: string, contentId: string, steam_account_name: string, ctx: Context) => {
  // steamcmd +login anonymous +workshop_download_item <AppID> <WorkshopID> +quit
  let result: { code: number | null, result_output: string } = {code: -1, result_output: ''}
  _ctx = ctx
  if (isDownloading) {
    throw new Error('已有下载任务在进行中，请稍后再试')
  }
  try {
    isDownloading = true
    result = await runFile(steamCmdPath, ["+@ShutdownOnFailedCommand 1", "+@NoPromptForPassword 1", "+force_install_dir", path.resolve(ctx.baseDir, 'data', 'steam-workshop-downloader'), '+login', `${steam_account_name}`, '+workshop_download_item', gameId, contentId, '+quit'], 1000_000)
    isDownloading = false
  } catch (e) {
    isDownloading = false
    if (e.message.includes('timeout')) {
      throw new Error('下载超时，请稍后再试')
    }
    throw new Error('未知错误，请联系开发者')
  }
  // 该状况一般不会出现
  if (result.code === -1) {
    throw new Error('下载失败，未知错误，请联系开发者')
  }
  if (result.result_output.includes('ERROR!')) result.code = 3 // 自定义报错 无权限
  console.log({"下载返回值": result.code})
  return result.code
}

export const steamLogin = async (steamCmdPath: string, steam_account_name: string, steam_account_pass: string, steam_guard_code: string, ctx: Context) => {
  // steamcmd \
  //   +@NoPromptForPassword 1 \
  //   +@ShutdownOnFailedCommand 1 \
  //   +set_steam_guard_code "$STEAM_GUARD" \
  //   +login "$STEAM_USER" "$STEAM_PASS" \
  //   +quit
  _ctx = ctx
  const args = [
    "+@NoPromptForPassword", "1",
    "+@ShutdownOnFailedCommand", "1",
    "+set_steam_guard_code", steam_guard_code,
    "+login", steam_account_name, steam_account_pass,
    "+quit"
  ]
  const result = await runFile(steamCmdPath, args, 60_000)
  console.log("登录返回值：", result)
  return result.code
}

export const steamLogout = async (steamCmdPath: string, ctx: Context) => {
  // steamcmd +logout +quit
  _ctx = ctx
  const result = await runFile(steamCmdPath, ["+logout", "+quit"], 10_000)
  console.log(result)
}

// code:
// 0 - 成功
// 42 - Unknown
// 5 - 登录失败 错误令牌

// download code
// 0 - 成功
// 5 - 登录掉了

