import {Context} from "koishi";
import { getPluginLogger } from "./utils/plugin_logger";
import fs from 'node:fs'
import path from 'node:path'


export const init_server = (ctx: Context, debug = false) => {
  const logger = getPluginLogger(ctx, debug, "steam-workshop-downloader:file-server")
  if (!(ctx as any).server) return
  const targetDir = path.join(ctx.baseDir, 'data', 'steam-workshop-downloader', "steamapps", "workshop", "content")

  const resolveSafe = (p: string): string | null => {
    const sub = p.replace(/^\/+/, '')
    const abs = path.resolve(targetDir, sub)
    return (abs === targetDir || abs.startsWith(targetDir + path.sep)) ? abs : null
  }

  const MOUNT = '/files'
  // 简单转义
  const escapeHtml = (s: string) => {
    return s.replace(/[&<>"']/g, c =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!)
    )
  }

  // 面包屑 HTML
  const breadcrumbsHTML = (relPath: string): string => {
    const parts = relPath.split('/').filter(Boolean)
    const crumbs: string[] = [`<a href="${MOUNT}">Workshop</a>`]
    let acc = ''
    for (const part of parts) {
      acc += '/' + part
      crumbs.push(`<a href="${MOUNT}${encodeURI(acc)}">${escapeHtml(part)}</a>`)
    }
    return crumbs.join(' / ')
  }

  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, {recursive: true}
    )
  }

  // 目录页 HTML 渲染
  function renderDir(relPath: string, entries: fs.Dirent[]): string {
    const upLink = relPath ? `${MOUNT}${encodeURI('/' + path.posix.dirname(relPath))}` : ''
    const rows = entries
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map(e => {
        const next = path.posix.join('/', relPath || '', e.name)
        const href = `${MOUNT}${encodeURI(next)}`
        const download = `${MOUNT}/download${encodeURI(next)}`
        const icon = e.isDirectory() ? '📁' : '📄'
        const action = e.isDirectory()
          ? `<a href="${href}">打开</a>`
          : `<a href="${download}" download>下载</a>`
        return `<tr>
          <td>${icon}</td>
          <td><a href="${href}">${escapeHtml(e.name)}</a></td>
          <td>${e.isDirectory() ? '目录' : '文件'}</td>
          <td style="text-align:right">${action}</td>
        </tr>`
      }).join('\n')

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>文件浏览器 - ${escapeHtml(relPath || '/')}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font: 14px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; }
    .crumbs { margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #eee; }
    th { text-align: left; color: #666; font-weight: 600; }
    tr:hover { background: #fafafa; }
    .topbar { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
    .btn { display:inline-block; padding:6px 10px; border:1px solid #ddd; border-radius:8px; text-decoration:none; color:#333; }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="crumbs">${breadcrumbsHTML(relPath)}</div>
    ${relPath ? `<a class="btn" href="${upLink}">⬆上级</a>` : ''}
  </div>
  <table>
    <thead><tr><th style="width:36px">#</th><th>名称</th><th style="width:80px">类型</th><th style="width:120px;text-align:right">操作</th></tr></thead>
    <tbody>
      ${rows || `<tr><td></td><td colspan="3" style="color:#777">空目录</td></tr>`}
    </tbody>
  </table>
</body>
</html>`
  }

  const render404 = (url: string): string => {
  return `<!doctype html>
          <html lang="zh-CN">
          <head>
            <meta charset="utf-8">
            <title>404 Not Found</title>
            <style>
              body { font-family: sans-serif; background:#fafafa; text-align:center; padding:80px; }
              h1 { font-size: 48px; color:#d33; }
              p { margin-top: 20px; color:#555; }
              a { color:#06c; text-decoration:none; }
              a:hover { text-decoration:underline; }
            </style>
          </head>
          <body>
            <h1>404</h1>
            <p>路径不存在: <code>${url}</code></p>
            <p><a href="/files">返回首页</a></p>
          </body>
          </html>`
}

// 1) 浏览根目录：GET {MOUNT}
  ctx.server.get(MOUNT, async (koaCtx) => {
    const rel = '' // 根
    const abs = resolveSafe(rel)!
    try {
      const list = await fs.promises.readdir(abs, {withFileTypes: true})
      koaCtx.type = 'html'
      koaCtx.body = renderDir(rel, list)
    } catch (e) {
      logger.error(e)
      koaCtx.status = 500
      koaCtx.body = 'Failed to read root directory'
    }
  })

  // 3) 显式下载接口：GET {MOUNT}/download/(.*)
  ctx.server.get(`${MOUNT}/download/(.*)`, async (koaCtx) => {
    const rel = String(koaCtx.params[0] || '').replace(/^\/+/, '').replace(/\\/g, '/')
    const abs = resolveSafe(rel)
    if (!abs) {
      koaCtx.status = 400
      koaCtx.body = 'Invalid path'
      return
    }
    try {
      const stat = await fs.promises.stat(abs)
      if (!stat.isFile()) {
        koaCtx.status = 400
        koaCtx.body = 'Not a file'
        return
      }
      const base = path.basename(abs)
      koaCtx.set('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}"`)
      koaCtx.body = fs.createReadStream(abs)
      logger.info(`下载: /${rel}`)
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        koaCtx.status = 404
        koaCtx.body = 'Not found'
      } else {
        logger.error(e)
        koaCtx.status = 500
        koaCtx.body = 'Server error'
      }
    }
  })
  

// 2) 浏览子目录或文件：GET {MOUNT}/(.*)
  ctx.server.get(`${MOUNT}/(.*)`, async (koaCtx) => {
    const rel = String(koaCtx.params[0] || '').replace(/^\/+/, '').replace(/\\/g, '/')
    const abs = resolveSafe(rel)
    if (!abs) {
      koaCtx.status = 400
      koaCtx.body = 'Invalid path'
      return
    }

    try {
      const stat = await fs.promises.stat(abs)

      if (stat.isDirectory()) {
        const list = await fs.promises.readdir(abs, {withFileTypes: true})
        koaCtx.type = 'html'
        koaCtx.body = renderDir(rel, list)
        return
      }

      // 如果是文件，直接提示下载（也可以改为内联预览）
      const base = path.basename(abs)
      koaCtx.set('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}"`)
      koaCtx.body = fs.createReadStream(abs)
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        koaCtx.status = 404
        koaCtx.type = 'html'
        koaCtx.body = render404(koaCtx.url)
      } else {
        koaCtx.status = 500
        koaCtx.body = 'Server error'
      }
    }
  })
}
