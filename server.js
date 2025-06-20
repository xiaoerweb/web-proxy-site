const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const url = require('url');
const https = require('https');
const tls = require('tls');

const app = express();
const PORT = process.env.PORT || 3000;

// 保存最后一次成功的代理URL
global.lastProxyUrl = null;

// 允许访问的域名列表
const ALLOWED_DOMAINS = [
    'localhost',
    '127.0.0.1',
    'www.xiekeji.com', // 您的主域名
    'proxy.yoursite.com', // 您的子域名
    // 添加其他授权域名
];

// 创建自定义的https.Agent
const customHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
    secureOptions: tls.SSL_OP_LEGACY_SERVER_CONNECT | tls.SSL_OP_NO_SSLv3,
    minVersion: 'TLSv1',
    maxVersion: 'TLSv1.3',
    ciphers: 'ALL:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!aECDH:!EDH-DSS-DES-CBC3-SHA:!EDH-RSA-DES-CBC3-SHA:!KRB5-DES-CBC3-SHA',
    honorCipherOrder: true,
    keepAlive: true,
    checkServerIdentity: () => undefined // 禁用服务器身份验证
});

// 创建axios实例
const axiosInstance = axios.create({
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: function (status) {
        return status >= 200 && status < 600;
    },
    httpsAgent: customHttpsAgent,
    // 添加更多请求配置
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    decompress: true,
    responseType: 'arraybuffer',
    headers: {
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
    }
});

// 添加请求拦截器
axiosInstance.interceptors.request.use(config => {
    // 添加详细的请求日志
    console.log(`发送请求: ${config.method.toUpperCase()} ${config.url}`);
    console.log('请求头:', config.headers);
    return config;
}, error => {
    console.error('请求错误:', error);
    return Promise.reject(error);
});

// 添加响应拦截器
axiosInstance.interceptors.response.use(
    response => {
        // 添加详细的响应日志
        console.log(`响应状态: ${response.status}`);
        console.log('响应头:', response.headers);
        return response;
    },
    async error => {
        const config = error.config;
        
        // 详细的错误日志
        console.error('请求失败:', {
            url: config.url,
            method: config.method,
            error: error.message,
            code: error.code,
            response: error.response ? {
                status: error.response.status,
                headers: error.response.headers,
                data: error.response.data
            } : null
        });
        
        // 如果没有设置重试次数，则设置为0
        if (!config.retryCount) {
            config.retryCount = 0;
        }
        
        // 最大重试次数
        const maxRetries = 3;
        
        // 如果是SSL/TLS错误、网络错误或超时，且未超过最大重试次数，则重试
        if ((error.code === 'ECONNABORTED' || 
             error.code === 'EPROTO' || 
             error.message.includes('SSL') || 
             error.message.includes('timeout') || 
             error.message.includes('network')) && 
            config.retryCount < maxRetries) {
            
            config.retryCount += 1;
            console.log(`请求重试第 ${config.retryCount} 次: ${config.url}`);
            
            // 增加重试延迟
            const delay = config.retryCount * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // 如果是SSL/TLS错误，尝试不同的配置
            if (error.message.includes('SSL') || error.code === 'EPROTO') {
                const sslConfigs = [
                    {
                        // 配置1：使用TLSv1.2
                        rejectUnauthorized: false,
                        secureOptions: tls.SSL_OP_LEGACY_SERVER_CONNECT,
                        minVersion: 'TLSv1.2',
                        maxVersion: 'TLSv1.3',
                        ciphers: [
                            'ECDHE-RSA-AES128-GCM-SHA256',
                            'ECDHE-ECDSA-AES128-GCM-SHA256'
                        ].join(':')
                    },
                    {
                        // 配置2：使用TLSv1.1
                        rejectUnauthorized: false,
                        secureOptions: tls.SSL_OP_LEGACY_SERVER_CONNECT,
                        minVersion: 'TLSv1.1',
                        maxVersion: 'TLSv1.2',
                        ciphers: [
                            'ECDHE-RSA-AES128-SHA',
                            'AES128-SHA'
                        ].join(':')
                    },
                    {
                        // 配置3：使用TLSv1
                        rejectUnauthorized: false,
                        secureOptions: tls.SSL_OP_LEGACY_SERVER_CONNECT,
                        minVersion: 'TLSv1',
                        maxVersion: 'TLSv1.1',
                        ciphers: 'ALL:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK'
                    }
                ];

                // 使用当前重试次数作为索引选择配置
                const sslConfig = sslConfigs[Math.min(config.retryCount - 1, sslConfigs.length - 1)];
                config.httpsAgent = new https.Agent(sslConfig);
                
                // 添加详细的SSL配置日志
                console.log(`使用SSL配置进行重试:`, sslConfig);
            }
            
            return axiosInstance(config);
        }
        
        return Promise.reject(error);
    }
);

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

// 域名检测中间件
app.use((req, res, next) => {
    const host = req.hostname || req.headers.host;
    
    // 检查是否是炮灰域名 (xxx.65tp.com)
    if (host.endsWith('.65tp.com')) {
        // 如果是API请求，转换为代理请求
        if (req.path.startsWith('/api/')) {
            console.log('检测到炮灰域名的API请求:', req.path);
            
            // 从原始URL获取代理参数
            const originalUrl = req.originalUrl || req.url;
            const referer = req.headers.referer || '';
            let targetDomain = '';
            let proxyParams = '';
            
            // 尝试从当前URL中获取目标域名和代理参数
            const currentUrl = `${req.protocol}://${host}${req.originalUrl}`;
            try {
                const currentUrlObj = new URL(currentUrl);
                const pathSegments = currentUrlObj.pathname.split('/');
                const subdomain = host.replace('.65tp.com', '');
                
                // 从当前页面URL中获取目标URL
                if (req.headers.referer) {
                    const refererUrl = new URL(req.headers.referer);
                    const urlParams = new URLSearchParams(refererUrl.search);
                    const targetUrl = urlParams.get('url');
                    if (targetUrl) {
                        targetDomain = new URL(targetUrl).origin;
                        
                        // 收集代理参数
                        if (urlParams.get('proxyIp')) {
                            proxyParams = '&' + ['proxyProtocol', 'proxyIp', 'proxyPort']
                                .filter(param => urlParams.get(param))
                                .map(param => `${param}=${encodeURIComponent(urlParams.get(param))}`)
                                .join('&');
                        }
                    }
                }
            } catch (e) {
                console.error('解析URL失败:', e);
            }
            
            // 如果还是无法获取目标域名，使用默认域名
            if (!targetDomain) {
                targetDomain = 'https://wwew.ebayops.com';
                console.log('使用默认目标域名:', targetDomain);
            }
            
            // 构建API URL
            const apiUrl = `${targetDomain}${req.path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
            console.log('构建API URL:', apiUrl);
            
            // 构建代理URL
            const proxyUrl = `/proxy?url=${encodeURIComponent(apiUrl)}${proxyParams}`;
            console.log('构建代理URL:', proxyUrl);
            
            // 修改请求
            req.url = proxyUrl;
            req.originalUrl = proxyUrl;
            
            // 保存原始请求信息
            req.originalMethod = req.method;
            req.originalBody = req.body;
            req.apiRedirected = true;
            
            console.log('请求已重定向:', {
                原始URL: originalUrl,
                目标域名: targetDomain,
                API路径: req.path,
                代理URL: proxyUrl,
                代理参数: proxyParams
            });
        }
        
        // 炮灰域名允许访问 /proxy 和 /api 路径
        if (!req.path.startsWith('/proxy') && !req.path.startsWith('/api') && !req.path.startsWith('/static')) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>404 Not Found</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            background-color: #f5f5f5;
                            color: #333;
                            text-align: center;
                            padding: 50px 20px;
                            margin: 0;
                        }
                        .container {
                            max-width: 600px;
                            margin: 0 auto;
                            background-color: #fff;
                            padding: 30px;
                            border-radius: 8px;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                        }
                        h1 {
                            margin-bottom: 20px;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>404 Not Found</h1>
                        <p>The requested URL was not found on this server.</p>
                    </div>
                </body>
                </html>
            `);
        }
        return next();
    }
    
    // 对于非炮灰域名，检查是否在允许列表中
    const isAllowed = ALLOWED_DOMAINS.some(domain => {
        return host === domain || host.endsWith('.' + domain);
    });
    
    // API请求直接允许通过（可选，如果您希望API可以被任何域名调用）
    const isApiRequest = req.path.startsWith('/api/');
    
    if (!isAllowed && !isApiRequest) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>404 Not Found</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f5f5f5;
                        color: #333;
                        text-align: center;
                        padding: 50px 20px;
                        margin: 0;
                    }
                    .container {
                        max-width: 600px;
                        margin: 0 auto;
                        background-color: #fff;
                        padding: 30px;
                        border-radius: 8px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    }
                    h1 {
                        margin-bottom: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>404 Not Found</h1>
                    <p>The requested URL was not found on this server.</p>
                </div>
            </body>
            </html>
        `);
    }
    
    next();
});

// 添加炮灰域名API请求的特殊处理
app.all('*', (req, res, next) => {
    const host = req.hostname || req.headers.host;
    
    // 检查是否是炮灰域名的API请求
    if (host.endsWith('.65tp.com') && req.path.startsWith('/api/')) {
        console.log('捕获到炮灰域名API请求:', req.path);
        
        // 构建目标URL (使用默认目标域名)
        const targetDomain = 'https://wwew.ebayops.com';
        const apiPath = req.originalUrl;
        const targetUrl = `${targetDomain}${apiPath}`;
        
        console.log('将API请求转发到:', targetUrl);
        
        // 获取代理配置
        let proxyConfig = null;
        // 从referer中获取代理配置
        const referer = req.headers.referer;
        if (referer) {
            try {
                const refererUrl = new URL(referer);
                const urlParams = new URLSearchParams(refererUrl.search);
                if (urlParams.get('proxyIp')) {
                    proxyConfig = {
                        ip: urlParams.get('proxyIp'),
                        port: urlParams.get('proxyPort'),
                        protocol: urlParams.get('proxyProtocol') || 'http'
                    };
                }
            } catch (e) {
                console.error('解析referer失败:', e);
            }
        }
        
        // 准备请求配置
        const requestConfig = {
            method: req.method,
            url: targetUrl,
            headers: {
                ...req.headers,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Origin': targetDomain,
                'Referer': targetDomain + '/',
                'Host': new URL(targetDomain).host
            },
            data: req.method === 'POST' || req.method === 'PUT' ? req.body : undefined,
            timeout: 30000,
            maxRedirects: 5,
            httpsAgent: customHttpsAgent,
            responseType: 'arraybuffer',
            validateStatus: function (status) {
                return status >= 200 && status < 600;
            }
        };
        
        // 删除一些不需要的头部
        delete requestConfig.headers['host'];
        delete requestConfig.headers['if-none-match'];
        delete requestConfig.headers['if-modified-since'];
        
        // 如果有代理配置，添加代理
        if (proxyConfig && proxyConfig.ip && proxyConfig.port) {
            const tunnel = require('tunnel');
            const agent = proxyConfig.protocol === 'https' 
                ? tunnel.httpsOverHttps({
                    proxy: {
                        host: proxyConfig.ip,
                        port: parseInt(proxyConfig.port),
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                        }
                    },
                    rejectUnauthorized: false,
                    checkServerIdentity: () => undefined
                })
                : tunnel.httpsOverHttp({
                    proxy: {
                        host: proxyConfig.ip,
                        port: parseInt(proxyConfig.port),
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                        }
                    },
                    rejectUnauthorized: false,
                    checkServerIdentity: () => undefined
                });
            
            requestConfig.httpsAgent = agent;
            requestConfig.agent = agent;
            console.log(`API请求使用代理: ${proxyConfig.protocol}://${proxyConfig.ip}:${proxyConfig.port}`);
        }
        
        // 发送请求
        axiosInstance(requestConfig)
            .then(response => {
                console.log(`API响应状态: ${response.status}`);
                
                // 设置响应头
                Object.entries(response.headers).forEach(([key, value]) => {
                    if (!['content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
                        res.set(key, value);
                    }
                });
                
                // 设置CORS头
                res.set({
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
                    'Access-Control-Allow-Credentials': 'true'
                });
                
                // 处理响应数据
                let responseData = response.data;
                const contentType = response.headers['content-type'] || '';
                
                // 如果是JSON响应
                if (contentType.includes('application/json') || contentType.includes('text/json')) {
                    try {
                        // 将Buffer转换为字符串，然后解析为JSON
                        const jsonStr = responseData.toString('utf-8');
                        responseData = JSON.parse(jsonStr);
                    } catch (e) {
                        console.error('JSON解析失败:', e.message);
                    }
                }
                // 如果是文本响应
                else if (contentType.includes('text/')) {
                    try {
                        responseData = responseData.toString('utf-8');
                    } catch (e) {
                        console.error('文本解析失败:', e.message);
                    }
                }
                
                // 返回响应
                res.status(response.status).send(responseData);
            })
            .catch(error => {
                console.error(`API请求失败:`, error.message);
                
                // 提供详细的错误信息
                const errorResponse = {
                    error: 'API请求失败',
                    message: error.message,
                    details: {
                        code: error.code,
                        errno: error.errno
                    }
                };
                
                if (error.response) {
                    errorResponse.details.status = error.response.status;
                    errorResponse.details.statusText = error.response.statusText;
                    if (error.response.headers) {
                        errorResponse.details.headers = error.response.headers;
                    }
                    return res.status(error.response.status).json(errorResponse);
                }
                
                return res.status(502).json(errorResponse);
            });
        
        // 不继续执行后续中间件
        return;
    }
    
    // 继续执行后续中间件
    next();
});

// 处理静态资源请求
app.get('/static/*', async (req, res, next) => {
    try {
        console.log(`处理静态资源请求: ${req.path}`);
        
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
        
        // 如果无法从referer获取baseUrl，尝试从最近成功的代理请求中获取
        if (!baseUrl && global.lastProxyUrl) {
            baseUrl = global.lastProxyUrl;
            console.log(`使用上次代理URL作为基础: ${baseUrl}`);
        }
        
        if (baseUrl) {
            try {
                const parsedBaseUrl = new URL(baseUrl);
                // 构建资源的完整URL
                const resourcePath = req.path;
                const resourceUrl = new URL(resourcePath, parsedBaseUrl.origin).href;
                
                console.log(`从源站获取资源: ${resourceUrl}`);
                const response = await axiosInstance.get(resourceUrl, {
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
        res.status(404).send('静态资源未找到');
    } catch (error) {
        console.error(`静态资源请求处理失败: ${error.message}`);
        res.status(500).send('静态资源请求处理失败');
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
                const response = await axiosInstance.get(resourceUrl, {
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

// 修改资源处理逻辑
async function handleResourceRequest(url, headers = {}, proxyConfig = null) {
    try {
        console.log(`尝试获取资源: ${url}`);
        console.log('代理配置:', proxyConfig);
        
        // 构建请求配置
        const config = {
            headers: {
                ...headers,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Host': new URL(url).host // 添加正确的Host头
            },
            timeout: 30000,
            responseType: 'arraybuffer',
            validateStatus: function (status) {
                return status >= 200 && status < 600;
            },
            maxRedirects: 5,
            httpsAgent: customHttpsAgent
        };

        // 如果提供了代理配置，添加代理
        if (proxyConfig && proxyConfig.ip && proxyConfig.port) {
            const tunnel = require('tunnel');
            const agent = proxyConfig.protocol === 'https' 
                ? tunnel.httpsOverHttps({
                    proxy: {
                        host: proxyConfig.ip,
                        port: parseInt(proxyConfig.port),
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                        }
                    },
                    rejectUnauthorized: false,
                    checkServerIdentity: () => undefined
                })
                : tunnel.httpsOverHttp({
                    proxy: {
                        host: proxyConfig.ip,
                        port: parseInt(proxyConfig.port),
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                        }
                    },
                    rejectUnauthorized: false,
                    checkServerIdentity: () => undefined
                });
            
            config.httpsAgent = agent;
            config.agent = agent;
            console.log(`已配置代理: ${proxyConfig.protocol}://${proxyConfig.ip}:${proxyConfig.port}`);
        }

        // 尝试直接请求
        try {
            console.log(`尝试直接请求: ${url}`);
            const response = await axiosInstance.get(url, config);
            
            // 检查响应是否有效
            if (response.status === 200 && response.data && response.data.length > 0) {
                console.log(`成功获取资源: ${url}`);
                return response;
            } else {
                console.log(`响应无效: 状态码 ${response.status}, 数据长度 ${response.data ? response.data.length : 0}`);
            }
        } catch (e) {
            console.error(`直接请求失败:`, e.message);
            if (e.response) {
                console.error('错误响应:', {
                    status: e.response.status,
                    statusText: e.response.statusText,
                    headers: e.response.headers
                });
            }
            throw e;
        }
    } catch (error) {
        console.error(`获取资源失败: ${error.message}`);
        throw error;
    }
}

// 在app.get('/proxy')中使用新的handleResourceRequest函数
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    const proxyConfig = {
        ip: req.query.proxyIp,
        port: req.query.proxyPort,
        protocol: req.query.proxyProtocol || 'http'
    };
    
    if (!targetUrl) {
        return res.status(400).json({ error: '请提供目标URL' });
    }
    
    console.log(`处理代理请求: ${targetUrl}`);
    console.log('代理配置:', proxyConfig);
    
    try {
        const response = await handleResourceRequest(targetUrl, req.headers, proxyConfig);
        
        // 设置响应头
        Object.entries(response.headers).forEach(([key, value]) => {
            if (!['content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
                res.set(key, value);
            }
        });
        
        // 设置CORS和缓存头
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Credentials': 'true',
            'Cache-Control': 'public, max-age=31536000'
        });
        
        // 返回响应
        return res.send(response.data);
    } catch (error) {
        console.error(`代理请求失败:`, error);
        
        // 提供更详细的错误信息
        const errorResponse = {
            error: '代理请求失败',
            message: error.message,
            details: {
                code: error.code,
                errno: error.errno
            }
        };

        if (error.response) {
            errorResponse.details.status = error.response.status;
            errorResponse.details.statusText = error.response.statusText;
            errorResponse.details.headers = error.response.headers;
        }

        return res.status(502).json(errorResponse);
    }
});

// 代理请求处理 - POST
app.post('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    const proxyIp = req.query.proxyIp;
    const proxyPort = req.query.proxyPort;
    const proxyProtocol = req.query.proxyProtocol || 'http';
    
    if (!targetUrl) {
        return res.status(400).json({ error: '请提供目标URL' });
    }
    
    console.log(`处理POST代理请求: ${targetUrl}`);
    console.log('POST请求体:', req.body);
    
    try {
        // 解析目标URL
        const parsedUrl = new URL(targetUrl);
        
        // 如果目标URL是localhost，则替换为实际的目标域名
        if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
            // 从referer中获取原始域名
            const referer = req.headers.referer;
            if (referer) {
                try {
                    const refererUrl = new URL(referer);
                    if (refererUrl.pathname === '/proxy') {
                        const urlParams = new URLSearchParams(refererUrl.search);
                        const originalUrl = urlParams.get('url');
                        if (originalUrl) {
                            const originalParsedUrl = new URL(originalUrl);
                            // 替换域名
                            parsedUrl.hostname = originalParsedUrl.hostname;
                            parsedUrl.protocol = originalParsedUrl.protocol;
                            // 确保不使用端口3000
                            parsedUrl.port = '';
                            console.log(`将API请求从localhost重定向到: ${parsedUrl.href}`);
                        }
                    }
                } catch (e) {
                    console.error(`解析Referer失败: ${e.message}`);
                }
            }
            
            // 如果无法从referer获取，则使用一个默认域名
            if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
                parsedUrl.hostname = 'wwew.ebayops.com';
                parsedUrl.protocol = 'http:';
                // 确保不使用端口3000
                parsedUrl.port = '';
                console.log(`使用默认域名重定向API请求: ${parsedUrl.href}`);
            }
        } else {
            // 确保不使用端口3000
            parsedUrl.port = '';
        }
        
        const baseUrl = parsedUrl.origin;
        const actualTargetUrl = parsedUrl.href;
        
        // 设置请求选项
        const requestOptions = {
            method: 'POST',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Content-Type': req.headers['content-type'] || 'application/json',
                'Origin': baseUrl,
                'Referer': baseUrl,
                'Host': parsedUrl.host,
                'Connection': 'keep-alive'
            },
            data: req.body,
            validateStatus: function (status) {
                return status >= 200 && status < 600;
            },
            maxRedirects: 5,
            decompress: true,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
                secureOptions: tls.SSL_OP_LEGACY_SERVER_CONNECT | tls.SSL_OP_NO_SSLv3,
                minVersion: 'TLSv1',
                maxVersion: 'TLSv1.3',
                ciphers: 'ALL:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!aECDH:!EDH-DSS-DES-CBC3-SHA:!EDH-RSA-DES-CBC3-SHA:!KRB5-DES-CBC3-SHA',
                honorCipherOrder: true,
                keepAlive: true
            })
        };

        // 如果提供了代理IP和端口，配置代理
        if (proxyIp && proxyPort) {
            console.log(`使用自定义代理: ${proxyProtocol}://${proxyIp}:${proxyPort}`);
            
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

        // 发送POST请求
        console.log(`发送POST请求到: ${actualTargetUrl}`);
        const response = await axiosInstance.post(actualTargetUrl, req.body, requestOptions);
        console.log(`POST请求响应状态: ${response.status}`);
        
        // 设置响应头
        Object.entries(response.headers).forEach(([key, value]) => {
            // 排除一些特殊的响应头
            if (!['content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
                res.set(key, value);
            }
        });

        // 设置CORS和其他安全头
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true'
        });

        // 返回响应
        return res.status(response.status).send(response.data);
        
    } catch (error) {
        console.error(`POST代理请求失败:`, error);
        if (error.response) {
            // 如果有响应，返回相同的状态码和数据
            return res.status(error.response.status).send(error.response.data);
        }
        return res.status(502).json({
            error: '代理请求失败',
            message: error.message
        });
    }
});

// 处理OPTIONS请求
app.options('/proxy', (req, res) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400'
    });
    res.status(200).end();
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
