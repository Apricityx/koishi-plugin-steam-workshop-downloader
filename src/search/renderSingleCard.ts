import { PublishedFileDetails } from "../types/steam_info_types"
import { escapeHtml, formatFileSizeMB, formatUpdateTime } from "./renderUtils"

interface SingleData extends PublishedFileDetails {
  description: string
}

export const renderSingleCardPage = (item: SingleData): string => {
  const title = escapeHtml(item.title)
  const desc  = escapeHtml(item.description || "无简介")
  const img   = escapeHtml(item.preview_url || "")
  const size  = escapeHtml(formatFileSizeMB(item.file_size))
  const time  = escapeHtml(formatUpdateTime(item.time_updated))

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>卡片</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    html { margin: 0; padding: 0; }
    body { margin: 0; padding: 0; }
    #main_cont {
      width: 500px;
      height: 700px;
      border: 1px solid #000;
      box-sizing: border-box;
      background: #1f1f1f;
      position: relative;
      overflow: hidden;
      font-family: Arial, sans-serif;
    }
    #picture_cont {
      height: 400px;
      width: 400px;
      overflow: hidden;
      border-radius: 10px;
      position: absolute;
      top: 10px;
      left: 50px;
    }
    #title {
      position: absolute;
      top: 420px;
      left: 50px;
      font-size: 24px;
      color: #e0e0e0;
      font-weight: bold;
    }
    .chip {
      display: inline-block;
      background: #2d2d2d;
      color: #fafafa;
      border-radius: 16px;
      padding: 6px 16px;
      font-size: 10px;
      margin-right: 8px;
      margin-bottom: 8px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      font-weight: 500;
      letter-spacing: 0.5px;
      vertical-align: middle;
      user-select: none;
    }
    #chips {
      position: absolute;
      top: 460px;
      left: 50px;
      display: flex;
      flex-direction: row;
    }
    #description {
      position: absolute;
      height: 180px;
      top: 500px;
      left: 50px;
      width: 400px;
      color: #ccc;
      font-size: 14px;
      line-height: 20px;
      overflow: hidden;
    }
  </style>
</head>
<body>
<div id="main_cont">
  <div id="picture_cont">
    ${img
    ? `<img src="${img}" alt="${title}" style="height: 100%; width: 100%; object-fit: cover;"/>`
    : `<div style="height:100%;width:100%;display:flex;align-items:center;justify-content:center;color:#aaa;">无图</div>`}
  </div>
  <div id="title">${title}</div>
  <div id="chips">
    <div class="chip">更新时间：${time}</div>
    <div class="chip">文件大小：${size}</div>
  </div>
  <div id="description">${desc}</div>
</div>
</body>
</html>`
}
