import {spawn} from 'node:child_process'
import {proxy_address} from "../index";
import {Context} from "koishi";
import path from "node:path";

export const runFile = (
  file: string,
  args: string[] = [],
  timeoutMs: number
): Promise<{ code: number | null }> => {
  return new Promise<{ code: number | null }>((resolve, reject) => {
    const child = spawn(file, args, {
      shell: false,              // Linux 下不需要 shell
      stdio: 'inherit',          // 关键：继承父进程的 stdin/stdout/stderr
      env: {
        'http_proxy': proxy_address,
        'https_proxy': proxy_address,
        'no_proxy': 'localhost'
      }
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
      resolve({code})
    })
  })
}

let isDownloading = false
export const steamDownload = async (steamCmdPath: string, gameId: string, contentId: string, ctx: Context) => {
  // steamcmd +login anonymous +workshop_download_item <AppID> <WorkshopID> +quit
  if (isDownloading) {
    throw new Error('已有下载任务在进行中，请稍后再试')
  }
  try {
    isDownloading = true
    await runFile(steamCmdPath, ["+force_install_dir", path.resolve(ctx.baseDir, 'data', 'steam-workshop-downloader'), '+login', 'anonymous', '+workshop_download_item', gameId, contentId, '+quit'], 1000_000)
    isDownloading = false
  } catch (e) {
    isDownloading = false
    if (e.message.includes('timeout')) {
      throw new Error('下载超时，请稍后再试')
    }
    throw new Error('未知错误，请联系开发者')
  }
}
