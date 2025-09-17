// ===== 工具函数：HTML 转义，避免 <script> 等注入 =====
import {PublishedFileDetails} from "../types/steam_info_types";

function escapeHtml(input: any): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ===== 工具函数：字节 -> MB 字符串 =====
function formatFileSizeMB(bytes?: string | number): string {
  if (bytes == null || isNaN(Number(bytes))) return '—'
  const mb = Number(bytes) / 1024 / 1024
  return `${mb.toFixed(2)} MB`
}

// ===== 工具函数：Unix 秒 -> 本地时间字符串 =====
function formatUpdateTime(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return '—'
  const d = new Date(sec * 1000)
  // 直接用本地化输出；如需日语/时区可传 locales、options
  // 参考：Date.prototype.toLocaleString()。:contentReference[oaicite:1]{index=1}
  return d.toLocaleString()
}

// ===== 主函数：渲染整页 HTML（深色调、左图右文、纵向列表） =====
export const renderCardListPage = (items: PublishedFileDetails[]): string => {
  const cards = items.map((it) => {
    const title = escapeHtml(it.title)
    const desc = escapeHtml(it.file_description || '无简介')
    const img = escapeHtml(it.preview_url || '')
    const size = escapeHtml(formatFileSizeMB(it.file_size))
    const time = escapeHtml(formatUpdateTime(it.time_updated))

    const mediaHtml = img
      ? `<img src="${img}" alt="${title}">`
      : `<div class="card__placeholder">无图</div>`

    return `
      <div class="card">
        <div class="card__media">
          ${mediaHtml}
        </div>
        <div class="card__body">
          <h3 class="card__title">${title}</h3>
          <p class="card__text">${desc}</p>
          <div class="card__chips">
            <div class="chip">更新时间: ${time}</div>
            <div class="chip">文件大小: ${size}</div>
          </div>
        </div>
      </div>
    `
  }).join('')

  // 整页 HTML（深色 + 左图右文 + chips）
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>卡片列表</title>
<style>
  body {
    margin: 0;
    padding: 0;
    background-color: #121212;
    color: #e0e0e0;
    font-family: Arial, sans-serif;
  }
  .container {
    max-width: 640px;
      padding: 5px;
    box-sizing: border-box;
  }
  .card {
    display: flex;
    flex-direction: row;              /* 左图右文（Flex 一维布局） */
    background-color: #1f1f1f;
    border: 1px solid #333;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 24px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.5);
  }
  .card__media {
    width: 160px;                     /* 缩小图片尺寸，方形 */
    height: 160px;
    background-color: #2a2a2a;
    overflow: hidden;
    flex-shrink: 0;
  }
  .card__media img {
    width: 100%;
    height: 100%;
    object-fit: cover;                /* 裁剪填充，不拉伸变形 */ /* MDN: object-fit */ /* :contentReference[oaicite:2]{index=2} */
    display: block;
  }
  .card__placeholder {
    width: 100%;
    height: 100%;
    background: repeating-linear-gradient(
      45deg, #2d2d2d, #2d2d2d 8px, #303030 8px, #303030 16px
    );
    color: #aaa;
    font-size: 12px;
    line-height: 160px;               /* 与高度一致，简易占位 */
    text-align: center;
  }
  .card__body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }
  .card__title {
    font-size: 18px;
    line-height: 26px;
    margin: 0;
    color: #ffffff;
    max-height: 52px;                 /* 最多 2 行 */
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .card__text {
    font-size: 14px;
    line-height: 22px;
    color: #cccccc;
    margin-top: 10px;
    overflow: hidden;
    max-height: 88px;                 /* 最多 4 行 */
  }
  .card__chips {
    margin-top: 12px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .chip {
    display: inline-block;
    padding: 2px 8px;
    font-size: 12px;
    line-height: 16px;
    color: #ccc;
    background-color: #2e2e2e;
    border-radius: 12px;
    border: 1px solid #444;
  }
</style>
</head>
<body>
  <div class="container">
    ${cards}
  </div>
</body>
</html>`
}
