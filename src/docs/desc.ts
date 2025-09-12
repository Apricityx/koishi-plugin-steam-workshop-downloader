import {pic2} from "./pic";
import {pic1} from "./pic";

export const descriptionHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>steam-workshop-downloader 插件使用指南</title>
</head>
<body>
  <h2>效果展示</h2>
  <button
  id="toggleBtn"
  class="el-button"
  onclick="document.getElementById('toggleBtn').textContent = document.getElementById('toggleBtn').textContent === '隐藏图片' ? '显示图片' : '隐藏图片';
            document.getElementById('pics').style.display = document.getElementById('toggleBtn').textContent === '隐藏图片' ? 'block' : 'none';"
           >
    显示图片
  </button>
  <div id="pics" style="display: none; ">
    <img src="${pic1}" alt="logo" style="width: 100%;" />
    <img src="${pic2}" alt="logo" style="width: 100%;" />
  </div>
  <h2>部署说明</h2>
    <p>受steamcmd的限制，本插件只能在Linux+支持32位steamcmd的环境下运行 (Koishi的官方docker镜像无法使用steamcmd)</p>
    <p>插件有两种工作模式，分别为Koishi有公网环境和无公网环境，有公网环境下环境限制较为宽松，无公网相对复杂</p>
    <h3>公网模式</h3>
    <p>公网模式填写koishi的公网地址与端口即可</p>
    <h3>无公网模式</h3>
    <p>无公网模式下需要打开最下方的启用无公网传输功能，并且填写file_directory</p>
    <p>file_directory的值必须是bot端和koishi端通过这个地址都能访问到koishi主文件夹，即为koishi.yml所在目录</p>
   <h2>帮助</h2>
    <p>遇到部署问题可以找我帮忙部署，联系方式：</p>
    <p>Email：apricityx@qq.com</p>
    <p>Github: <a>https://github.com/Apricityx/koishi-plugin-steam-workshop-downloader</a></p>
    <p>QQ: 3026194904</p>
    <p>欢迎提Issue与PR</p>
</body>
</html>


`
