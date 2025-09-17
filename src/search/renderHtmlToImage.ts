import type { Context } from 'koishi'

/**
 * 使用 koishi-plugin-puppeteer 将完整 HTML 渲染为 PNG 二进制 Buffer
 * 需先安装并启用：koishi-plugin-puppeteer
 */
export async function renderHtmlToImage(
  ctx: Context,
  html: string,
  opts?: {
    width?: number
    height?: number
    deviceScaleFactor?: number
    fullPage?: boolean
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'
    transparent?: boolean
  },
): Promise<Buffer> {
  const {
    width = 640,
    height = 720,
    deviceScaleFactor = 1,
    fullPage = true,
    waitUntil = 'networkidle0',
    transparent = false,
  } = opts || {}

  // 新 API：不需要 launch()，直接拿到 Page
  const page = await ctx.puppeteer.page()

  try {
    await page.setViewport({ width, height, deviceScaleFactor })
    await page.setContent(html, { waitUntil })
    const buf = (await page.screenshot({
      type: 'png',
      fullPage,
      omitBackground: transparent,
    })) as Buffer
    return buf
  } finally {
    await page.close()
    // 如需彻底释放浏览器连接，可在合适时机调用：
    // await ctx.puppeteer.stop()
  }
}
