import type { Context } from 'koishi'
type ImageFormat = 'png' | 'jpeg' | 'webp'

export interface RenderOptions {
  width?: number
  height?: number
  deviceScaleFactor?: number
  fullPage?: boolean
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'
  format?: ImageFormat            // 输出格式：png | jpeg | webp（默认 jpeg）
  quality?: number                // 仅对 jpeg/webp 生效，1-100（默认 70）
  transparent?: boolean           // 透明背景：仅 png/webp 有效，jpeg 会被忽略
  clip?: { x: number; y: number; width: number; height: number } // 局部截图
  onSize?: (bytes: number) => void // 可选回调，返回图片体积（字节）
}

/**
 * 使用 koishi-plugin-puppeteer 渲染 HTML 为图片（支持 png/jpeg/webp），并打印图片体积
 * 需先安装并启用：koishi-plugin-puppeteer
 */
export async function renderHtmlToImage(
  ctx: Context,
  html: string,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const {
    width = 640,
    height = 720,
    deviceScaleFactor = 1,
    fullPage = true,
    waitUntil = 'networkidle0',
    format = 'webp',
    quality = 85,
    transparent = false,
    clip,
    onSize,
  } = opts

  // Puppeteer Page
  const page = await ctx.puppeteer.page()

  try {
    await page.setViewport({ width, height, deviceScaleFactor })

    // 如果请求 jpeg + 透明，提示并自动禁用透明
    const useTransparent = (format === 'png' || format === 'webp') ? transparent : false
    if (transparent && format === 'jpeg') {
      console.warn('[renderHtmlToImage] JPEG 不支持透明背景，已自动忽略 transparent。')
    }

    await page.setContent(html, { waitUntil })

    // 组装截图参数
    const shot: Parameters<typeof page.screenshot>[0] = {
      type: format,
      fullPage,
      omitBackground: useTransparent,
    }

    // 仅对 jpeg/webp 设置质量
    if (format === 'jpeg' || format === 'webp') {
      ;(shot as any).quality = Math.max(1, Math.min(100, quality))
    }

    // 局部截图时必须禁用 fullPage
    if (clip) {
      shot.fullPage = false
      shot.clip = clip
    }

    const buf = (await page.screenshot(shot)) as Buffer

    // 计算体积并打印
    const bytes = buf.length
    const sizeKB = bytes / 1024
    const sizeMB = sizeKB / 1024
    const pretty = sizeMB >= 1
      ? `${sizeMB.toFixed(2)} MB`
      : `${sizeKB.toFixed(2)} KB`

    console.log(`[renderHtmlToImage] format=${format}, quality=${quality}, dpr=${deviceScaleFactor}, size=${pretty} (${bytes} bytes)`)

    // 回调通知体积
    if (typeof onSize === 'function') onSize(bytes)

    return buf
  } finally {
    await page.close()
    // 如需彻底释放浏览器连接，可在合适时机调用：
    // await ctx.puppeteer.stop()
  }
}
