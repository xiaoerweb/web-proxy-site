const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const NodeCache = require('node-cache');
const { HttpsProxyAgent } = require('https-proxy-agent');
const cheerio = require('cheerio');
const zlib = require('zlib');
const { minify } = require('terser');
const CleanCSS = require('clean-css');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

// 创建一个缓存实例，用于存储代理IP和优化后的资源
const proxyCache = new NodeCache({ stdTTL: 600, checkperiod: 60 });
const resourceCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 });

// 炮灰域名配置
const CANNON_FODDER_DOMAIN = process.env.CANNON_FODDER_DOMAIN || '4is.cc'; // 替换为您的域名，不要包含*或子域名

// 启用CORS
app.use(cors());

// 解析请求体
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 提供静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 代理IP列表
let proxyIPs = [];
// 按国家/地区分类的代理IP
let proxyByCountry = {};

// 获取代理IP列表
async function fetchProxyIPs() {
  const proxyApis = [
    {
      url: 'https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=lastChecked&sort_type=desc&filterUpTime=90&protocols=http,https',
      parser: (data) => data.data.map(proxy => ({
        ip: proxy.ip,
        port: proxy.port,
        protocol: proxy.protocols[0],
        country: proxy.country,
        countryCode: proxy.country_code,
        city: proxy.city,
        anonymity: proxy.anonymityLevel,
        uptime: proxy.upTime,
        speed: proxy.speed || 'medium'
      }))
    },
    {
      url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
      parser: (data) => data.split('\n').filter(line => line.trim()).map(line => {
        const [ip, port] = line.split(':');
        return {
          ip,
          port: parseInt(port),
          protocol: 'http',
          country: 'Unknown',
          countryCode: 'XX',
          city: 'Unknown',
          anonymity: 'unknown',
          uptime: 100,
          speed: 'medium'
        };
      })
    },
    {
      url: 'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all&format=json',
      parser: (data) => {
        try {
          const proxies = JSON.parse(data);
          return proxies.map(proxy => ({
            ip: proxy.ip,
            port: proxy.port,
            protocol: proxy.protocol,
            country: proxy.country || 'Unknown',
            countryCode: proxy.countryCode || 'XX',
            city: 'Unknown',
            anonymity: proxy.anonymity || 'unknown',
            uptime: 100,
            speed: 'medium'
          }));
        } catch (e) {
          return [];
        }
      }
    }
  ];

  let successfulFetch = false;
  let newProxies = [];

  for (const api of proxyApis) {
    try {
      console.log(`尝试从 ${api.url} 获取代理IP...`);
      const response = await axios.get(api.url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (response.data) {
        const parsedProxies = api.parser(response.data);
        if (parsedProxies && parsedProxies.length > 0) {
          newProxies = parsedProxies;
          successfulFetch = true;
          console.log(`成功从 ${api.url} 获取 ${newProxies.length} 个代理IP`);
          break;
        }
      }
    } catch (error) {
      console.error(`从 ${api.url} 获取代理IP失败:`, error.message);
      continue;
    }
  }

  if (!successfulFetch) {
    console.error('所有代理源获取失败，尝试使用缓存');
    const cachedProxies = proxyCache.get('proxyList');
    if (cachedProxies) {
      newProxies = cachedProxies;
      console.log(`从缓存中获取 ${newProxies.length} 个代理IP`);
    }
  }

  // 更新代理IP列表
  proxyIPs = newProxies.filter(proxy => proxy.protocol === 'http' || proxy.protocol === 'https');
  
  // 按国家/地区分类
  proxyByCountry = {};
  proxyIPs.forEach(proxy => {
    if (!proxyByCountry[proxy.countryCode]) {
      proxyByCountry[proxy.countryCode] = [];
    }
    proxyByCountry[proxy.countryCode].push(proxy);
  });
  
  // 缓存代理IP列表
  if (proxyIPs.length > 0) {
    proxyCache.set('proxyList', proxyIPs);
    proxyCache.set('proxyByCountry', proxyByCountry);
  }

  // 返回代理IP数量
  return proxyIPs.length;
}

// 初始获取代理IP
fetchProxyIPs();

// 每10分钟刷新一次代理IP列表
setInterval(fetchProxyIPs, 10 * 60 * 1000);

// 获取随机代理IP
function getRandomProxy(countryCode = null) {
  if (proxyIPs.length === 0) {
    return null;
  }
  
  // 如果指定了国家/地区代码
  if (countryCode && proxyByCountry[countryCode] && proxyByCountry[countryCode].length > 0) {
    const countryProxies = proxyByCountry[countryCode];
    const randomIndex = Math.floor(Math.random() * countryProxies.length);
    return countryProxies[randomIndex];
  }
  
  // 否则随机选择
  const randomIndex = Math.floor(Math.random() * proxyIPs.length);
  return proxyIPs[randomIndex];
}

// 获取代理IP列表的API
app.get('/api/proxies', async (req, res) => {
  try {
    const protocol = req.query.protocol || 'https';
    const count = protocol === 'https' ? 20 : 2;
    
    const response = await axios.get(`https://proxy.scdn.io/api/get_proxy.php?protocol=${protocol}&count=${count}`, {
      timeout: 10000
    });
    
    // 直接返回API的响应数据
    res.json(response.data);
  } catch (error) {
    console.error('获取代理列表失败:', error);
    res.status(500).json({
      error: '获取代理列表失败',
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

  // 生成随机子域名
  const randomPrefix = Math.random().toString(36).substring(2, 10);
  const cannonFodderHost = `${randomPrefix}.${CANNON_FODDER_DOMAIN}`;
  
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
      if (protocol === 'https') {
        requestOptions.httpsAgent = new HttpsProxyAgent(`${protocol}://${proxyHost}:${proxyPort}`);
      } else {
        requestOptions.proxy = {
          host: proxyHost,
          port: proxyPort,
          protocol: protocol
        };
      }
      console.log(`使用代理: ${protocol}://${proxyHost}:${proxyPort}`);
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
        message: '请求目标网站超时，请稍后重试或尝试其他代理服务器'
      });
    }
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      return res.status(502).json({
        error: '代理服务器连接失败',
        message: '无法连接到代理服务器，请尝试其他代理或直接访问'
      });
    }
    
    res.status(500).json({
      error: '代理请求失败',
      message: error.message
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

// 调试路由 - 查看代理状态
app.get('/debug/proxies', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.write(`
    <html>
      <head>
        <title>代理调试</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          tr:nth-child(even) { background-color: #f9f9f9; }
          .refresh { background-color: #4CAF50; color: white; border: none; padding: 10px 15px; cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>代理服务器调试</h1>
        <p>当前时间: ${new Date().toISOString()}</p>
        <p>代理IP总数: ${proxyIPs.length}</p>
        <p>国家/地区数: ${Object.keys(proxyByCountry).length}</p>
        <button class="refresh" onclick="window.location.reload()">刷新</button>
        <button class="refresh" onclick="window.location.href='/debug/proxies?refresh=true'">强制刷新代理</button>
        <h2>代理IP列表 (前20个)</h2>
        <table>
          <tr>
            <th>IP</th>
            <th>端口</th>
            <th>协议</th>
            <th>国家</th>
            <th>城市</th>
            <th>匿名度</th>
            <th>在线率</th>
          </tr>
  `);

  // 显示前20个代理
  const proxiesToShow = proxyIPs.slice(0, 20);
  proxiesToShow.forEach(proxy => {
    res.write(`
      <tr>
        <td>${proxy.ip}</td>
        <td>${proxy.port}</td>
        <td>${proxy.protocol}</td>
        <td>${proxy.country} (${proxy.countryCode})</td>
        <td>${proxy.city || 'N/A'}</td>
        <td>${proxy.anonymity}</td>
        <td>${proxy.uptime}%</td>
      </tr>
    `);
  });

  res.write(`
        </table>
        <h2>按国家/地区分类</h2>
        <table>
          <tr>
            <th>国家/地区</th>
            <th>代理数量</th>
          </tr>
  `);

  // 显示国家/地区统计
  Object.keys(proxyByCountry).forEach(code => {
    const countryName = getCountryName(code);
    const count = proxyByCountry[code].length;
    res.write(`
      <tr>
        <td>${countryName} (${code})</td>
        <td>${count}</td>
      </tr>
    `);
  });

  res.write(`
        </table>
      </body>
    </html>
  `);
  res.end();

  // 如果请求中包含refresh=true参数，刷新代理列表
  if (req.query.refresh === 'true') {
    fetchProxyIPs().then(count => {
      console.log(`调试页面触发刷新，获取到 ${count} 个代理IP`);
    });
  }
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
