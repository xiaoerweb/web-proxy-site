const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// 启用CORS
app.use(cors());

// 解析请求体
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 提供静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 存储代理配置的目录
const CONFIG_DIR = path.join(__dirname, 'config');
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR);
}

// 代理配置文件路径
const CONFIG_FILE = path.join(CONFIG_DIR, 'proxy-config.json');

// 初始化配置
let proxyConfig = {
  routes: {},
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  }
};

// 如果配置文件存在，则加载
if (fs.existsSync(CONFIG_FILE)) {
  try {
    proxyConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    console.error('Error loading config file:', err);
  }
}

// 保存配置
function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(proxyConfig, null, 2));
  } catch (err) {
    console.error('Error saving config file:', err);
  }
}

// 基本代理中间件
app.use('/proxy', (req, res, next) => {
  // 从查询参数中获取目标URL
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).send('Missing target URL parameter');
  }
  
  try {
    // 创建动态代理
    const proxy = createProxyMiddleware({
      target: targetUrl,
      changeOrigin: true,
      pathRewrite: {
        [`^/proxy`]: '',
      },
      router: (req) => {
        return req.query.url;
      },
      onProxyReq: (proxyReq, req, res) => {
        // 添加默认请求头
        Object.keys(proxyConfig.defaultHeaders).forEach(header => {
          proxyReq.setHeader(header, proxyConfig.defaultHeaders[header]);
        });
        
        // 添加自定义请求头（如果有）
        const customHeaders = req.headers['x-custom-headers'];
        if (customHeaders) {
          try {
            const headers = JSON.parse(customHeaders);
            Object.keys(headers).forEach(header => {
              proxyReq.setHeader(header, headers[header]);
            });
          } catch (err) {
            console.error('Error parsing custom headers:', err);
          }
        }
      }
    });
    
    proxy(req, res, next);
  } catch (error) {
    res.status(500).send(`Proxy error: ${error.message}`);
  }
});

// 高级路由代理
app.use('/route/:routeId', (req, res, next) => {
  const routeId = req.params.routeId;
  const route = proxyConfig.routes[routeId];
  
  if (!route) {
    return res.status(404).send(`Route '${routeId}' not found`);
  }
  
  try {
    const proxy = createProxyMiddleware({
      target: route.target,
      changeOrigin: true,
      pathRewrite: route.pathRewrite || {},
      onProxyReq: (proxyReq, req, res) => {
        // 添加默认请求头
        Object.keys(proxyConfig.defaultHeaders).forEach(header => {
          proxyReq.setHeader(header, proxyConfig.defaultHeaders[header]);
        });
        
        // 添加路由特定的请求头
        if (route.headers) {
          Object.keys(route.headers).forEach(header => {
            proxyReq.setHeader(header, route.headers[header]);
          });
        }
      }
    });
    
    proxy(req, res, next);
  } catch (error) {
    res.status(500).send(`Proxy error: ${error.message}`);
  }
});

// API路由 - 获取所有路由配置
app.get('/api/routes', (req, res) => {
  res.json(proxyConfig.routes);
});

// API路由 - 创建新路由
app.post('/api/routes', (req, res) => {
  const { name, target, pathRewrite, headers } = req.body;
  
  if (!name || !target) {
    return res.status(400).json({ error: 'Name and target are required' });
  }
  
  const routeId = crypto.createHash('md5').update(name + Date.now()).digest('hex').substring(0, 8);
  
  proxyConfig.routes[routeId] = {
    name,
    target,
    pathRewrite: pathRewrite || {},
    headers: headers || {}
  };
  
  saveConfig();
  
  res.status(201).json({ 
    id: routeId,
    ...proxyConfig.routes[routeId]
  });
});

// API路由 - 更新路由
app.put('/api/routes/:routeId', (req, res) => {
  const routeId = req.params.routeId;
  
  if (!proxyConfig.routes[routeId]) {
    return res.status(404).json({ error: `Route '${routeId}' not found` });
  }
  
  const { name, target, pathRewrite, headers } = req.body;
  
  if (name) proxyConfig.routes[routeId].name = name;
  if (target) proxyConfig.routes[routeId].target = target;
  if (pathRewrite) proxyConfig.routes[routeId].pathRewrite = pathRewrite;
  if (headers) proxyConfig.routes[routeId].headers = headers;
  
  saveConfig();
  
  res.json(proxyConfig.routes[routeId]);
});

// API路由 - 删除路由
app.delete('/api/routes/:routeId', (req, res) => {
  const routeId = req.params.routeId;
  
  if (!proxyConfig.routes[routeId]) {
    return res.status(404).json({ error: `Route '${routeId}' not found` });
  }
  
  delete proxyConfig.routes[routeId];
  saveConfig();
  
  res.status(204).end();
});

// API路由 - 更新默认请求头
app.put('/api/default-headers', (req, res) => {
  const { headers } = req.body;
  
  if (!headers || typeof headers !== 'object') {
    return res.status(400).json({ error: 'Headers object is required' });
  }
  
  proxyConfig.defaultHeaders = headers;
  saveConfig();
  
  res.json(proxyConfig.defaultHeaders);
});

// 高级设置页面
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'advanced.html'));
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Advanced proxy server running on http://localhost:${PORT}`);
}); 