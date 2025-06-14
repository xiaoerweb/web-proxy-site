const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const NodeCache = require('node-cache');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const cheerio = require('cheerio');
const zlib = require('zlib');
const { minify } = require('terser');
const CleanCSS = require('clean-css');
const sharp = require('sharp');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 创建一个缓存实例，用于存储代理IP和优化后的资源
const resourceCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 });
// 代理缓存，用于存储从API获取的代理IP
const proxyCache = new NodeCache({ stdTTL: 1800, checkperiod: 300 }); // 30分钟过期
// 会话缓存，用于存储代理会话信息，7天过期时间
const sessionCache = new NodeCache({ stdTTL: 7 * 24 * 60 * 60, checkperiod: 3600 });

// 炮灰域名配置
const CANNON_FODDER_DOMAIN = process.env.CANNON_FODDER_DOMAIN || '4is.cc'; // 替换为您的域名，不要包含*或子域名

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
        // 将炮灰域名请求转发到正常处理逻辑
        req.isCannonFodder = true;
        req.cannonFodderHost = host;
    }
    next();
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

// 获取代理IP列表
async function fetchProxyIPs(protocol = 'http', count = 20) {
    try {
        // 检查缓存
        const cacheKey = `proxies-${protocol}-${count}`;
        const cachedProxies = proxyCache.get(cacheKey);
        
        if (cachedProxies) {
            console.log(`使用缓存的${protocol}代理IP列表`);
            return cachedProxies;
        }
        
        console.log(`获取${protocol}代理IP列表...`);
        
        // 从scdn.io获取代理
        try {
            const scdnResponse = await axios.get(`https://proxy.scdn.io/api/get_proxy.php?protocol=${protocol}&count=${count}`, {
                timeout: 10000
            });
            
            if (scdnResponse.data && scdnResponse.data.code === 200 && scdnResponse.data.data && Array.isArray(scdnResponse.data.data.proxies)) {
                const proxies = scdnResponse.data.data.proxies;
                
                if (proxies.length > 0) {
                    console.log(`从scdn.io获取到${proxies.length}个${protocol}代理`);
                    const result = { proxies: proxies, source: 'scdn.io' };
                    proxyCache.set(cacheKey, result);
                    return result;
                }
            }
        } catch (scdnError) {
            console.error('从scdn.io获取代理失败:', scdnError.message);
        }
        
        // 如果scdn.io失败，尝试从proxy.cc获取代理
        try {
            const proxyccResponse = await axios.get(`https://proxy.cc/detection/proxyList?limit=${count}&page=1&sort_by=lastChecked&sort_type=desc`, {
                timeout: 10000
            });
            
            if (proxyccResponse.data && proxyccResponse.data.data && Array.isArray(proxyccResponse.data.data)) {
                const proxies = proxyccResponse.data.data
                    .filter(proxy => proxy.protocols.includes(protocol.toLowerCase()))
                    .map(proxy => `${proxy.ip}:${proxy.port}`);
                
                if (proxies.length > 0) {
                    console.log(`从proxy.cc获取到${proxies.length}个${protocol}代理`);
                    const result = { proxies: proxies, source: 'proxy.cc' };
                    proxyCache.set(cacheKey, result);
                    return result;
                }
            }
        } catch (proxyccError) {
            console.error('从proxy.cc获取代理失败:', proxyccError.message);
        }
        
        // 所有源都失败，返回空数组
        return { proxies: [], source: 'none' };
    } catch (error) {
        console.error('获取代理IP失败:', error);
        return { proxies: [], source: 'error' };
    }
}

// 新增：生成唯一会话ID
function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

// 新增：创建代理会话
function createProxySession(proxyConfig) {
    const sessionId = generateSessionId();
    const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7天后过期
    
    const session = {
        id: sessionId,
        proxy: proxyConfig.proxy || null,
        protocol: proxyConfig.protocol || 'https',
        createdAt: Date.now(),
        expiresAt: expiresAt,
        settings: {
            removeAds: proxyConfig.removeAds || false,
            removeTrackers: proxyConfig.removeTrackers || false,
            removeSensitive: proxyConfig.removeSensitive || false,
            addWarning: proxyConfig.addWarning || false,
            optimize: proxyConfig.optimize || false
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

// 新增：生成代理链接
app.post('/api/create-link', async (req, res) => {
    try {
        const { url, proxy, protocol, removeAds, removeTrackers, removeSensitive, addWarning, optimize } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: '请提供目标URL' });
        }
        
        // 创建会话
        const session = createProxySession({
            proxy,
            protocol,
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
    
    try {
        // 构建代理请求参数
        const proxyParams = new URLSearchParams();
        proxyParams.append('url', url);
        
        if (session.proxy) {
            proxyParams.append('proxy', session.proxy);
            proxyParams.append('protocol', session.protocol);
        }
        
        if (session.settings.removeAds) proxyParams.append('removeAds', 'true');
        if (session.settings.removeTrackers) proxyParams.append('removeTrackers', 'true');
        if (session.settings.removeSensitive) proxyParams.append('removeSensitive', 'true');
        if (session.settings.addWarning) proxyParams.append('addWarning', 'true');
        if (session.settings.optimize) proxyParams.append('optimize', 'true');
        
        // 重定向到代理路由
        res.redirect(`/proxy?${proxyParams.toString()}`);
    } catch (error) {
        console.error('会话代理请求失败:', error);
        res.status(500).json({
            error: '会话代理请求失败',
            message: error.message
        });
    }
});

// 获取国家名称
function getCountryName(countryCode) {
  const countries = {
    'US': '美国', 'CN': '中国', 'JP': '日本', 'KR': '韩国', 
    'GB': '英国', 'DE': '德国', 'FR': '法国', 'CA': '加拿大',
    'AU': '澳大利亚', 'RU': '俄罗斯', 'IN': '印度', 'BR': '巴西',
    'SG': '新加坡', 'NL': '荷兰', 'SE': '瑞典', 'CH': '瑞士',
    'ES': '西班牙', 'IT': '意大利', 'HK': '香港', 'TW': '台湾',
    // 添加更多国家/地区...
  };
  
  return countries[countryCode] || countryCode;
}

// API端点：获取代理IP列表
app.get('/api/proxies', async (req, res) => {
    try {
        const protocol = req.query.protocol || 'http';
        const count = parseInt(req.query.count) || 20;
        
        // 获取代理IP
        const result = await fetchProxyIPs(protocol, count);
        
        res.json({
            success: true,
            data: {
                proxies: result.proxies,
                source: result.source,
                timestamp: Date.now()
            }
        });
    } catch (error) {
        console.error('获取代理列表失败:', error);
        res.status(500).json({
            error: '获取代理列表失败',
            message: error.message
        });
    }
});

// 内容过滤函数
function filterContent(html, filters = {}) {
  if (!html) return html;
  
  try {
    const $ = cheerio.load(html);
    
    // 过滤广告
    if (filters.removeAds) {
      // 常见广告选择器
      const adSelectors = [
        'div[id*="ad"], div[class*="ad"], div[id*="banner"], div[class*="banner"]',
        'div[id*="popup"], div[class*="popup"]',
        'iframe[src*="ad"], iframe[src*="banner"]',
        'ins.adsbygoogle',
        'div[data-ad]',
        'div.advertisement',
        'div.advert',
        'div.sponsored',
        'div[id*="gpt"]',
        'div[class*="gpt"]',
        'div[id*="taboola"]',
        'div[class*="taboola"]',
        'div[id*="outbrain"]',
        'div[class*="outbrain"]',
        'div[id*="mgid"]',
        'div[class*="mgid"]'
      ];
      
      adSelectors.forEach(selector => {
        $(selector).remove();
      });
    }
    
    // 过滤跟踪器和分析代码
    if (filters.removeTrackers) {
      $('script[src*="google-analytics"], script[src*="googletagmanager"], script[src*="gtm.js"]').remove();
      $('script[src*="facebook"], script[src*="fbevents.js"]').remove();
      $('script[src*="twitter"], script[src*="platform.twitter"]').remove();
      $('script[src*="hotjar"], script[src*="clarity.ms"]').remove();
      
      // 移除内联跟踪脚本
      $('script').each((i, el) => {
        const scriptContent = $(el).html() || '';
        if (
          scriptContent.includes('google-analytics') || 
          scriptContent.includes('googletagmanager') || 
          scriptContent.includes('fbq(') || 
          scriptContent.includes('fbevents') ||
          scriptContent.includes('hotjar') ||
          scriptContent.includes('clarity')
        ) {
          $(el).remove();
        }
      });
    }
    
    // 过滤敏感内容（简单实现，实际应用中可能需要更复杂的算法）
    if (filters.removeSensitive) {
      const sensitiveWords = [
        '色情', '赌博', '博彩', '暴力', '血腥', '恐怖', '毒品', '犯罪',
        'porn', 'gambling', 'casino', 'violence', 'bloody', 'terror', 'drug', 'crime'
      ];
      
      sensitiveWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        const replacement = '***';
        
        // 替换文本节点中的敏感词
        $('body *').contents().each(function() {
          if (this.nodeType === 3) { // 文本节点
            const text = $(this).text();
            if (regex.test(text)) {
              $(this).replaceWith(text.replace(regex, replacement));
            }
          }
        });
      });
    }
    
    // 添加安全浏览提示
    if (filters.addWarning) {
      $('body').prepend(`
        <div style="background-color: #f8d7da; color: #721c24; padding: 10px; margin-bottom: 15px; border: 1px solid #f5c6cb; border-radius: 4px; position: relative;">
          <button style="position: absolute; right: 10px; top: 10px; background: none; border: none; font-size: 16px; cursor: pointer;">&times;</button>
          <p style="margin: 0;"><strong>安全浏览提示:</strong> 您正在通过代理服务器访问此网站。请注意保护您的个人信息安全。</p>
          <script>
            document.currentScript.parentNode.querySelector('button').addEventListener('click', function() {
              this.parentNode.style.display = 'none';
            });
          </script>
        </div>
      `);
    }
    
    // 性能优化
    if (filters.optimize) {
      // 延迟加载图片
      $('img').each((i, el) => {
        const src = $(el).attr('src');
        if (src) {
          $(el).attr('loading', 'lazy');
          $(el).attr('data-original-src', src);
          
          // 添加占位符
          if (!$(el).attr('width') && !$(el).attr('height')) {
            $(el).attr('width', '100%');
            $(el).attr('height', 'auto');
          }
        }
      });
      
      // 优化CSS
      $('style').each((i, el) => {
        const css = $(el).html();
        if (css) {
          try {
            const optimizedCss = new CleanCSS().minify(css).styles;
            $(el).html(optimizedCss);
          } catch (e) {
            console.error('CSS优化失败:', e);
          }
        }
      });
      
      // 优化内联JavaScript
      $('script:not([src])').each(async (i, el) => {
        const js = $(el).html();
        if (js && !js.includes('document.currentScript')) { // 避免处理我们自己添加的脚本
          try {
            const result = await minify(js);
            if (result.code) {
              $(el).html(result.code);
            }
          } catch (e) {
            // 忽略错误，保留原始脚本
          }
        }
      });
      
      // 添加预连接提示
      const domains = new Set();
      $('script[src], link[href], img[src], iframe[src]').each((i, el) => {
        try {
          let url;
          if ($(el).attr('src')) {
            url = new URL($(el).attr('src'), 'https://example.com');
          } else if ($(el).attr('href')) {
            url = new URL($(el).attr('href'), 'https://example.com');
          }
          
          if (url && url.hostname !== 'example.com') {
            domains.add(url.origin);
          }
        } catch (e) {
          // 忽略无效URL
        }
      });
      
      // 添加预连接提示到头部
      domains.forEach(domain => {
        $('head').append(`<link rel="preconnect" href="${domain}" crossorigin>`);
      });
    }
    
    return $.html();
  } catch (error) {
    console.error('过滤内容时出错:', error);
    return html; // 如果出错，返回原始HTML
  }
}

// 压缩图片
async function optimizeImage(buffer, options = {}) {
  try {
    const cacheKey = `image-${buffer.length}-${JSON.stringify(options)}`;
    const cachedImage = resourceCache.get(cacheKey);
    
    if (cachedImage) {
      return cachedImage;
    }
    
    let image = sharp(buffer);
    const metadata = await image.metadata();
    
    // 调整图片大小
    if (options.maxWidth && metadata.width > options.maxWidth) {
      image = image.resize(options.maxWidth);
    }
    
    // 根据格式优化
    let optimizedBuffer;
    
    switch (metadata.format) {
      case 'jpeg':
      case 'jpg':
        optimizedBuffer = await image.jpeg({ quality: options.quality || 80 }).toBuffer();
        break;
      case 'png':
        optimizedBuffer = await image.png({ quality: options.quality || 80 }).toBuffer();
        break;
      case 'webp':
        optimizedBuffer = await image.webp({ quality: options.quality || 80 }).toBuffer();
        break;
      default:
        // 对于其他格式，转换为WebP
        optimizedBuffer = await image.webp({ quality: options.quality || 80 }).toBuffer();
    }
    
    // 缓存结果
    resourceCache.set(cacheKey, optimizedBuffer);
    
    return optimizedBuffer;
  } catch (error) {
    console.error('图片优化失败:', error);
    return buffer; // 如果出错，返回原始图片
  }
}

// 资源代理路由 - 用于优化图片、CSS和JS
app.get('/resource-proxy', async (req, res) => {
  const url = req.query.url;
  const type = req.query.type || 'auto';
  const optimize = req.query.optimize === 'true';
  
  if (!url) {
    return res.status(400).send('缺少URL参数');
  }
  
  try {
    // 检查缓存
    const cacheKey = `resource-${url}-${type}-${optimize}`;
    const cachedResource = resourceCache.get(cacheKey);
    
    if (cachedResource) {
      res.setHeader('Content-Type', cachedResource.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 缓存24小时
      return res.send(cachedResource.data);
    }
    
    // 获取资源
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': new URL(url).origin
      }
    });
    
    const contentType = response.headers['content-type'] || '';
    let data = response.data;
    
    // 如果需要优化
    if (optimize) {
      // 根据内容类型优化
      if (contentType.includes('image/')) {
        // 优化图片
        data = await optimizeImage(data, {
          maxWidth: 1200,
          quality: 80
        });
      } else if (contentType.includes('text/css')) {
        // 优化CSS
        const css = data.toString('utf-8');
        const optimizedCss = new CleanCSS().minify(css).styles;
        data = Buffer.from(optimizedCss, 'utf-8');
      } else if (contentType.includes('application/javascript') || contentType.includes('text/javascript')) {
        // 优化JavaScript
        const js = data.toString('utf-8');
        try {
          const result = await minify(js);
          if (result.code) {
            data = Buffer.from(result.code, 'utf-8');
          }
        } catch (e) {
          // 忽略错误，保留原始脚本
        }
      }
    }
    
    // 缓存结果
    resourceCache.set(cacheKey, {
      contentType: contentType,
      data: data
    });
    
    // 设置响应头
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 缓存24小时
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // 发送响应
    res.send(data);
  } catch (error) {
    console.error('资源代理错误:', error);
    res.status(500).send(`资源代理错误: ${error.message}`);
  }
});

// 代理请求处理
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    const useProxy = req.query.proxy;
    const protocol = req.query.protocol || 'https';
    
    if (!targetUrl) {
        return res.status(400).json({ error: '请提供目标URL' });
    }

    // 使用请求中的炮灰域名或生成新的
    let cannonFodderHost;
    if (req.isCannonFodder && req.cannonFodderHost) {
        cannonFodderHost = req.cannonFodderHost;
    } else {
        // 生成随机子域名
        const randomPrefix = Math.random().toString(36).substring(2, 10);
        cannonFodderHost = `${randomPrefix}.${CANNON_FODDER_DOMAIN}`;
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
                'Host': parsedUrl.host // 保持原始Host头
            },
            validateStatus: false // 不抛出HTTP错误
        };

        // 如果提供了代理，设置代理
        if (useProxy) {
            const [proxyHost, proxyPort] = useProxy.split(':');
            
            // 根据协议类型设置不同的代理
            switch (protocol.toLowerCase()) {
                case 'socks4':
                    requestOptions.httpsAgent = new SocksProxyAgent(`socks4://${proxyHost}:${proxyPort}`);
                    break;
                case 'socks5':
                    requestOptions.httpsAgent = new SocksProxyAgent(`socks5://${proxyHost}:${proxyPort}`);
                    break;
                case 'https':
                    requestOptions.httpsAgent = new HttpsProxyAgent(`${protocol}://${proxyHost}:${proxyPort}`);
                    break;
                case 'http':
                    requestOptions.proxy = {
                        host: proxyHost,
                        port: proxyPort,
                        protocol: protocol
                    };
                    break;
                default:
                    throw new Error('不支持的代理协议');
            }
            
            console.log(`使用${protocol.toUpperCase()}代理: ${proxyHost}:${proxyPort}`);
        }

        console.log(`请求目标URL: ${targetUrl}`);
        console.log(`使用炮灰域名: ${cannonFodderHost}`);

        // 发送请求
        const response = await axios({
            method: 'get',
            url: targetUrl,
            ...requestOptions
        });

        // 设置响应头
        res.set('Content-Type', response.headers['content-type'] || 'text/html');
        
        // 如果是HTML内容，进行处理
        if (response.headers['content-type'] && response.headers['content-type'].includes('text/html')) {
            let html = response.data;
            
            // 替换所有域名引用为炮灰域名
            const $ = cheerio.load(html);
            
            // 替换所有链接
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href) {
                    try {
                        // 处理相对URL和绝对URL
                        let absoluteUrl = href;
                        if (!href.startsWith('http') && !href.startsWith('//')) {
                            // 相对URL，转换为绝对URL
                            if (href.startsWith('/')) {
                                absoluteUrl = `${parsedUrl.protocol}//${parsedUrl.host}${href}`;
                            } else {
                                const baseDir = parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1);
                                absoluteUrl = `${parsedUrl.protocol}//${parsedUrl.host}${baseDir}${href}`;
                            }
                        } else if (href.startsWith('//')) {
                            // 协议相对URL
                            absoluteUrl = `${parsedUrl.protocol}${href}`;
                        }
                        
                        // 将原始域名替换为炮灰域名
                        if (absoluteUrl.includes(parsedUrl.host)) {
                            const newUrl = absoluteUrl.replace(parsedUrl.host, cannonFodderHost);
                            $(el).attr('href', newUrl);
                        }
                    } catch (e) {
                        console.error('处理链接时出错:', e);
                    }
                }
            });
            
            // 替换所有资源链接
            $('img, script, link, iframe, source').each((i, el) => {
                const src = $(el).attr('src') || $(el).attr('href');
                if (src) {
                    try {
                        // 处理相对URL和绝对URL
                        let absoluteUrl = src;
                        if (!src.startsWith('http') && !src.startsWith('//')) {
                            // 相对URL，转换为绝对URL
                            if (src.startsWith('/')) {
                                absoluteUrl = `${parsedUrl.protocol}//${parsedUrl.host}${src}`;
                            } else {
                                const baseDir = parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1);
                                absoluteUrl = `${parsedUrl.protocol}//${parsedUrl.host}${baseDir}${src}`;
                            }
                        } else if (src.startsWith('//')) {
                            // 协议相对URL
                            absoluteUrl = `${parsedUrl.protocol}${src}`;
                        }
                        
                        // 将原始域名替换为炮灰域名
                        if (absoluteUrl.includes(parsedUrl.host)) {
                            const newUrl = absoluteUrl.replace(parsedUrl.host, cannonFodderHost);
                            if ($(el).attr('src')) {
                                $(el).attr('src', newUrl);
                            } else {
                                $(el).attr('href', newUrl);
                            }
                        }
                    } catch (e) {
                        console.error('处理资源链接时出错:', e);
                    }
                }
            });
            
            // 替换内联样式中的URL
            $('[style]').each((i, el) => {
                const style = $(el).attr('style');
                if (style && style.includes('url(')) {
                    try {
                        const newStyle = style.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
                            if (url.includes(parsedUrl.host)) {
                                return `url(${url.replace(parsedUrl.host, cannonFodderHost)})`;
                            }
                            return match;
                        });
                        $(el).attr('style', newStyle);
                    } catch (e) {
                        console.error('处理内联样式时出错:', e);
                    }
                }
            });
            
            // 替换CSS中的URL
            $('style').each((i, el) => {
                const css = $(el).html();
                if (css && css.includes('url(')) {
                    try {
                        const newCss = css.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
                            if (url.includes(parsedUrl.host)) {
                                return `url(${url.replace(parsedUrl.host, cannonFodderHost)})`;
                            }
                            return match;
                        });
                        $(el).html(newCss);
                    } catch (e) {
                        console.error('处理CSS时出错:', e);
                    }
                }
            });
            
            // 替换base标签
            $('base').each((i, el) => {
                const href = $(el).attr('href');
                if (href && href.includes(parsedUrl.host)) {
                    $(el).attr('href', href.replace(parsedUrl.host, cannonFodderHost));
                }
            });
            
            // 如果启用了广告过滤
            if (req.query.removeAds === 'true') {
                html = filterContent($.html(), { removeAds: true });
            } else if (req.query.removeTrackers === 'true') {
                html = filterContent($.html(), { removeTrackers: true });
            } else {
                html = $.html();
            }
            
            res.send(html);
        } else {
            // 对于非HTML内容，直接转发
            res.send(response.data);
        }
    } catch (error) {
        console.error('代理请求失败:', error.message);
        
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({
                error: '代理请求超时',
                message: '请求目标网站超时，请稍后重试或尝试其他代理服务器',
                shouldUseCannon: true
            });
        }
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
            return res.status(502).json({
                error: '代理服务器连接失败',
                message: '无法连接到代理服务器，请尝试其他代理或直接访问',
                shouldUseCannon: true
            });
        }
        
        res.status(500).json({
            error: '代理请求失败',
            message: error.message,
            shouldUseCannon: true
        });
    }
});

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API 健康检查端点
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 新增：会话管理API
app.get('/api/sessions/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = getProxySession(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: '会话不存在或已过期' });
    }
    
    res.json({
        success: true,
        session: {
            id: session.id,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            settings: session.settings
        }
    });
});

// 新增：会话列表API (仅限管理员)
app.get('/api/sessions', (req, res) => {
    // 简单的管理员验证
    const adminKey = req.query.adminKey;
    if (adminKey !== process.env.ADMIN_KEY) {
        return res.status(403).json({ error: '未授权访问' });
    }
    
    const sessions = [];
    const sessionKeys = sessionCache.keys();
    
    for (const key of sessionKeys) {
        const session = sessionCache.get(key);
        if (session) {
            sessions.push({
                id: session.id,
                createdAt: session.createdAt,
                expiresAt: session.expiresAt,
                isExpired: session.expiresAt < Date.now()
            });
        }
    }
    
    res.json({
        success: true,
        total: sessions.length,
        sessions
    });
});

// 处理 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 如果不是在 Vercel 环境中，则启动本地服务器
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// 导出 app 以供 Vercel 使用
module.exports = app; 
