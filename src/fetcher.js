/**
 * src/fetcher.js - 数据拉取模块（爬虫方案）
 * 使用cheerio抓取各平台网页获取热点新闻，每个来源限制10条
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { classifyNewsList } = require('./classifier');

// Puppeteer配置（用于绕过反爬保护）
let puppeteerInstance = null;
async function getPuppeteer() {
  if (!puppeteerInstance) {
    const puppeteer = require('puppeteer');
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
    puppeteerInstance = await puppeteer.launch({
      headless: 'new',
      executablePath: executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
  }
  return puppeteerInstance;
}

// Puppeteer并发锁，确保同时只处理一个页面
let puppeteerBusy = false;
const puppeteerQueue = [];
async function withPuppeteerLock(fn) {
  return new Promise((resolve, reject) => {
    puppeteerQueue.push({ fn, resolve, reject });
    if (!puppeteerBusy) processQueue();
  });
}
async function processQueue() {
  if (puppeteerBusy || puppeteerQueue.length === 0) return;
  puppeteerBusy = true;
  const { fn, resolve, reject } = puppeteerQueue.shift();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Puppeteer超时(25s)')), 25000))
    ]);
    resolve(result);
  } catch (e) {
    reject(e);
  } finally {
    puppeteerBusy = false;
    if (puppeteerQueue.length > 0) processQueue();
  }
}

async function fetchWithPuppeteer(url, timeoutMs = 20000) {
  return withPuppeteerLock(async () => {
    const browser = await getPuppeteer();
    let page;
    try {
      page = await browser.newPage();
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      });
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      } catch (navError) {
        // 即使导航超时，页面可能已有部分内容
        const content = await page.content();
        if (content && content.length > 2000) {
          console.log(`Puppeteer导航超时但有部分内容: ${url.substring(0, 40)} (${content.length}字节)`);
          return content;
        }
        throw navError;
      }
      await new Promise(r => setTimeout(r, 500));
      const content = await page.content();
      return content;
    } catch (error) {
      if (error.message && error.message.includes('timeout')) {
        console.log(`Puppeteer超时: ${url.substring(0, 50)}`);
      }
      throw error;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  });
}

// axios实例配置
const axiosInstance = axios.create({
  timeout: 10000,  // 10秒超时
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Connection': 'keep-alive'
  }
});

// 每个来源限制条数
const MAX_ITEMS_PER_SOURCE = 10;

// 数据源名称映射
const SOURCE_NAMES = {
  'guancha': '观察者网',
  'pingwest': '品玩',
  'mysdc': '驱动之家',
  'sina': '新浪新闻',
  'toutiao': '今日头条',
  'wangyi': '网易新闻',
  'tencent': '腾讯新闻',
  'sohu': '搜狐新闻',
  'huxiu': '虎嗅',
  'thepaper': '澎湃新闻',
  'ithome': 'IT之家'
};

/**
 * 统一格式化新闻数据
 */
function formatNewsItem(source, index, title, hot = 0, url = '#', time = '') {
  return {
    id: `${source}_${Date.now()}_${index}`,
    title: title.trim().substring(0, 200),
    hot: typeof hot === 'string' ? parseInt(hot.replace(/[^\d]/g, '')) || 0 : (hot || 0),
    url: url || '#',
    source: SOURCE_NAMES[source] || source,
    sourceKey: source,
    index: index,
    time: time  // 时间字符串
  };
}

/**
 * 从相对时间字符串获取时间
 */
function parseRelativeTime(timeStr) {
  const now = new Date();
  let date = new Date(now);

  if (timeStr.includes('分钟前')) {
    const mins = parseInt(timeStr.match(/(\d+)/)[1]);
    date = new Date(now - mins * 60000);
  } else if (timeStr.includes('小时前')) {
    const hours = parseInt(timeStr.match(/(\d+)/)[1]);
    date = new Date(now - hours * 3600000);
  } else if (timeStr.includes('天前')) {
    const days = parseInt(timeStr.match(/(\d+)/)[1]);
    date = new Date(now - days * 86400000);
  } else if (timeStr.includes('月') && timeStr.includes('日')) {
    // 格式: 5月20日
    const match = timeStr.match(/(\d+)月(\d+)日/);
    if (match) {
      const month = parseInt(match[1]) - 1;
      const day = parseInt(match[2]);
      date = new Date(now.getFullYear(), month, day);
    }
  } else if (timeStr.includes('今天')) {
    const match = timeStr.match(/今天(\d+):(\d+)/);
    if (match) {
      date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(match[1]), parseInt(match[2]));
    }
  }

  return date;
}

/**
 * 格式化时间显示（显示日期+小时，如 2026-5-21 14时）
 */
function formatTimeDisplay(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) return '';

  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = date.getHours();
  return `${y}-${m}-${d} ${h}时`;
}

/**
 * 从时间字符串获取Date对象
 */
function getTimeFromString(timeStr, defaultDate = new Date()) {
  if (!timeStr) return defaultDate;
  const date = parseRelativeTime(timeStr);
  return date;
}

// ==================== 1. 虎嗅（使用JSON API） ====================
async function fetchHuxiu() {
  try {
    const res = await axiosInstance.get(
      'https://article-api.huxiu.com/web/article/articleList?platform=www&pagesize=15',
      { timeout: 10000 }
    );
    const data = res.data;
    if (!data.success || !data.data || !data.data.dataList) return [];

    const articles = data.data.dataList;
    const news = [];
    const seenTitles = new Set();

    for (const item of articles) {
      if (news.length >= MAX_ITEMS_PER_SOURCE) break;

      const title = (item.title || '').trim();
      if (seenTitles.has(title) || title.length < 5) continue;
      if (title.includes('登录') || title.includes('注册')) continue;
      seenTitles.add(title);

      const url = item.share_url || `https://www.huxiu.com/article/${item.aid}.html`;
      const time = item.formatDate ? formatTimeDisplay(getTimeFromString(item.formatDate)) : formatTimeDisplay(new Date());

      news.push(formatNewsItem('huxiu', news.length + 1, title, 0, url, time));
    }

    return news;
  } catch (error) {
    console.error('获取虎嗅失败:', error.message);
    return [];
  }
}

// ==================== 2. 观察者网（深度抓取，使用Puppeteer绕过反爬） ====================
async function fetchGuancha() {
  try {
    // 先尝试普通请求
    let html;
    try {
      const res = await axiosInstance.get('https://www.guancha.cn/');
      html = res.data;
      // 检查是否被反爬拦截
      if (html.includes('EO_Bot_Ssid') || html.includes('__tst_status')) {
        throw new Error('被反爬拦截，切换到Puppeteer');
      }
    } catch (initialError) {
      // 切换到Puppeteer
      console.log('观察者网普通请求被拦截，使用Puppeteer...');
      html = await fetchWithPuppeteer('https://www.guancha.cn/');
    }

    const $ = cheerio.load(html);
    const news = [];
    const seenTitles = new Set();

    // 抓取所有文章链接
    $('a[href]').each((i, el) => {
      if (news.length >= MAX_ITEMS_PER_SOURCE) return false;

      const $el = $(el);
      const href = $el.attr('href') || '';
      const title = $el.text().trim();

      // 匹配文章URL格式: /internation/2026_05_21_817846.shtml 等
      const articleMatch = href.match(/^\/(internation|politics|economy|military|GuanJinRong|culture|society)\/\d{4}_\d{2}_\d+_\d+\.shtml$/);
      if (!articleMatch) return;

      // 跳过重复标题和无效标题
      if (seenTitles.has(title) || title.length < 10) return;
      if (title.includes('网站自律') || title.includes('登录') || title.includes('注册') || title.includes('APP')) return;

      seenTitles.add(title);

      // 补充完整URL
      let url = href.startsWith('http') ? href : 'https://www.guancha.cn' + href;

      // 从URL提取时间
      let timeStr = '';
      const urlMatch = href.match(/(\d{4}_\d{2}_\d{2})/);
      if (urlMatch) {
        const dateStr = urlMatch[1].replace(/_/g, '-');
        timeStr = formatTimeDisplay(new Date(dateStr));
      }

      news.push(formatNewsItem('guancha', news.length + 1, title, 0, url, timeStr));
    });

    return news;
  } catch (error) {
    console.error('获取观察者网失败:', error.message);
    return [];
  }
}

const { execSync } = require('child_process');

// 用curl绕过TLS指纹反爬（品玩等网站拦截Node.js TLS指纹）
async function fetchWithCurl(url) {
  try {
    const result = execSync(
      `curl -s -L --max-time 15 -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' -H 'Accept-Language: zh-CN,zh;q=0.9' '${url}'`,
      { timeout: 20000, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 }
    );
    return result;
  } catch (e) {
    throw new Error(`curl 请求失败: ${e.message}`);
  }
}
async function fetchPingwest() {
  let html = null;
  // 尝试方式1：axios 直接抓
  try {
    const res = await axiosInstance.get('https://www.pingwest.com/');
    const $try = cheerio.load(res.data);
    const count = $try('a.title').length;
    if (count > 2 || res.data.length > 5000) {
      html = res.data;
    }
  } catch (e) {
    console.log('品玩 axios 请求失败:', e.message);
  }

  // 尝试方式2：curl（绕过Node.js TLS指纹反爬）
  if (!html) {
    try {
      console.log('品玩使用 curl 备用方案...');
      html = await fetchWithCurl('https://www.pingwest.com/');
      console.log('品玩 curl 成功:', html ? html.length + '字节' : '空数据');
    } catch (e2) {
      console.error('品玩 curl 也失败:', e2.message);
    }
  }

  // 尝试方式3：Puppeteer 渲染（最后保底）
  if (!html) {
    try {
      console.log('品玩使用 Puppeteer 备用方案...');
      html = await fetchWithPuppeteer('https://www.pingwest.com/');
    } catch (e3) {
      console.error('品玩所有方案均失败');
      return [];
    }
  }

  try {
    const $ = cheerio.load(html);
    const news = [];
    const seenTitles = new Set();

    // 方案A：a.title（标准链接 + 标题）
    $('a.title').each((i, el) => {
      if (news.length >= MAX_ITEMS_PER_SOURCE) return false;

      const title = $(el).text().trim();
      let url = $(el).attr('href') || '';

      if (!url || !url.match(/\/\d+/)) return;
      if (seenTitles.has(title) || title.length < 5) return;
      seenTitles.add(title);

      if (url.startsWith('//')) {
        url = 'https:' + url;
      } else if (url.startsWith('/')) {
        url = 'https://www.pingwest.com' + url;
      }

      let timeStr = '';
      const $parent = $(el).closest('li, div, section');
      const timeEl = $parent.find('.time').first();
      if (timeEl.length) {
        timeStr = timeEl.text().trim();
        if (timeStr.includes('·')) {
          timeStr = timeStr.split('·')[1];
        }
      }

      if (title && title.length > 5 && url) {
        const time = timeStr ? formatTimeDisplay(getTimeFromString(timeStr)) : '';
        news.push(formatNewsItem('pingwest', news.length + 1, title, 0, url, time));
      }
    });

    // 方案B：如果方案A没拿到足够的数据，尝试其他选择器
    if (news.length < 3) {
      console.log('品玩方案A只拿到' + news.length + '条，尝试备用选择器...');
      // 尝试查找文章卡片中的链接和标题
      $('a[href*="/a/"], a[href*="/w/"]').each((i, el) => {
        if (news.length >= MAX_ITEMS_PER_SOURCE) return false;

        const title = $(el).text().trim();
        let url = $(el).attr('href') || '';

        if (!title || title.length < 5) return;
        if (seenTitles.has(title)) return;
        if (title.includes('热门话题') || title.includes('推荐作者')) return;
        seenTitles.add(title);

        if (url.startsWith('//')) url = 'https:' + url;
        else if (url.startsWith('/')) url = 'https://www.pingwest.com' + url;

        news.push(formatNewsItem('pingwest', news.length + 1, title, 0, url, ''));
      });
    }

    if (news.length === 0) {
      console.log('品玩: 所有方案均未获取到数据，原始HTML长度=' + html.length);
    } else {
      console.log('品玩: 成功获取 ' + news.length + ' 条');
    }

    return news;
  } catch (error) {
    console.error('获取品玩失败:', error.message);
    return [];
  }
}

// ==================== 4. 驱动之家 ====================
async function fetchMysdc() {
  try {
    const res = await axiosInstance.get('https://www.mydrivers.com/');
    const $ = cheerio.load(res.data);
    const news = [];
    const seenTitles = new Set();

    // 查找所有.news_plun元素，从它获取时间和链接
    const timeEls = $('.news_plun');
    timeEls.each((i, el) => {
      if (news.length >= MAX_ITEMS_PER_SOURCE) return false;

      const timeText = $(el).text().trim();
      // 时间格式: "2026-05-21 12:05  0  0  0  复制链接  QQ  微博  微信  QQ空间"
      const timeMatch = timeText.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2})/);
      if (!timeMatch) return;

      const timeStr = timeMatch[1] + ' ' + timeMatch[2] + '时';
      // 获取同一行的新闻链接
      const parent = $(el).parent();
      const linkEl = parent.find('a[href*="news.mydrivers.com"]').first();
      const href = linkEl.attr('href') || '';
      const title = linkEl.text().trim();

      if (!href || seenTitles.has(title) || title.length < 5) return;
      seenTitles.add(title);

      const url = href;
      news.push(formatNewsItem('mysdc', news.length + 1, title, 0, url, timeStr));
    });

    return news;
  } catch (error) {
    console.error('获取驱动之家失败:', error.message);
    return [];
  }
}

// ==================== 9. 新浪新闻 ====================
async function fetchSina() {
  try {
    const res = await axiosInstance.get('https://feed.mix.sina.com.cn/api/roll/get', {
      params: { pageid: 153, lid: 2515, k: '', num: 20, page: 1 }
    });
    const data = res.data;

    if (data.result && Array.isArray(data.result.data)) {
      return data.result.data.slice(0, MAX_ITEMS_PER_SOURCE).map((item, index) => {
        // 解析时间戳
        let timeDisplay = '';
        if (item.ctime) {
          const date = new Date(item.ctime * 1000);
          timeDisplay = formatTimeDisplay(date);
        }

        return formatNewsItem(
          'sina',
          index + 1,
          item.title,
          0,
          item.wapurl || item.url || '#',
          timeDisplay
        );
      });
    }
    return [];
  } catch (error) {
    console.error('获取新浪新闻失败:', error.message);
    return [];
  }
}

// ==================== 10. 今日头条（使用Puppeteer） ====================
async function fetchToutiao() {
  try {
    const html = await fetchWithPuppeteer('https://www.toutiao.com/');
    const $ = cheerio.load(html);
    const news = [];
    const seenTitles = new Set();

    $('a[href*="/article/"]').each((i, el) => {
      if (news.length >= MAX_ITEMS_PER_SOURCE) return false;

      const $el = $(el);
      let href = $el.attr('href') || '';
      let title = $el.text().trim();

      if (!href.match(/\/article\/\d+/)) return;
      if (seenTitles.has(title) || title.length < 5) return;
      seenTitles.add(title);

      let url = href.startsWith('http') ? href : 'https://www.toutiao.com' + href;
      const time = formatTimeDisplay(new Date());
      news.push(formatNewsItem('toutiao', news.length + 1, title, 0, url, time));
    });

    return news;
  } catch (error) {
    console.error('获取今日头条失败:', error.message);
    return [];
  }
}

// ==================== 11. 网易新闻（使用3g.163.com移动版，axios即可） ====================
async function fetchWangyi() {
  try {
    const res = await axiosInstance.get('https://3g.163.com/news', { timeout: 12000 });
    const $ = cheerio.load(res.data);
    const news = [];
    const seenTitles = new Set();

    $('a[href*="/news/article/"]').each((i, el) => {
      if (news.length >= MAX_ITEMS_PER_SOURCE) return false;

      const $el = $(el);
      const href = $el.attr('href') || '';

      // 从h4取标题，.s-source取来源，.s-replyCount取跟贴数
      const h4 = $el.find('h4').first();
      const title = h4.text().trim();

      const replyStr = $el.find('.s-replyCount').text().trim();
      let hot = 0;
      const hotMatch = replyStr.match(/(\d+)/);
      if (hotMatch) hot = parseInt(hotMatch[1]) || 0;

      if (!href.match(/\/news\/article\/[A-Z0-9]+\.html/i)) return;
      if (seenTitles.has(title) || title.length < 6) return;
      seenTitles.add(title);

      const url = href.startsWith('http') ? href : 'https://3g.163.com' + href;

      news.push(formatNewsItem('wangyi', news.length + 1, title, hot, url, formatTimeDisplay(new Date())));
    });

    return news;
  } catch (error) {
    console.error('获取网易新闻失败:', error.message);
    return [];
  }
}

// ==================== 12. 腾讯新闻（使用JSON API） ====================
async function fetchTencent() {
  try {
    const res = await axiosInstance.get(
      'https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=20',
      { timeout: 10000 }
    );
    const data = res.data;
    if (data.ret !== 0 || !data.idlist) return [];

    const news = [];
    const seenTitles = new Set();

    for (const group of data.idlist) {
      if (!group.newslist) continue;
      for (const item of group.newslist) {
        if (news.length >= MAX_ITEMS_PER_SOURCE) break;

        // 跳过特殊条目（ID以TIP开头的是栏目说明）
        if (item.id && item.id.startsWith('TIP')) continue;

        const title = (item.title || item.longtitle || '').trim();
        if (seenTitles.has(title) || title.length < 6) continue;
        seenTitles.add(title);

        const url = item.url || item.surl || `https://view.inews.qq.com/a/${item.id}`;
        const hot = item.readCount || item.commentNum || 0;
        const time = item.time ? formatTimeDisplay(new Date(item.time)) : '';

        news.push(formatNewsItem('tencent', news.length + 1, title, hot, url, time));
      }
      if (news.length >= MAX_ITEMS_PER_SOURCE) break;
    }

    return news;
  } catch (error) {
    console.error('获取腾讯新闻失败:', error.message);
    return [];
  }
}

// ==================== 13. 搜狐新闻（axios即可） ====================
async function fetchSohu() {
  try {
    const res = await axiosInstance.get('https://www.sohu.com/', { timeout: 12000 });
    const $ = cheerio.load(res.data);
    const news = [];
    const seenTitles = new Set();

    $('a[href]').each((i, el) => {
      if (news.length >= MAX_ITEMS_PER_SOURCE) return false;

      const $el = $(el);
      let href = $el.attr('href') || '';
      let title = $el.text().trim();

      // 匹配搜狐文章格式: www.sohu.com/a/1025413060_...
      if (!href.match(/www\.sohu\.com\/a\/\d+/)) return;
      if (seenTitles.has(title) || title.length < 5) return;
      seenTitles.add(title);

      let url = href.startsWith('http') ? href : 'https://' + href;
      news.push(formatNewsItem('sohu', news.length + 1, title, 0, url, formatTimeDisplay(new Date())));
    });

    return news;
  } catch (error) {
    console.error('获取搜狐新闻失败:', error.message);
    return [];
  }
}

// ==================== 澎湃新闻（带重试） ====================
async function fetchThePaper() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`澎湃新闻第${attempt + 1}次尝试...`);
        await new Promise(r => setTimeout(r, 2000)); // 重试前等2秒
      }
      const res = await axiosInstance.get('https://www.thepaper.cn/', { timeout: 12000 });
    const $ = cheerio.load(res.data);
    const news = [];
    const seenTitles = new Set();

    $('a[href*="newsDetail_"]').each((i, el) => {
      if (news.length >= MAX_ITEMS_PER_SOURCE) return false;

      const $el = $(el);
      let href = $el.attr('href') || '';
      let title = $el.text().trim().replace(/^推荐/, '');

      if (!href.match(/newsDetail_forward_\d+/)) return;
      if (href.includes('commTag=true')) return;
      if (seenTitles.has(title) || title.length < 6) return;
      seenTitles.add(title);

      let url = href.startsWith('http') ? href : 'https://www.thepaper.cn' + (href.startsWith('/') ? '' : '/') + href;
      news.push(formatNewsItem('thepaper', news.length + 1, title, 0, url, formatTimeDisplay(new Date())));
    });

    return news;
    } catch (error) {
      if (attempt === 0) {
        console.error('澎湃新闻抓取失败（将重试）:', error.message);
      } else {
        console.error('获取澎湃新闻失败（已重试）:', error.message);
        return [];
      }
    }
  }
}

// ==================== IT之家 ====================
async function fetchIthome() {
  try {
    const res = await axiosInstance.get('https://www.ithome.com/');
    const $ = cheerio.load(res.data);
    const news = [];
    const seenTitles = new Set();

    // IT之家文章链接格式: /0/953/623.htm (三段路径)
    $('a[href*="/0/"][href$=".htm"]').each((i, el) => {
      if (news.length >= MAX_ITEMS_PER_SOURCE) return false;

      const $el = $(el);
      let href = $el.attr('href') || '';
      let title = $el.text().trim();

      // 匹配文章URL格式: /0/xxx/xxx.htm
      if (!href.match(/\/0\/\d+\/\d+\.htm/)) return;
      if (seenTitles.has(title) || title.length < 6) return;

      // 过滤非新闻类链接
      if (title.includes('系统镜像') || title.includes('固件下载') || title.includes('描述文件')) return;

      seenTitles.add(title);

      let url = href.startsWith('http') ? href : 'https://www.ithome.com' + href;

      // 提取时间 - 从相邻元素查找
      let timeStr = '';
      const parentLi = $el.closest('li');
      if (parentLi.length) {
        const timeEl = parentLi.find('.time, time, span.time');
        if (timeEl.length) timeStr = timeEl.text().trim();
      }

      news.push(formatNewsItem('ithome', news.length + 1, title, 0, url, timeStr || formatTimeDisplay(new Date())));
    });

    return news;
  } catch (error) {
    console.error('获取IT之家失败:', error.message);
    return [];
  }
}

// ==================== 获取所有平台新闻 ====================
async function fetchAllNews() {
  console.log('开始拉取所有平台新闻...');

  const fetcherFunctions = [
    { name: '观察者网', fn: fetchGuancha },
    { name: '网易新闻', fn: fetchWangyi },
    { name: '腾讯新闻', fn: fetchTencent },
    { name: '搜狐新闻', fn: fetchSohu },
    { name: '新浪新闻', fn: fetchSina },
    { name: '驱动之家', fn: fetchMysdc },
    { name: '品玩', fn: fetchPingwest },
    { name: 'IT之家', fn: fetchIthome },
    { name: '虎嗅', fn: fetchHuxiu },
    { name: '澎湃新闻', fn: fetchThePaper }
  ];

  // 每个抓取器独立超时，互不影响
  const results = await Promise.allSettled(
    fetcherFunctions.map(f => Promise.race([
      f.fn(),
      new Promise(resolve => setTimeout(() => resolve([]), 60000))
    ]))
  );

  let allNews = [];
  const successCount = [];
  const failCount = [];

  results.forEach((result, index) => {
    const sourceName = fetcherFunctions[index].name;
    if (result.status === 'fulfilled') {
      const news = result.value || [];
      allNews = allNews.concat(news);
      if (news.length > 0) {
        successCount.push(`${sourceName}(${news.length}条)`);
      }
    } else {
      failCount.push(sourceName);
    }
  });

  // 按热度排序
  allNews.sort((a, b) => b.hot - a.hot);

  console.log(`新闻拉取完成: ${successCount.length > 0 ? '成功 ' + successCount.join(', ') : ''}${failCount.length > 0 ? ', 失败 ' + failCount.join(', ') : ''}，共${allNews.length}条`);

  return {
    news: allNews,
    lastUpdate: new Date().toISOString(),
    sources: {
      success: successCount,
      failed: failCount
    }
  };
}

module.exports = {
  fetchAllNews,
  fetchHuxiu,
  fetchGuancha,
  fetchPingwest,
  fetchMysdc,
  fetchSina,
  fetchToutiao,
  fetchWangyi,
  fetchTencent,
  fetchSohu,
  fetchThePaper,
  fetchIthome
};
