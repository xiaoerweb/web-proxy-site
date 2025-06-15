const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const url = require('url');

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
app.get(['/static/*', '/*.js', '/*.css', '/*.json', '/*.png', '/*.jpg', '/*.jpeg', '/*.gif', '/*.svg', '/*.woff', '/*.woff2', '/*.ttf'], async (req, res) => {
    try {
        console.log(`处理资源请求: ${req.path}`);
        
        // 尝试从本地获取资源
        let localPath;
        if (req.path.startsWith('/static/')) {
            // 处理/static/路径下的资源
            localPath = path.join(__dirname, 'public', req.path.replace(/^\/static\//, ''));
        } else {
            // 处理根路径下的资源
            localPath = path.join(__dirname, 'public', req.path);
        }
        console.log(`尝试本地路径: ${localPath}`);
        
        // 检查文件是否存在
        try {
            if (require('fs').existsSync(localPath)) {
                console.log(`提供本地资源: ${localPath}`);
                return res.sendFile(localPath);
            }
        } catch (err) {
            console.error(`检查本地文件失败: ${err.message}`);
        }
        
        // 获取原始URL（从Referer或查询参数）
        let originalUrl = null;
        let baseUrl = null;
        
        // 从Referer中提取原始域名
        const referer = req.headers.referer;
        if (referer) {
            try {
                const refererUrl = new URL(referer);
                // 检查是否包含proxy参数
                const urlParams = new URLSearchParams(refererUrl.search);
                const proxyTarget = urlParams.get('url');
                if (proxyTarget) {
                    baseUrl = proxyTarget;
                }
            } catch (e) {
                console.error(`解析Referer失败: ${e.message}`);
            }
        }
        
        // 如果没有从Referer获取到，尝试从查询参数获取
        if (!baseUrl && req.query.baseUrl) {
            baseUrl = req.query.baseUrl;
        }
        
        // 如果有基础URL，构建完整的资源URL
        if (baseUrl) {
            try {
                // 解析基础URL
                const parsedBaseUrl = new URL(baseUrl);
                
                // 构建资源的完整URL
                let resourcePath = req.path;
                if (req.path.startsWith('/static/')) {
                    resourcePath = req.path.replace(/^\/static\//, '/');
                }
                
                originalUrl = new URL(resourcePath, parsedBaseUrl.origin).href;
                console.log(`构建资源URL: ${originalUrl}`);
            } catch (e) {
                console.error(`构建资源URL失败: ${e.message}`);
            }
        }
        
        // 如果有直接指定的原始URL，使用它
        if (req.query.originalUrl) {
            originalUrl = req.query.originalUrl;
        }
        
        // 如果有原始URL，尝试获取资源
        if (originalUrl) {
            try {
                console.log(`从源站获取资源: ${originalUrl}`);
                
                // 设置请求选项
                const requestOptions = {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                    headers: {
                        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
                        'Accept': '*/*',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    },
                    validateStatus: false,
                    // 忽略SSL证书验证
                    httpsAgent: new (require('https').Agent)({
                        rejectUnauthorized: false
                    })
                };
                
                // 如果提供了代理IP和端口，配置代理
                const proxyIp = req.query.proxyIp;
                const proxyPort = req.query.proxyPort;
                const proxyProtocol = req.query.proxyProtocol || 'http';
                
                if (proxyIp && proxyPort) {
                    console.log(`使用自定义代理获取资源: ${proxyProtocol}://${proxyIp}:${proxyPort}`);
                    
                    try {
                        // 使用tunnel代理
                        const tunnel = require('tunnel');
                        const parsedUrl = new URL(originalUrl);
                        
                        // 根据目标URL和代理协议选择合适的代理方法
                        if (parsedUrl.protocol === 'https:') {
                            if (proxyProtocol === 'http') {
                                requestOptions.httpsAgent = tunnel.httpsOverHttp({
                                    proxy: {
                                        host: proxyIp,
                                        port: parseInt(proxyPort, 10)
                                    },
                                    rejectUnauthorized: false
                                });
                            } else if (proxyProtocol === 'https') {
                                requestOptions.httpsAgent = tunnel.httpsOverHttps({
                                    proxy: {
                                        host: proxyIp,
                                        port: parseInt(proxyPort, 10),
                                        rejectUnauthorized: false
                                    },
                                    rejectUnauthorized: false
                                });
                            }
                        } else {
                            if (proxyProtocol === 'http') {
                                requestOptions.httpAgent = tunnel.httpOverHttp({
                                    proxy: {
                                        host: proxyIp,
                                        port: parseInt(proxyPort, 10)
                                    }
                                });
                            } else if (proxyProtocol === 'https') {
                                requestOptions.httpAgent = tunnel.httpOverHttps({
                                    proxy: {
                                        host: proxyIp,
                                        port: parseInt(proxyPort, 10),
                                        rejectUnauthorized: false
                                    }
                                });
                            }
                        }
                    } catch (proxyError) {
                        console.error('设置资源代理失败:', proxyError);
                    }
                }
                
                // 发送请求
                let response;
                try {
                    response = await axios.get(originalUrl, requestOptions);
                } catch (requestError) {
                    console.error('资源请求失败，尝试直接请求:', requestError.message);
                    
                    // 移除代理设置
                    delete requestOptions.httpAgent;
                    delete requestOptions.httpsAgent;
                    
                    // 重新设置HTTPS代理，但禁用证书验证
                    requestOptions.httpsAgent = new (require('https').Agent)({
                        rejectUnauthorized: false
                    });
                    
                    // 重试请求
                    response = await axios.get(originalUrl, requestOptions);
                }
                
                // 检查响应状态
                if (response.status !== 200) {
                    console.error(`源站返回非200状态码: ${response.status}`);
                    return res.status(response.status).send(`源站返回错误: ${response.status}`);
                }
                
                // 设置适当的内容类型
                const contentType = response.headers['content-type'];
                if (contentType) {
                    res.set('Content-Type', contentType);
                } else {
                    // 根据文件扩展名设置内容类型
                    const ext = path.extname(req.path).toLowerCase();
                    switch (ext) {
                        case '.js':
                            res.set('Content-Type', 'application/javascript');
                            break;
                        case '.css':
                            res.set('Content-Type', 'text/css');
                            break;
                        case '.json':
                            res.set('Content-Type', 'application/json');
                            break;
                        case '.png':
                            res.set('Content-Type', 'image/png');
                            break;
                        case '.jpg':
                        case '.jpeg':
                            res.set('Content-Type', 'image/jpeg');
                            break;
                        case '.gif':
                            res.set('Content-Type', 'image/gif');
                            break;
                        case '.svg':
                            res.set('Content-Type', 'image/svg+xml');
                            break;
                        case '.woff':
                            res.set('Content-Type', 'font/woff');
                            break;
                        case '.woff2':
                            res.set('Content-Type', 'font/woff2');
                            break;
                        case '.ttf':
                            res.set('Content-Type', 'font/ttf');
                            break;
                        default:
                            res.set('Content-Type', 'application/octet-stream');
                    }
                }
                
                // 设置CORS和缓存头
                res.set({
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Cache-Control': 'public, max-age=86400'
                });
                
                return res.send(response.data);
            } catch (fetchError) {
                console.error(`获取源站资源失败: ${fetchError.message}`);
                return res.status(502).send(`获取源站资源失败: ${fetchError.message}`);
            }
        }
        
        // 如果无法获取资源，返回404
        console.error(`资源未找到: ${req.path}`);
        res.status(404).send('资源未找到');
    } catch (error) {
        console.error(`资源请求处理失败: ${error.message}`);
        res.status(500).send('资源请求处理失败');
    }
});

// 代理请求处理
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    const proxyIp = req.query.proxyIp;
    const proxyPort = req.query.proxyPort;
    const proxyProtocol = req.query.proxyProtocol || 'http';
    
    if (!targetUrl) {
        return res.status(400).json({ error: '请提供目标URL' });
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
                // 重定向到正确的代理URL
                return res.redirect(`/proxy?url=${encodeURIComponent(actualTargetUrl)}`);
            }
        } catch (e) {
            console.error(`解析嵌套代理URL失败: ${e.message}`);
        }
    }
    
    try {
        // 解析目标URL
        const parsedUrl = new URL(targetUrl);
        
        // 设置请求选项
        const requestOptions = {
            timeout: 30000,
            headers: {
                // 随机选择User-Agent
                'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
                // 随机选择Referer
                'Referer': referers[Math.floor(Math.random() * referers.length)],
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'cross-site',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
                // 添加随机IP作为X-Forwarded-For
                'X-Forwarded-For': generateRandomIP(),
                // 添加随机时间戳
                'If-Modified-Since': new Date(generateRandomTimestamp()).toUTCString(),
                'DNT': '1',
                'Host': parsedUrl.host
            },
            validateStatus: false,
            maxRedirects: 5,
            responseType: 'arraybuffer',
            decompress: true,
            // 忽略SSL证书验证
            httpsAgent: new (require('https').Agent)({
                rejectUnauthorized: false
            })
        };

        // 如果提供了代理IP和端口，配置代理
        if (proxyIp && proxyPort) {
            console.log(`使用自定义代理: ${proxyProtocol}://${proxyIp}:${proxyPort}`);
            
            // 使用直接的代理配置方式
            try {
                // 使用tunnel代理
                const tunnel = require('tunnel');
                
                // 根据目标URL和代理协议选择合适的代理方法
                if (parsedUrl.protocol === 'https:') {
                    if (proxyProtocol === 'http') {
                        // HTTPS目标通过HTTP代理
                        requestOptions.httpsAgent = tunnel.httpsOverHttp({
                            proxy: {
                                host: proxyIp,
                                port: parseInt(proxyPort, 10)
                            },
                            rejectUnauthorized: false
                        });
                    } else if (proxyProtocol === 'https') {
                        // HTTPS目标通过HTTPS代理
                        requestOptions.httpsAgent = tunnel.httpsOverHttps({
                            proxy: {
                                host: proxyIp,
                                port: parseInt(proxyPort, 10),
                                rejectUnauthorized: false
                            },
                            rejectUnauthorized: false
                        });
                    }
                } else {
                    if (proxyProtocol === 'http') {
                        // HTTP目标通过HTTP代理
                        requestOptions.httpAgent = tunnel.httpOverHttp({
                            proxy: {
                                host: proxyIp,
                                port: parseInt(proxyPort, 10)
                            }
                        });
                    } else if (proxyProtocol === 'https') {
                        // HTTP目标通过HTTPS代理
                        requestOptions.httpAgent = tunnel.httpOverHttps({
                            proxy: {
                                host: proxyIp,
                                port: parseInt(proxyPort, 10),
                                rejectUnauthorized: false
                            }
                        });
                    }
                }
                
                // 添加代理相关头信息
                requestOptions.headers['Proxy-Connection'] = 'keep-alive';
                
                console.log(`代理设置完成: ${proxyProtocol}://${proxyIp}:${proxyPort} 目标: ${parsedUrl.protocol}//${parsedUrl.host}`);
            } catch (proxyError) {
                console.error('设置代理失败:', proxyError);
                // 如果代理设置失败，继续尝试不使用代理
            }
        }
        
        // 添加随机延迟 (减少延迟时间，避免请求超时)
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        
        console.log(`发送代理请求到: ${targetUrl}`);
        
        // 发送请求
        let response;
        try {
            response = await axios.get(targetUrl, requestOptions);
            console.log(`收到响应，状态码: ${response.status}, 内容类型: ${response.headers['content-type']}`);
        } catch (requestError) {
            // 如果请求失败，尝试不使用代理直接请求
            console.error('代理请求失败，尝试直接请求:', requestError.message);
            
            // 移除代理设置
            delete requestOptions.httpAgent;
            delete requestOptions.httpsAgent;
            
            // 重新设置HTTPS代理，但禁用证书验证
            requestOptions.httpsAgent = new (require('https').Agent)({
                rejectUnauthorized: false
            });
            
            // 重试请求
            try {
                response = await axios.get(targetUrl, requestOptions);
                console.log(`直接请求成功，状态码: ${response.status}`);
            } catch (retryError) {
                throw new Error(`代理和直接请求都失败: ${retryError.message}`);
            }
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
            'Feature-Policy': "microphone 'none'; camera 'none'",
            'Permissions-Policy': "microphone=(), camera=()",
            // 随机生成ETag
            'ETag': `"${Math.random().toString(36).substring(7)}"`,
            // 设置缓存控制
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        // 获取内容类型
        let contentType = response.headers['content-type'] || 'text/html';
        res.set('Content-Type', contentType);
        
        // 直接返回响应数据，不做任何处理
        return res.send(response.data);
        
    } catch (error) {
        console.error(`代理请求失败: ${error.message}`);
        return res.status(502).send(`代理请求失败: ${error.message}`);
    }
});

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
