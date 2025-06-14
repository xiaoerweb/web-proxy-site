# ProxySite 免费网络代理

这是一个功能强大的网页代理服务器，可以帮助您访问被限制的网站或绕过某些网络限制。

## 功能特点

- 支持通过代理访问网页内容
- 自动获取并使用代理IP池，提高匿名性
- 提供两种查看模式：内嵌模式和新标签页模式
- 现代美观的用户界面
- 支持CORS，解决跨域问题
- 高级设置选项，可自定义请求头

### 新增功能

- **国家/地区选择**: 可以选择特定国家/地区的代理服务器
- **内容过滤**: 自动过滤广告、跟踪器和敏感内容
- **网页优化**: 压缩图片、CSS和JavaScript，提升加载速度
- **安全提示**: 可选择显示安全浏览提示
- **资源代理**: 优化外部资源加载，减少跨域问题

## 安装步骤

1. 确保已安装Node.js（建议v14.0.0或更高版本）

2. 克隆或下载本项目

3. 安装依赖
```
npm install
```

4. 启动服务器
```
npm start
```

5. 在浏览器中访问 http://localhost:3000

## 使用方法

1. 在输入框中输入您想要访问的网址（包括http://或https://）
2. 选择是否使用代理IP（默认开启）
3. 可选择特定国家/地区的代理服务器
4. 根据需要启用或禁用内容过滤和性能优化功能
5. 点击"浏览网页"按钮以在内嵌框架中显示网页内容
6. 或者点击"直接访问"按钮以在新标签页中打开网页

## 高级功能

- **IP代理池**: 自动获取并使用多个代理IP，提高匿名性和访问成功率
- **国家/地区选择**: 可以选择特定国家/地区的代理服务器
- **广告过滤**: 自动移除网页中的广告元素
- **跟踪器阻止**: 阻止常见的网络跟踪器和分析脚本
- **敏感内容过滤**: 自动过滤网页中的敏感词汇
- **图片优化**: 自动压缩图片，减少加载时间
- **代码压缩**: 压缩CSS和JavaScript代码，提高加载速度
- **延迟加载**: 图片延迟加载，提升页面渲染速度
- **自定义请求头**: 可以在高级设置中自定义User-Agent和其他HTTP请求头
- **代理统计**: 显示可用代理数量和地理位置分布

## 技术栈

- Node.js
- Express.js
- http-proxy-middleware
- axios
- node-cache
- cheerio
- sharp (图片优化)
- terser (JavaScript压缩)
- clean-css (CSS压缩)
- HTML/CSS/JavaScript

## 注意事项

- 此代理服务仅供学习和研究使用
- 某些网站可能有反代理措施，可能无法正常工作
- 不要使用此工具进行任何违法活动
- 代理IP来源于公共API，可能不稳定，建议在生产环境中使用付费代理服务 