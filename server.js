const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const NodeCache = require('node-cache');
const cheerio = require('cheerio');
const zlib = require('zlib');
const { minify } = require('terser');
const CleanCSS = require('clean-css');
const sharp = require('sharp');
const crypto = require('crypto');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// 创建一个缓存实例，用于存储优化后的资源
const resourceCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 });
// 会话缓存，用于存储会话信息，7天过期时间
const sessionCache = new NodeCache({ stdTTL: 7 * 24 * 60 * 60, checkperiod: 3600 });

// 炮灰域名配置
const CANNON_FODDER_DOMAIN = process.env.CANNON_FODDER_DOMAIN || '4is.cc';

// 启用CORS
app.use(cors());

// 解析请求体
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 炮灰域名中间件
app.use((req, res, next) => {
    // 检查主机是否是炮灰域名
    const host = req.hostname || '';
    if (host.endsWith(CANNON_FODDER_DOMAIN) && host !== CANNON_FODDER_DOMAIN) {
        console.log(`检测到炮灰域名请求: ${host}`);
        req.isCannonFodder = true;
        req.cannonFodderHost = host;
    }
    next();
});

// 处理静态资源请求
app.get('/static/*', async (req, res) => {
    try {
        console.log(`处理静态资源请求: ${req.path}`);
        
        // 检查请求是否来自炮灰域名
        if (!req.isCannonFodder) {
            // 如果不是炮灰域名请求，使用本地静态文件
            return next();
        }
        
        // 尝试从本地获取静态资源
        const localPath = path.join(__dirname, 'public', req.path);
        
        // 检查文件是否存在
        try {
            if (require('fs').existsSync(localPath)) {
                console.log(`提供本地静态资源: ${localPath}`);
                return res.sendFile(localPath);
            }
        } catch (err) {
            console.error(`检查本地文件失败: ${err.message}`);
        }
        
        // 如果请求包含原始URL（用于代理），尝试从源站获取
        const originalUrl = req.query.originalUrl;
        if (originalUrl) {
            console.log(`从源站获取静态资源: ${originalUrl}`);
            const response = await axios.get(originalUrl, {
                responseType: 'arraybuffer',
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            
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
                    default:
                        res.set('Content-Type', 'application/octet-stream');
                }
            }
            
            // 缓存控制
            res.set('Cache-Control', 'public, max-age=86400'); // 24小时缓存
            
            return res.send(response.data);
        }
        
        // 如果无法获取资源，返回404
        res.status(404).send('静态资源未找到');
    } catch (error) {
        console.error(`静态资源请求处理失败: ${error.message}`);
        res.status(500).send('静态资源请求处理失败');
    }
});

// 提供静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 新增：生成随机炮灰域名
app.get('/api/cannon-fodder-domain', (req, res) => {
    const randomPrefix = Math.random().toString(36).substring(2, 10);
    const cannonFodderHost = `${randomPrefix}.${CANNON_FODDER_DOMAIN}`;
    
    res.json({
        success: true,
        domain: cannonFodderHost
    });
});

// 代理请求处理
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    
    if (!targetUrl) {
        return res.status(400).json({ error: '请提供目标URL' });
    }
    
    try {
        // 解析目标URL
        const parsedUrl = new URL(targetUrl);
        
        // 设置请求选项
        const requestOptions = {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Host': parsedUrl.host,
                'Referer': parsedUrl.origin
            },
            validateStatus: false,
            maxRedirects: 5,
            responseType: 'arraybuffer'
        };
        
        // 发送请求
        const response = await axios.get(targetUrl, requestOptions);
        
        // 获取响应类型
        const contentType = response.headers['content-type'] || '';
        
        // 如果是HTML内容，进行处理
        if (contentType.includes('text/html')) {
            let html = response.data.toString();
            const $ = cheerio.load(html);
            
            // 获取当前的炮灰域名
            const currentHost = req.isCannonFodder ? req.cannonFodderHost : req.get('host');
            const protocol = req.protocol;
            const baseUrl = `${protocol}://${currentHost}`;
            
            // 替换所有链接为代理链接
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href) {
                    try {
                        const absoluteUrl = new URL(href, targetUrl).href;
                        const proxyUrl = `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
                        $(el).attr('href', proxyUrl);
                    } catch (e) {
                        // 忽略无效的URL
                    }
                }
            });
            
            // 替换所有资源链接
            $('img, script, link[rel="stylesheet"], source').each((i, el) => {
                const src = $(el).attr('src') || $(el).attr('href');
                if (src) {
                    try {
                        const absoluteUrl = new URL(src, targetUrl).href;
                        
                        // 检查资源类型
                        const ext = path.extname(absoluteUrl).toLowerCase();
                        
                        // 对于静态资源，使用静态资源处理路由
                        if (['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
                            // 创建一个静态资源URL，包含原始URL作为参数
                            const staticPath = `/static${new URL(absoluteUrl).pathname}?originalUrl=${encodeURIComponent(absoluteUrl)}`;
                            
                            if ($(el).attr('src')) {
                                $(el).attr('src', staticPath);
                            } else {
                                $(el).attr('href', staticPath);
                            }
                        } else {
                            // 其他资源使用代理
                            const proxyUrl = `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
                            
                            if ($(el).attr('src')) {
                                $(el).attr('src', proxyUrl);
                            } else {
                                $(el).attr('href', proxyUrl);
                            }
                        }
                    } catch (e) {
                        // 忽略无效的URL
                        console.error(`处理资源链接失败: ${e.message}`);
                    }
                }
            });
            
            // 添加过滤和优化
            if (req.query.removeAds === 'true') {
                $('ins, .adsbygoogle, .ad, [class*="ad-"], [id*="ad-"]').remove();
            }
            
            if (req.query.removeTrackers === 'true') {
                $('script[src*="analytics"], script[src*="tracking"], script[src*="pixel"]').remove();
            }
            
            if (req.query.removeSensitive === 'true') {
                $('form, input[type="password"], input[type="email"]').remove();
            }
            
            if (req.query.addWarning === 'true') {
                $('body').prepend('<div style="background: #fff3cd; color: #856404; padding: 1rem; margin: 1rem; border-radius: 4px; text-align: center;">⚠️ 您正在通过代理访问此网站。请注意信息安全，不要输入敏感信息。</div>');
            }
            
            // 优化内容
            if (req.query.optimize === 'true') {
                // 延迟加载图片
                $('img').attr('loading', 'lazy');
                
                // 压缩HTML
                html = $.html().replace(/\s+/g, ' ').trim();
            }
            
            // 设置响应头
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } else {
            // 非HTML内容直接转发
            res.set('Content-Type', contentType);
            res.send(response.data);
        }
    } catch (error) {
        console.error('请求失败:', error);
        res.status(500).json({
            error: '请求失败',
            message: error.message
        });
    }
});

// 新增：生成代理链接
app.post('/api/create-link', async (req, res) => {
    try {
        const { url, removeAds, removeTrackers, removeSensitive, addWarning, optimize } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: '请提供目标URL' });
        }
        
        // 创建会话
        const session = createProxySession({
            removeAds,
            removeTrackers,
            removeSensitive,
            addWarning,
            optimize
        });
        
        // 生成随机炮灰域名
        const randomPrefix = Math.random().toString(36).substring(2, 10);
        const cannonFodderHost = `${randomPrefix}.${CANNON_FODDER_DOMAIN}`;
        
        // 构建代理链接，使用炮灰域名
        const proxyUrl = `${req.protocol}://${cannonFodderHost}/s/${session.id}?url=${encodeURIComponent(url)}`;
        
        res.json({
            success: true,
            sessionId: session.id,
            proxyUrl,
            expiresAt: session.expiresAt
        });
    } catch (error) {
        console.error('创建代理链接失败:', error);
        res.status(500).json({
            error: '创建代理链接失败',
            message: error.message
        });
    }
});

// 新增：会话代理路由
app.get('/s/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { url } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: '请提供目标URL' });
    }
    
    // 获取会话
    const session = getProxySession(sessionId);
    if (!session) {
        return res.status(404).json({ error: '会话已过期或不存在' });
    }
    
    // 检查会话是否过期
    if (session.expiresAt < Date.now()) {
        sessionCache.del(sessionId);
        return res.status(410).json({ error: '会话已过期' });
    }
    
    // 构建代理URL
    const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
    
    // 添加会话中的过滤和优化选项
    if (session.settings.removeAds) proxyUrl += '&removeAds=true';
    if (session.settings.removeTrackers) proxyUrl += '&removeTrackers=true';
    if (session.settings.removeSensitive) proxyUrl += '&removeSensitive=true';
    if (session.settings.addWarning) proxyUrl += '&addWarning=true';
    if (session.settings.optimize) proxyUrl += '&optimize=true';
    
    // 重定向到代理URL
    res.redirect(proxyUrl);
});

// 新增：生成唯一会话ID
function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

// 新增：创建代理会话
function createProxySession(settings) {
    const sessionId = generateSessionId();
    const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7天后过期
    
    const session = {
        id: sessionId,
        createdAt: Date.now(),
        expiresAt: expiresAt,
        settings: {
            removeAds: settings.removeAds || false,
            removeTrackers: settings.removeTrackers || false,
            removeSensitive: settings.removeSensitive || false,
            addWarning: settings.addWarning || false,
            optimize: settings.optimize || false
        }
    };
    
    // 存储会话
    sessionCache.set(sessionId, session);
    
    return session;
}

// 新增：获取会话信息
function getProxySession(sessionId) {
    if (!sessionId) return null;
    return sessionCache.get(sessionId);
}

app.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
}); 
