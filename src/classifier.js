/**
 * src/classifier.js - 新闻分类逻辑模块
 * 根据标题关键词自动将新闻分类
 */

// 分类关键词配置
const CATEGORY_KEYWORDS = {
  '财经': ['股市', '基金', '经济', '金融', '投资', 'A股', '港股', '美股', '央行', '利率', '通胀', 'GDP', '银行', '保险', '理财', '税收', '财政策', '汇率', '股票', '行情', '涨跌', '收盘'],
  '科技': ['AI', '人工智能', '芯片', '半导体', '5G', '手机', '互联网', '软件', '硬件', '大模型', '航天', '新能源汽车', '苹果', '华为', '小米', 'ChatGPT', '机器人'],
  '娱乐': ['明星', '电影', '电视剧', '综艺', '音乐', '演唱会', '八卦', '艺人', '播出', '上映', '票房'],
  '美食': ['美食', '餐厅', '小吃', '菜谱', '火锅', '烧烤', '饮品', '探店', '米其林', '外卖'],
  '旅游': ['旅游', '景点', '景区', '酒店', '民宿', '机票', '假期', '出境游', '自驾游', '签证'],
  '体育': ['足球', '篮球', 'NBA', '世界杯', '奥运会', '游泳', '田径', '排球', '乒乓球', '羽毛球', '冠军', '联赛'],
  '教育': ['高考', '考研', '留学', '学校', '教育政策', '双减', '学区', '大学', '招生', '录取'],
  '生活': ['天气', '健康', '养生', '房产', '装修', '交通', '宠物', '地铁', '公交'],
  '社会': ['法治', '案件', '慈善', '民生', '社区', '志愿者', '事故', '举报'],
  '国际': ['美国', '日本', '欧洲', '外交', '联合国', '冲突', '制裁', '特朗普', '拜登', '普京', '北约']
};

// 分类颜色配置（用于前端显示）
const CATEGORY_COLORS = {
  '全部': '#007bff',
  '财经': '#dc3545',
  '科技': '#28a745',
  '娱乐': '#e83e8c',
  '美食': '#fd7e14',
  '旅游': '#17a2b8',
  '体育': '#6610f2',
  '教育': '#f16c3b',
  '生活': '#20c997',
  '社会': '#6c757d',
  '国际': '#e67e22',
  '其他': '#343a40'
};

// 分类优先级（按顺序匹配，匹配到则停止）
const CATEGORY_PRIORITY = ['国际', '财经', '科技', '娱乐', '美食', '旅游', '体育', '教育', '生活', '社会', '其他'];

/**
 * 对单条新闻进行分类
 * @param {object} news - 新闻对象
 * @returns {string} - 返回分类名称
 */
function classifyNews(news) {
  const title = (news.title || '').toLowerCase();
  const summary = (news.summary || '').toLowerCase();
  const text = (title + ' ' + summary).toLowerCase();

  for (const category of CATEGORY_PRIORITY) {
    if (category === '其他') break;
    const keywords = CATEGORY_KEYWORDS[category] || [];
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return category;
      }
    }
  }

  return '其他';
}

/**
 * 对新闻列表进行批量分类
 * @param {Array} newsList - 新闻数组
 * @returns {Array} - 返回带有分类标签的新闻数组
 */
function classifyNewsList(newsList) {
  return newsList.map(news => ({
    ...news,
    category: classifyNews(news)
  }));
}

/**
 * 获取所有分类列表
 * @returns {string[]}
 */
function getAllCategories() {
  return Object.keys(CATEGORY_KEYWORDS).concat(['其他']);
}

/**
 * 获取分类颜色
 * @param {string} category - 分类名称
 * @returns {string} - 返回十六进制颜色值
 */
function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS['其他'];
}

/**
 * 按分类统计新闻数量
 * @param {Array} newsList - 已分类的新闻数组
 * @returns {object} - 返回 {分类: 数量} 的对象
 */
function countByCategory(newsList) {
  const counts = {};
  for (const news of newsList) {
    const cat = news.category || '其他';
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return counts;
}

module.exports = {
  classifyNews,
  classifyNewsList,
  getAllCategories,
  getCategoryColor,
  countByCategory,
  CATEGORY_KEYWORDS,
  CATEGORY_COLORS,
  CATEGORY_PRIORITY
};
