const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const path = require('path');
const { fetchAllNews } = require('./src/fetcher');
const cache = require('./src/cache');
const { incrementVisits, getStats } = require('./src/counter');

const app = express();
const PORT = 3000;
const STALE_MS = 30 * 60 * 1000; // 30分钟判断数据是否陈旧

// 安全响应头
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// API 速率限制：每个 IP 每分钟最多 30 次
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '请求过于频繁，请稍后再试' }
});
app.use('/news/api', apiLimiter);

// 记录每次访问
app.use('/news/api/news', (req, res, next) => {
  incrementVisits();
  next();
});

// API路由：获取新闻（stale-while-revalidate模式）
app.get('/news/api/news', async (req, res) => {
  try {
const { data: cached, age } = cache.getWithAge('allNews');
    if (cached) {
      // 如果数据超过30分钟，后台异步刷新（不阻塞响应）
      if (age > STALE_MS) {
        refreshCacheInBackground();
      }
      return res.json({
        success: true,
        data: cached.news,
        lastUpdate: cached.lastUpdate,
        source: 'cache',
        cached: true
      });
    }

    // 缓存不存在（首次启动），同步拉取
    const result = await fetchAllNews();
    cache.set('allNews', result);
    res.json({
      success: true,
      data: result.news,
      lastUpdate: result.lastUpdate,
      source: 'fetch',
      cached: false
    });
  } catch (error) {
    console.error('API错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器内部错误'
    });
  }
});

// API路由：强制刷新数据（需要 Token 认证）
app.get('/news/api/refresh', async (req, res) => {
  const refreshToken = process.env.API_REFRESH_TOKEN;
  if (!refreshToken) {
    return res.status(500).json({ success: false, message: '服务端未配置刷新令牌' });
  }
  if (req.query.token !== refreshToken) {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  try {
    console.log('手动刷新数据...');
    const result = await fetchAllNews();
    cache.set('allNews', result);
    res.json({
      success: true,
      message: '刷新成功',
      data: result.news,
      lastUpdate: result.lastUpdate
    });
  } catch (error) {
    console.error('刷新错误:', error);
    res.status(500).json({
      success: false,
      message: '刷新失败'
    });
  }
});

// API路由：获取缓存状态
app.get('/news/api/status', (req, res) => {
  const stats = cache.getStats();
  const cached = cache.get('allNews');
  res.json({
    success: true,
    cached: !!cached,
    stats: stats,
    lastUpdate: cached ? cached.lastUpdate : null
  });
});

// API路由：访问统计
app.get('/news/api/visitStats', (req, res) => {
  res.json({
    success: true,
    data: getStats()
  });
});

// 启动时立即拉取一次数据
async function initialFetch() {
  console.log('首次启动，正在拉取新闻数据...');
  try {
    const result = await fetchAllNews();
    cache.set('allNews', result);
    console.log('初始数据加载完成');
  } catch (error) {
    console.error('初始数据加载失败:', error);
  }
}

// 后台异步刷新缓存（用户无感知）
let bgRefreshing = false;
async function refreshCacheInBackground() {
  if (bgRefreshing) return;
  bgRefreshing = true;
  console.log('后台刷新：检测到缓存数据陈旧，开始异步刷新...');
  try {
    const result = await fetchAllNews();
    cache.set('allNews', result);
    console.log('后台刷新完成');
  } catch (error) {
    console.error('后台刷新失败（下次自动重试）:', error.message);
  } finally {
    bgRefreshing = false;
  }
}

// 定时任务：每30分钟刷新一次数据（带并发保护）
let cronRunning = false;
cron.schedule('*/30 * * * *', async () => {
  if (cronRunning) {
    console.log('⏭ 上一次抓取未完成，跳过本次定时任务');
    return;
  }
  cronRunning = true;
  console.log('定时任务：开始刷新新闻数据...');
  try {
    const result = await fetchAllNews();
    cache.set('allNews', result);
    console.log('定时刷新完成');
  } catch (error) {
    console.error('定时刷新失败:', error);
  } finally {
    cronRunning = false;
  }
});

// 启动服务器
app.listen(PORT, async () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           HotNewsHub 新闻聚合站                           ║
║                                                           ║
║  服务已启动: http://localhost:${PORT}                        ║
║                                                           ║
║  访问页面: /news/                                          ║
║  API接口:                                                  ║
║  - GET /news/api/news     获取新闻列表                     ║
║  - GET /news/api/refresh  强制刷新数据（需 ?token=xxx）    ║
║  - GET /news/api/status   查看缓存状态                     ║
║                                                           ║
║  定时任务: 每30分钟自动刷新数据                             ║
║  安全功能: 速率限制(30次/分钟/IP) + 安全响应头             ║
╚═══════════════════════════════════════════════════════════╝
  `);
  await initialFetch();
});