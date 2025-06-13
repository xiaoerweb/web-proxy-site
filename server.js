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
  try {
    // 这里可以替换为您自己的IP代理源
    // 以下是一些免费代理API的示例
    const response = await axios.get('https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=lastChecked&sort_type=desc&filterUpTime=50&speed=fast');
    
    if (response.data && response.data.data) {
      const newProxies = response.data.data.map(proxy => {
        return {
          ip: proxy.ip,
          port: proxy.port,
          protocol: proxy.protocols[0],
          country: proxy.country,
          countryCode: proxy.country_code,
          city: proxy.city,
          anonymity: proxy.anonymityLevel,
          uptime: proxy.upTime,
          speed: proxy.speed || 'medium'
        };
      });
      
      proxyIPs = newProxies.filter(proxy => proxy.protocol === 'http' || proxy.protocol === 'https');
      console.log(`成功获取 ${proxyIPs.length} 个代理IP`);
      
      // 按国家/地区分类
      proxyByCountry = {};
      proxyIPs.forEach(proxy => {
        if (!proxyByCountry[proxy.countryCode]) {
          proxyByCountry[proxy.countryCode] = [];
        }
        proxyByCountry[proxy.countryCode].push(proxy);
      });
      
      // 缓存代理IP列表
      proxyCache.set('proxyList', proxyIPs);
      proxyCache.set('proxyByCountry', proxyByCountry);
    }
  } catch (error) {
    console.error('获取代理IP失败:', error.message);
    // 如果获取失败，尝试从缓存中获取
    const cachedProxies = proxyCache.get('proxyList');
    const cachedProxyByCountry = proxyCache.get('proxyByCountry');
    if (cachedProxies) {
      proxyIPs = cachedProxies;
      console.log(`从缓存中获取 ${proxyIPs.length} 个代理IP`);
    }
    if (cachedProxyByCountry) {
      proxyByCountry = cachedProxyByCountry;
    }
  }
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

// API路由 - 获取当前代理IP列表
app.get('/api/proxies', (req, res) => {
  // 获取可用国家/地区列表
  const countries = Object.keys(proxyByCountry).map(code => {
    return {
      code: code,
      name: getCountryName(code),
      count: proxyByCountry[code].length
    };
  }).sort((a, b) => b.count - a.count);
  
  res.json({
    count: proxyIPs.length,
    countries: countries,
    proxies: proxyIPs.slice(0, 10) // 只返回前10个，避免泄露太多
  });
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

// 代理中间件配置
app.use('/proxy', async (req, res, next) => {
  // 从查询参数中获取目标URL
  const targetUrl = req.query.url;
  const useProxy = req.query.useProxy === 'true';
  const countryCode = req.query.country || null;
  
  // 获取过滤选项
  const filters = {
    removeAds: req.query.removeAds === 'true',
    removeTrackers: req.query.removeTrackers === 'true',
    removeSensitive: req.query.removeSensitive === 'true',
    addWarning: req.query.addWarning === 'true',
    optimize: req.query.optimize === 'true'
  };
  
  // 检查是否需要内容过滤或优化
  const needsProcessing = Object.values(filters).some(value => value === true);
  
  if (!targetUrl) {
    return res.status(400).send('缺少目标URL参数');
  }
  
  try {
    let proxyServer = null;
    
    // 如果请求使用代理
    if (useProxy) {
      proxyServer = getRandomProxy(countryCode);
      if (!proxyServer) {
        console.warn('没有可用的代理IP，使用直接连接');
      } else {
        console.log(`使用代理: ${proxyServer.protocol}://${proxyServer.ip}:${proxyServer.port} (${proxyServer.country})`);
      }
    }
    
    // 如果需要内容过滤或优化，使用自定义处理
    if (needsProcessing) {
      // 设置请求选项
      const requestOptions = {
        url: targetUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': targetUrl,
          'Accept-Encoding': 'gzip, deflate, br'
        }
      };
      
      // 如果有代理，使用代理
      if (proxyServer) {
        requestOptions.proxy = `${proxyServer.protocol}://${proxyServer.ip}:${proxyServer.port}`;
      }
      
      try {
        // 获取网页内容
        const response = await axios({
          method: 'get',
          url: targetUrl,
          headers: requestOptions.headers,
          ...(proxyServer && {
            proxy: {
              host: proxyServer.ip,
              port: proxyServer.port,
              protocol: proxyServer.protocol
            }
          }),
          responseType: 'arraybuffer',
          decompress: true
        });
        
        // 检查内容类型
        const contentType = response.headers['content-type'] || '';
        
        // 解码响应数据
        let responseData;
        const encoding = response.headers['content-encoding'];
        
        if (encoding === 'gzip') {
          responseData = zlib.gunzipSync(response.data).toString('utf8');
        } else if (encoding === 'deflate') {
          responseData = zlib.inflateSync(response.data).toString('utf8');
        } else if (encoding === 'br') {
          responseData = zlib.brotliDecompressSync(response.data).toString('utf8');
        } else {
          responseData = response.data.toString('utf8');
        }
        
        // 只过滤HTML内容
        if (contentType.includes('text/html')) {
          // 处理内容
          const processedHtml = filterContent(responseData, filters);
          
          // 设置响应头
          res.setHeader('Content-Type', contentType);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'public, max-age=300');
          
          // 发送处理后的内容
          return res.send(processedHtml);
        } else {
          // 非HTML内容直接返回
          Object.keys(response.headers).forEach(header => {
            // 排除一些可能导致问题的头
            if (!['content-length', 'transfer-encoding', 'content-encoding'].includes(header.toLowerCase())) {
              res.setHeader(header, response.headers[header]);
            }
          });
          
          res.setHeader('Access-Control-Allow-Origin', '*');
          return res.send(response.data);
        }
      } catch (error) {
        console.error('获取内容失败:', error);
        return res.status(500).send(`获取内容失败: ${error.message}`);
      }
    } else {
      // 不需要过滤，使用标准代理中间件
      const proxyOptions = {
        target: targetUrl,
        changeOrigin: true,
        pathRewrite: {
          [`^/proxy`]: '',
        },
        router: (req) => {
          return req.query.url;
        },
        onProxyReq: (proxyReq, req, res) => {
          // 修改请求头以模拟浏览器
          proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
          
          // 添加Referer头，有些网站需要这个来防止盗链
          proxyReq.setHeader('Referer', targetUrl);
          
          // 如果有自定义请求头
          const customHeaders = req.headers['x-custom-headers'];
          if (customHeaders) {
            try {
              const headers = JSON.parse(customHeaders);
              Object.keys(headers).forEach(header => {
                proxyReq.setHeader(header, headers[header]);
              });
            } catch (err) {
              console.error('解析自定义请求头失败:', err);
            }
          }
        },
        onProxyRes: (proxyRes, req, res) => {
          // 修改响应头，允许跨域
          proxyRes.headers['Access-Control-Allow-Origin'] = '*';
          
          // 修改响应头，允许缓存
          proxyRes.headers['Cache-Control'] = 'public, max-age=300';
        },
        onError: (err, req, res) => {
          console.error('代理错误:', err);
          res.status(500).send(`代理错误: ${err.message}`);
        }
      };
      
      // 如果有可用代理，设置代理
      if (proxyServer) {
        proxyOptions.agent = new HttpsProxyAgent(`${proxyServer.protocol}://${proxyServer.ip}:${proxyServer.port}`);
      }
      
      const proxyMiddleware = createProxyMiddleware(proxyOptions);
      proxyMiddleware(req, res, next);
    }
  } catch (error) {
    res.status(500).send(`代理错误: ${error.message}`);
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