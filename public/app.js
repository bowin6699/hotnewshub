/**
 * app.js - HotNewsHub 前端交互逻辑
 */

// 配置
const CONFIG = {
  pageSize: 20,           // 初始显示条数
  loadMoreCount: 20,     // 每次加载更多条数
  refreshInterval: 5 * 60 * 1000,  // 5分钟自动刷新
  apiUrl: '/news/api/news'
};

// 状态
let state = {
  allNews: [],
  filteredNews: [],
  displayedCount: CONFIG.pageSize,
  currentSource: '',  // 当前筛选的来源，''表示全部
  pendingSource: '',  // 等待数据加载完成后应用的来源
  searchKeyword: '',
  isLoading: false,
  lastUpdate: null
};

// DOM元素
const elements = {
  newsList: document.getElementById('newsList'),
  loading: document.getElementById('loading'),
  emptyState: document.getElementById('emptyState'),
  loadMoreContainer: document.getElementById('loadMoreContainer'),
  loadMoreBtn: document.getElementById('loadMoreBtn'),
  lastUpdate: document.getElementById('lastUpdate'),
  visitStats: document.getElementById('visitStats'),
  totalCount: document.getElementById('totalCount'),
  filteredCount: document.getElementById('filteredCount'),
  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  categoryTabs: document.getElementById('categoryTabs'),
  refreshBtn: document.getElementById('refreshBtn')
};

// 来源颜色映射
const sourceColors = {
  'toutiao': '#e60012', // 今日头条
  'guancha': '#e60012', // 观察者网
  'wangyi': '#1d87c5',  // 网易新闻
  'tencent': '#df2d32', // 腾讯新闻
  'sohu': '#ff7a00',    // 搜狐新闻
  'sina': '#e6162d',    // 新浪新闻
  'mysdc': '#3366ff',   // 驱动之家
  'pingwest': '#e4007f'  // 品玩
};

// 来源favicon映射
const sourceFavicons = {
  'toutiao': 'https://www.toutiao.com/favicon.ico',
  'guancha': 'https://www.guancha.cn/favicon.ico',
  'wangyi': 'https://www.163.com/favicon.ico',
  'tencent': 'https://www.qq.com/favicon.ico',
  'sohu': 'https://www.sohu.com/favicon.ico',
  'sina': 'https://www.sina.com.cn/favicon.ico',
  'mysdc': 'https://www.mydrivers.com/favicon.ico',
  'pingwest': 'https://www.pingwest.com/favicon.ico'
};

/**
 * 初始化
 */
async function init() {
  setupEventListeners();
  await fetchNews();
  await fetchVisitStats();
  // 设置自动刷新
  setInterval(fetchNews, CONFIG.refreshInterval);
}

/**
 * 获取访问统计
 */
async function fetchVisitStats() {
  try {
    const response = await fetch('/news/api/visitStats');
    const result = await response.json();
    if (result.success) {
      elements.visitStats.textContent = `总访问: ${result.data.total} | 今日访问: ${result.data.today}`;
    }
  } catch (error) {
    console.error('获取访问统计失败:', error);
  }
}

/**
 * 设置事件监听
 */
function setupEventListeners() {
  // 搜索
  elements.searchInput.addEventListener('input', debounce(handleSearch, 300));
  elements.clearSearch.addEventListener('click', clearSearch);

  // 来源标签点击
  elements.categoryTabs.addEventListener('click', handleSourceClick);

  // 加载更多
  elements.loadMoreBtn.addEventListener('click', loadMore);

  // 刷新按钮
  elements.refreshBtn.addEventListener('click', handleRefresh);
}

/**
 * 获取新闻数据
 */
async function fetchNews() {
  if (state.isLoading) return;

  state.isLoading = true;
  elements.loading.style.display = 'block';
  elements.refreshBtn.classList.add('loading');

  try {
    const response = await fetch(CONFIG.apiUrl);
    const result = await response.json();

    if (result.success) {
      state.allNews = result.data;
      state.lastUpdate = result.lastUpdate;
      updateLastUpdateTime();

      // 如果有待应用的来源筛选，先应用
      if (state.pendingSource) {
        state.currentSource = state.pendingSource;
        state.pendingSource = '';
        // 更新tab高亮
        document.querySelectorAll('.category-tab').forEach(t => {
          t.classList.toggle('active', t.dataset.source === state.currentSource);
        });
      }

      filterAndRender();
    } else {
      console.error('获取数据失败:', result.message);
      showEmptyState('获取数据失败，请刷新重试');
    }
  } catch (error) {
    console.error('请求错误:', error);
    showEmptyState('网络错误，请检查连接');
  } finally {
    state.isLoading = false;
    elements.loading.style.display = 'none';
    elements.refreshBtn.classList.remove('loading');
  }
}

/**
 * 筛选并渲染新闻
 */
function filterAndRender() {
  let filtered = [...state.allNews];

  // 按来源筛选
  if (state.currentSource) {
    filtered = filtered.filter(news => news.sourceKey === state.currentSource);
  }

  // 按关键词搜索
  if (state.searchKeyword) {
    const keyword = state.searchKeyword.toLowerCase();
    filtered = filtered.filter(news =>
      news.title.toLowerCase().includes(keyword)
    );
  }

  state.filteredNews = filtered;
  state.displayedCount = CONFIG.pageSize;

  updateStats();
  renderNews();
}

/**
 * 渲染新闻列表
 */
function renderNews() {
  const newsToShow = state.filteredNews.slice(0, state.displayedCount);

  if (newsToShow.length === 0) {
    elements.newsList.innerHTML = '';
    showEmptyState();
    return;
  }

  elements.newsList.innerHTML = newsToShow.map((news, index) => `
    <div class="news-card" data-url="${news.url}" data-index="${index}">
      <div class="news-index">${index + 1}</div>
      <div class="news-content">
        <h3 class="news-title">
          <a href="${news.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(news.title)}</a>
        </h3>
        <div class="news-meta">
          <span class="news-source">
            <img src="${sourceFavicons[news.sourceKey] || ''}" alt="${news.source}"
                 onerror="this.style.display='none'">
            ${escapeHtml(news.source)}
          </span>
          ${news.time ? `<span class="news-time">(${news.time})</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  // 绑定点击事件（整张卡片可点击）
  document.querySelectorAll('.news-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // 如果点击的是链接则不处理跳转
      if (e.target.closest('a')) return;
      const url = card.dataset.url;
      if (url && url !== '#') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    });
  });

  // 更新加载更多按钮
  elements.loadMoreContainer.style.display =
    state.displayedCount < state.filteredNews.length ? 'block' : 'none';

  hideEmptyState();
}

/**
 * 加载更多
 */
function loadMore() {
  state.displayedCount += CONFIG.loadMoreCount;
  renderNews();
}

/**
 * 处理搜索
 */
function handleSearch(e) {
  state.searchKeyword = e.target.value.trim();
  elements.clearSearch.style.display = state.searchKeyword ? 'block' : 'none';
  filterAndRender();
}

/**
 * 清空搜索
 */
function clearSearch() {
  elements.searchInput.value = '';
  state.searchKeyword = '';
  elements.clearSearch.style.display = 'none';
  filterAndRender();
}

/**
 * 处理来源标签点击
 */
function handleSourceClick(e) {
  const tab = e.target.closest('.category-tab');
  if (!tab) return;

  const selectedSource = tab.dataset.source || '';

  // 更新active状态
  document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');

  if (state.isLoading || state.allNews.length === 0) {
    // 数据还在加载中，先记录要切换的来源
    state.pendingSource = selectedSource;
    return;
  }

  state.currentSource = selectedSource;
  state.pendingSource = '';
  filterAndRender();
}

/**
 * 处理刷新
 */
async function handleRefresh() {
  await fetchNews();
}

/**
 * 更新统计信息
 */
function updateStats() {
  elements.totalCount.textContent = `共 ${state.allNews.length} 条新闻`;
  elements.filteredCount.textContent = `已筛选 ${state.filteredNews.length} 条`;
}

/**
 * 更新最后更新时间
 */
function updateLastUpdateTime() {
  if (state.lastUpdate) {
    const date = new Date(state.lastUpdate);
    elements.lastUpdate.textContent = `最后更新: ${formatTime(date)}`;
  }
}

/**
 * 显示空状态
 */
function showEmptyState(message) {
  elements.newsList.innerHTML = '';
  elements.emptyState.style.display = 'block';
  elements.loadMoreContainer.style.display = 'none';
  if (message) {
    elements.emptyState.querySelector('p').textContent = message;
  }
}

/**
 * 隐藏空状态
 */
function hideEmptyState() {
  elements.emptyState.style.display = 'none';
}

/**
 * 工具函数：防抖
 */
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 工具函数：格式化时间
 */
function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * 工具函数：格式化热度值
 */
function formatHot(hot) {
  if (!hot) return '0';
  if (hot >= 100000000) return (hot / 100000000).toFixed(1) + '亿';
  if (hot >= 10000) return (hot / 10000).toFixed(1) + '万';
  return hot.toLocaleString();
}

/**
 * 工具函数：HTML转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 启动
document.addEventListener('DOMContentLoaded', init);
