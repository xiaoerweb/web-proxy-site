const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const url = require('url');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 启用CORS，添加更多选项
app.use(cors({
    origin: function(origin, callback) {
        // 允许所有域名访问
        callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Disposition']
}));

// 添加安全头
app.use((req, res, next) => {
    // 允许在iframe中加载
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // 允许跨域资源共享
    res.setHeader('Access-Control-Allow-Origin', '*');
    // 允许跨域携带凭证
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // 允许的请求方法
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    // 允许的请求头
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept,Origin');
    next();
});

// 解析请求体
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 添加随机User-Agent生成器
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36'
];

// 添加随机Referer生成器
const referers = [
    'https://www.google.com/',
    'https://www.bing.com/',
    'https://www.baidu.com/',
    'https://www.yahoo.com/',
    'https://duckduckgo.com/'
];

// 生成随机IP
function generateRandomIP() {
    return Array.from({length: 4}, () => Math.floor(Math.random() * 256)).join('.');
}

// 生成随机时间戳
function generateRandomTimestamp() {
    const now = Date.now();
    return now - Math.floor(Math.random() * 86400000); // 随机减去0-24小时的毫秒数
}

// 提供静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 处理静态资源请求
app.get('/static/*', async (req, res) => {
    try {
        console.log(`处理静态资源请求: ${req.path}`);
        
        // 构建目标资源的完整URL
        const resourceUrl = `https://49118.vip${req.path}`;
        console.log('构建资源URL:', resourceUrl);
        
        // 直接发送代理请求
        try {
            const response = await axios.get(resourceUrl, {
                responseType: 'arraybuffer',
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Referer': 'https://49118.vip/'
                }
            });

            // 设置响应头
            const ext = path.extname(req.path).toLowerCase();
            let contentType = response.headers['content-type'];

            // 根据文件扩展名设置正确的Content-Type
            if (!contentType || ext === '.js' || ext === '.css') {
                switch (ext) {
                    case '.js':
                        contentType = 'application/javascript';
                        break;
                    case '.css':
                        contentType = 'text/css';
                        break;
                    default:
                        contentType = 'application/octet-stream';
                }
            }

            res.set('Content-Type', contentType);
            res.set('Cache-Control', 'public, max-age=31536000');
            
            // 直接返回内容，不做任何处理
            return res.send(response.data);
            
        } catch (error) {
            console.error('获取资源失败:', error);
            res.status(500).send('获取资源失败');
        }
    } catch (error) {
        console.error('处理静态资源请求失败:', error);
        res.status(500).send('服务器错误');
    }
});

// 添加对根路径下的JS、CSS和其他静态资源的处理
app.get('/*.js', handleDirectResourceRequest);
app.get('/*.css', handleDirectResourceRequest);
app.get('/*.json', handleDirectResourceRequest);
app.get('/*.png', handleDirectResourceRequest);
app.get('/*.jpg', handleDirectResourceRequest);
app.get('/*.jpeg', handleDirectResourceRequest);
app.get('/*.gif', handleDirectResourceRequest);
app.get('/*.svg', handleDirectResourceRequest);
app.get('/*.woff', handleDirectResourceRequest);
app.get('/*.woff2', handleDirectResourceRequest);
app.get('/*.ttf', handleDirectResourceRequest);

// 处理直接资源请求的函数
async function handleDirectResourceRequest(req, res) {
    try {
        console.log(`处理直接资源请求: ${req.path}`);
        
        // 从Referer中提取原始URL
        const referer = req.headers.referer;
        let baseUrl = null;
        
        if (referer) {
            try {
                const refererUrl = new URL(referer);
                if (refererUrl.pathname === '/proxy') {
                    const urlParams = new URLSearchParams(refererUrl.search);
                    baseUrl = urlParams.get('url');
                }
            } catch (e) {
                console.error(`解析Referer失败: ${e.message}`);
            }
        }
        
        if (baseUrl) {
            try {
                const parsedBaseUrl = new URL(baseUrl);
                // 构建资源的完整URL
                const resourceUrl = new URL(req.path, parsedBaseUrl.origin).href;
                
                console.log(`从源站获取资源: ${resourceUrl}`);
                const response = await axios.get(resourceUrl, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    },
                    validateStatus: false
                });
                
                if (response.status !== 200) {
                    console.error(`源站返回非200状态码: ${response.status}`);
                    return res.status(response.status).send(`源站返回错误: ${response.status}`);
                }
                
                // 设置适当的内容类型
                const ext = path.extname(req.path).toLowerCase();
                let contentType = response.headers['content-type'];
                
                // 根据文件扩展名设置内容类型
                if (!contentType || ext === '.js' || ext === '.css') {
                    switch (ext) {
                        case '.js':
                            contentType = 'application/javascript';
                            break;
                        case '.css':
                            contentType = 'text/css';
                            break;
                        case '.json':
                            contentType = 'application/json';
                            break;
                        case '.png':
                            contentType = 'image/png';
                            break;
                        case '.jpg':
                        case '.jpeg':
                            contentType = 'image/jpeg';
                            break;
                        case '.gif':
                            contentType = 'image/gif';
                            break;
                        case '.svg':
                            contentType = 'image/svg+xml';
                            break;
                        case '.woff':
                            contentType = 'font/woff';
                            break;
                        case '.woff2':
                            contentType = 'font/woff2';
                            break;
                        case '.ttf':
                            contentType = 'font/ttf';
                            break;
                        default:
                            contentType = 'application/octet-stream';
                    }
                }
                
                // 设置响应头
                res.set('Content-Type', contentType);
                res.set('Cache-Control', 'public, max-age=31536000');
                
                return res.send(response.data);
            } catch (fetchError) {
                console.error(`获取源站资源失败: ${fetchError.message}`);
                return res.status(502).send(`获取源站资源失败: ${fetchError.message}`);
            }
        }
        
        // 如果无法获取资源，返回404
        res.status(404).send('资源未找到');
    } catch (error) {
        console.error(`资源请求处理失败: ${error.message}`);
        res.status(500).send('资源请求处理失败');
    }
}

// 处理代理请求 - GET
app.get('/proxy', async (req, res) => {
    await handleProxyRequest(req, res);
});

// 处理代理请求 - POST
app.post('/proxy', async (req, res) => {
    await handleProxyRequest(req, res);
});

// 处理代理请求 - OPTIONS (CORS预检请求)
app.options('/proxy', (req, res) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400' // 24小时
    });
    res.status(200).end();
});

// 统一处理代理请求的函数
async function handleProxyRequest(req, res) {
    const targetUrl = req.query.url;
    const tryPaths = req.query.tryPaths ? JSON.parse(decodeURIComponent(req.query.tryPaths)) : null;
    const proxyIp = req.query.proxyIp;
    const proxyPort = req.query.proxyPort;
    const proxyProtocol = req.query.proxyProtocol || 'http';
    
    if (!targetUrl) {
        return res.status(400).json({ error: '请提供目标URL' });
    }
    
    console.log(`处理${req.method}代理请求: ${targetUrl}`);
    if (tryPaths) {
        console.log(`将尝试以下路径: ${JSON.stringify(tryPaths)}`);
    }
    
    // 检查是否是对原始网站代理路径的请求
    if (targetUrl.includes('/proxy?url=')) {
        console.log(`检测到嵌套代理请求: ${targetUrl}`);
        try {
            // 提取真正的目标URL
            const nestedUrl = new URL(targetUrl);
            const actualTargetUrl = nestedUrl.searchParams.get('url');
            if (actualTargetUrl) {
                console.log(`重定向到实际目标URL: ${actualTargetUrl}`);
                // 重定向到正确的代理URL，保留tryPaths参数
                const redirectUrl = `/proxy?url=${encodeURIComponent(actualTargetUrl)}${tryPaths ? `&tryPaths=${encodeURIComponent(JSON.stringify(tryPaths))}` : ''}`;
                return res.redirect(redirectUrl);
            }
        } catch (e) {
            console.error(`解析嵌套代理URL失败: ${e.message}`);
        }
    }
    
    try {
        // 解析目标URL
        const parsedUrl = new URL(targetUrl);
        const baseUrl = parsedUrl.origin;
        
        // 设置请求选项
        const requestOptions = {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Host': parsedUrl.host,
                'Connection': 'keep-alive',
                'Referer': baseUrl
            },
            validateStatus: function (status) {
                return status >= 200 && status < 600; // 接受所有状态码
            },
            maxRedirects: 5,
            responseType: 'arraybuffer',
            decompress: true,
            // 忽略SSL证书验证
            httpsAgent: new (require('https').Agent)({
                rejectUnauthorized: false
            }),
            // 允许自动重定向
            followRedirects: true,
            maxBodyLength: 20 * 1024 * 1024, // 20MB
            maxContentLength: 20 * 1024 * 1024 // 20MB
        };

        // 如果提供了代理IP和端口，配置代理
        if (proxyIp && proxyPort) {
            console.log(`使用自定义代理: ${proxyProtocol}://${proxyIp}:${proxyPort}`);
            
            // 使用tunnel代理
            const tunnel = require('tunnel');
            const agent = proxyProtocol === 'https' 
                ? tunnel.httpsOverHttps({
                    proxy: {
                        host: proxyIp,
                        port: parseInt(proxyPort),
                        rejectUnauthorized: false
                    }
                })
                : tunnel.httpsOverHttp({
                    proxy: {
                        host: proxyIp,
                        port: parseInt(proxyPort)
                    }
                });
            
            requestOptions.httpsAgent = agent;
            requestOptions.agent = agent;
        }

        // 发送请求
        let response;
        let success = false;
        let error;
        
        // 如果有tryPaths，依次尝试所有路径
        const pathsToTry = tryPaths || [targetUrl];
        
        for (const path of pathsToTry) {
            try {
                console.log(`尝试请求路径: ${path}`);
                
                // 根据原始请求的方法选择相应的请求方法
                if (req.method === 'POST') {
                    // 如果是POST请求，转发请求体
                    response = await axios.post(path, req.body, requestOptions);
                } else {
                    // 默认使用GET请求
                    response = await axios.get(path, requestOptions);
                }
                
                // 检查响应是否有效
                if (response.status === 200 && response.data && response.data.length > 0) {
                    console.log(`成功获取资源: ${path}`);
                    success = true;
                    break;
                } else {
                    console.log(`路径 ${path} 返回无效响应，状态码: ${response.status}, 数据长度: ${response.data ? response.data.length : 0}`);
                }
            } catch (e) {
                console.error(`请求路径 ${path} 失败:`, e.message);
                error = e;
                
                // 如果是404错误，尝试其他路径
                if (e.response && e.response.status === 404) {
                    continue;
                }
                
                // 如果是其他错误，检查是否需要继续尝试
                if (!e.response || (e.response.status !== 404 && e.response.status !== 403)) {
                    break;
                }
            }
        }
        
        if (!success) {
            throw error || new Error('所有路径尝试均失败');
        }
        
        // 设置响应头
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Credentials': 'true',
            'X-Frame-Options': 'SAMEORIGIN',
            'X-Content-Type-Options': 'nosniff',
            'X-XSS-Protection': '1; mode=block',
            'Referrer-Policy': 'no-referrer',
            'Permissions-Policy': "microphone=(), camera=()",
            'Cache-Control': 'public, max-age=31536000'
        });

        // 获取内容类型和文件扩展名
        const ext = path.extname(parsedUrl.pathname).toLowerCase();
        let defaultContentType = 'text/html';
        
        // 根据文件扩展名设置正确的Content-Type
        switch (ext) {
            case '.js':
                defaultContentType = 'application/javascript';
                break;
            case '.css':
                defaultContentType = 'text/css';
                break;
            case '.json':
                defaultContentType = 'application/json';
                break;
            case '.png':
                defaultContentType = 'image/png';
                break;
            case '.jpg':
            case '.jpeg':
                defaultContentType = 'image/jpeg';
                break;
            case '.gif':
                defaultContentType = 'image/gif';
                break;
            case '.svg':
                defaultContentType = 'image/svg+xml';
                break;
            case '.woff':
                defaultContentType = 'font/woff';
                break;
            case '.woff2':
                defaultContentType = 'font/woff2';
                break;
            case '.ttf':
                defaultContentType = 'font/ttf';
                break;
        }
        
        // 设置Content-Type，优先使用文件扩展名判断的类型
        let contentType = defaultContentType;
        if (response.headers['content-type']) {
            // 如果响应头中有Content-Type，使用它，除非是JavaScript或CSS文件
            if (ext === '.js' || parsedUrl.pathname.includes('.js')) {
                contentType = 'application/javascript';
            } else if (ext === '.css' || parsedUrl.pathname.includes('.css')) {
                contentType = 'text/css';
            } else {
                contentType = response.headers['content-type'].split(';')[0];
            }
        }
        
        // 强制设置JavaScript和CSS的Content-Type
        if (parsedUrl.pathname.includes('.js') || targetUrl.includes('.js')) {
            contentType = 'application/javascript';
        } else if (parsedUrl.pathname.includes('.css') || targetUrl.includes('.css')) {
            contentType = 'text/css';
        }
        
        res.set('Content-Type', contentType);
        console.log(`设置Content-Type: ${contentType}`);
        
        // 如果是HTML内容，修改资源链接
        if (contentType.includes('text/html')) {
            let html = response.data.toString('utf-8');
            
            // 移除现有的base标签
            html = html.replace(/<base[^>]*>/g, '');
            
            // 注入我们的base标签和一些必要的修复
            const injectScript = `
                <script>
                    // 修复资源加载路径
                    window.__ORIGINAL_URL__ = "${targetUrl}";
                    window.__PROXY_BASE__ = "/proxy?url=";
                    
                    // 修复资源加载
                    const originalCreateElement = document.createElement;
                    document.createElement = function(tagName) {
                        const element = originalCreateElement.call(document, tagName);
                        if (tagName.toLowerCase() === 'script' || tagName.toLowerCase() === 'link') {
                            const originalSetAttribute = element.setAttribute;
                            element.setAttribute = function(name, value) {
                                if ((name === 'src' || name === 'href') && value && !value.startsWith('data:') && !value.startsWith('blob:') && !value.startsWith('/proxy?url=')) {
                                    let absoluteUrl;
                                    try {
                                        absoluteUrl = new URL(value, window.__ORIGINAL_URL__).href;
                                        value = window.__PROXY_BASE__ + encodeURIComponent(absoluteUrl);
                                    } catch (e) {
                                        console.warn('Failed to process URL:', value, e);
                                    }
                                }
                                return originalSetAttribute.call(this, name, value);
                            };
                        }
                        return element;
                    };

                    // 修复Service Worker注册
                    if (navigator.serviceWorker) {
                        navigator.serviceWorker.register = function() {
                            return Promise.resolve();
                        };
                    }
                    
                    // 修复LA未定义错误
                    if (typeof LA === 'undefined') {
                        window.LA = {
                            init: function() {},
                            config: function() {}
                        };
                    }
                    
                    // 修复require未定义错误
                    if (typeof require === 'undefined') {
                        window.require = function() {
                            console.warn('require is not supported in browser');
                            return {};
                        };
                    }
                    
                    // 修复fetch请求
                    const originalFetch = window.fetch;
                    window.fetch = function(url, options) {
                        if (typeof url === 'string') {
                            if (!url.startsWith('/proxy?url=') && !url.startsWith('data:') && !url.startsWith('blob:')) {
                                try {
                                    const absoluteUrl = new URL(url, window.__ORIGINAL_URL__).href;
                                    url = '/proxy?url=' + encodeURIComponent(absoluteUrl);
                                } catch (e) {
                                    console.warn('Failed to process fetch URL:', url, e);
                                }
                            }
                        }
                        return originalFetch(url, options);
                    };
                    
                    // 修复XMLHttpRequest
                    const originalXHROpen = XMLHttpRequest.prototype.open;
                    XMLHttpRequest.prototype.open = function(method, url, ...args) {
                        if (typeof url === 'string' && !url.startsWith('/proxy?url=') && !url.startsWith('data:') && !url.startsWith('blob:')) {
                            try {
                                const absoluteUrl = new URL(url, window.__ORIGINAL_URL__).href;
                                url = '/proxy?url=' + encodeURIComponent(absoluteUrl);
                            } catch (e) {
                                console.warn('Failed to process XHR URL:', url, e);
                            }
                        }
                        return originalXHROpen.call(this, method, url, ...args);
                    };
                    
                    // 修复静态资源加载
                    function fixStaticResourcePaths() {
                        // 修复所有script标签
                        document.querySelectorAll('script[src]').forEach(script => {
                            if (!script.src.startsWith('data:') && !script.src.startsWith('blob:') && !script.src.includes('/proxy?url=')) {
                                try {
                                    const absoluteUrl = new URL(script.getAttribute('src'), window.__ORIGINAL_URL__).href;
                                    script.setAttribute('src', '/proxy?url=' + encodeURIComponent(absoluteUrl));
                                } catch (e) {
                                    console.warn('Failed to process script src:', script.src, e);
                                }
                            }
                        });
                        
                        // 修复所有link标签
                        document.querySelectorAll('link[href]').forEach(link => {
                            if (!link.href.startsWith('data:') && !link.href.startsWith('blob:') && !link.href.includes('/proxy?url=')) {
                                try {
                                    const absoluteUrl = new URL(link.getAttribute('href'), window.__ORIGINAL_URL__).href;
                                    link.setAttribute('href', '/proxy?url=' + encodeURIComponent(absoluteUrl));
                                } catch (e) {
                                    console.warn('Failed to process link href:', link.href, e);
                                }
                            }
                        });
                        
                        // 修复所有img标签
                        document.querySelectorAll('img[src]').forEach(img => {
                            if (!img.src.startsWith('data:') && !img.src.startsWith('blob:') && !img.src.includes('/proxy?url=')) {
                                try {
                                    const absoluteUrl = new URL(img.getAttribute('src'), window.__ORIGINAL_URL__).href;
                                    img.setAttribute('src', '/proxy?url=' + encodeURIComponent(absoluteUrl));
                                } catch (e) {
                                    console.warn('Failed to process img src:', img.src, e);
                                }
                            }
                        });
                    }
                    
                    // 在DOM加载完成后执行修复
                    document.addEventListener('DOMContentLoaded', fixStaticResourcePaths);
                    
                    // 对于动态加载的内容，定期检查并修复
                    setInterval(fixStaticResourcePaths, 1000);
                    
                    // 立即执行一次修复
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', fixStaticResourcePaths);
                    } else {
                        fixStaticResourcePaths();
                    }
                </script>
            `;
            
            // 替换所有CSS链接
            html = html.replace(/<link[^>]*href=["']([^"']+)["'][^>]*>/g, (match, url) => {
                try {
                    if (url.startsWith('/proxy?url=') || url.startsWith('data:') || url.startsWith('blob:')) {
                        return match;
                    }
                    const absoluteUrl = new URL(url, targetUrl).href;
                    return match.replace(url, `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
                } catch (e) {
                    console.warn('Failed to process URL:', url, e);
                    return match;
                }
            });
            
            // 替换所有JS链接
            html = html.replace(/<script[^>]*src=["']([^"']+)["'][^>]*>/g, (match, url) => {
                try {
                    if (url.startsWith('/proxy?url=') || url.startsWith('data:') || url.startsWith('blob:')) {
                        return match;
                    }
                    const absoluteUrl = new URL(url, targetUrl).href;
                    return match.replace(url, `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
                } catch (e) {
                    console.warn('Failed to process URL:', url, e);
                    return match;
                }
            });
            
            // 替换所有相对路径的资源链接
            html = html.replace(/(src|href)=["'](?!http|\/\/|data:|blob:|\/proxy\?url=)([^"']+)["']/g, (match, attr, url) => {
                try {
                    const absoluteUrl = new URL(url, targetUrl).href;
                    return `${attr}="/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
                } catch (e) {
                    console.warn('Failed to process URL:', url, e);
                    return match;
                }
            });
            
            // 替换所有绝对路径的资源链接
            html = html.replace(/(src|href)=["'](https?:\/\/[^"']+)["']/g, (match, attr, url) => {
                if (url.includes('/proxy?url=')) return match;
                return `${attr}="/proxy?url=${encodeURIComponent(url)}"`;
            });
            
            // 替换内联样式中的URL
            html = html.replace(/url\(['"]?(?!data:|blob:|\/proxy\?url=)([^'"')]+)['"]?\)/g, (match, url) => {
                if (url.includes('/proxy?url=')) return match;
                try {
                    const absoluteUrl = new URL(url, targetUrl).href;
                    return `url("/proxy?url=${encodeURIComponent(absoluteUrl)}")`;
                } catch (e) {
                    console.warn('Failed to process URL:', url, e);
                    return match;
                }
            });
            
            // 在HTML顶部注入脚本
            html = html.replace('</head>', injectScript + '</head>');
            
            // 如果没有</head>标签，则在<body>之前注入
            if (!html.includes('</head>')) {
                html = html.replace('<body', injectScript + '<body');
            }
            
            // 如果既没有</head>也没有<body>标签，则在HTML开头注入
            if (!html.includes('</head>') && !html.includes('<body')) {
                html = injectScript + html;
            }
            
            // 打印处理后的HTML以便调试
            console.log('处理后的HTML:', html);
            
            return res.send(html);
        } else if (contentType.includes('javascript') || contentType.includes('application/x-javascript') || 
            contentType.includes('text/javascript') || targetUrl.endsWith('.js')) {
            // 处理JavaScript文件
            try {
                // 直接返回原始内容，不做任何处理
                res.set('Content-Type', 'application/javascript; charset=utf-8');
                return res.send(response.data);
            } catch (e) {
                console.error('处理JavaScript文件失败:', e);
                // 出错时返回原始内容
                return res.send(response.data);
            }
        } else if (contentType.includes('css') || ext === '.css' || parsedUrl.pathname.includes('.css')) {
            // 处理CSS文件
            let css = response.data.toString('utf-8');
            
            // 替换CSS中的URL
            css = css.replace(/url\(['"]?([^'"())]+)['"]?\)/g, (match, url) => {
                try {
                    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/proxy?url=')) {
                        return match;
                    }
                    const absoluteUrl = new URL(url, targetUrl).href;
                    return `url("/proxy?url=${encodeURIComponent(absoluteUrl)}")`;
                } catch (e) {
                    return match;
                }
            });
            
            return res.send(css);
        } else if (contentType.includes('json')) {
            // 处理JSON响应
            try {
                // 尝试解析JSON并返回
                const jsonData = JSON.parse(response.data.toString('utf-8'));
                return res.json(jsonData);
            } catch (e) {
                console.error('处理JSON数据失败:', e);
                // 如果解析失败，返回原始内容
                return res.send(response.data);
            }
        }
        
        // 对于非HTML/JS/CSS/JSON内容，直接返回
        return res.send(response.data);
        
    } catch (error) {
        console.error(`代理请求失败: ${error.message}`);
        return res.status(502).send(`代理请求失败: ${error.message}`);
    }
}

// 健康检查端点
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: '服务正常运行' });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});

// 生成会话ID
function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
} 
