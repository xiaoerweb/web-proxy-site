#!/bin/bash

echo "正在启动 ProxySite 免费网络代理服务..."
echo ""

# 检查Node.js是否已安装
if ! command -v node &> /dev/null; then
    echo "错误: 未找到Node.js，请先安装Node.js"
    echo "您可以从 https://nodejs.org/ 下载并安装"
    exit 1
fi

# 检查npm是否已安装
if ! command -v npm &> /dev/null; then
    echo "错误: 未找到npm，请确保Node.js正确安装"
    exit 1
fi

# 检查是否已安装依赖
if [ ! -d "node_modules" ]; then
    echo "首次运行，正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "安装依赖失败，请检查网络连接或手动运行 npm install"
        exit 1
    fi
fi

# 安装新增依赖
echo "正在安装新增依赖..."
npm install terser clean-css sharp compression --no-save
if [ $? -ne 0 ]; then
    echo "安装新增依赖失败，但将继续尝试启动服务"
    echo "如遇功能异常，请手动运行: npm install terser clean-css sharp compression"
fi

echo "依赖检查完成，正在启动服务..."
echo ""
echo "代理服务将在 http://localhost:3000 运行"
echo "请在浏览器中访问此地址"
echo ""
echo "按 Ctrl+C 可以停止服务"
echo ""

npm start 