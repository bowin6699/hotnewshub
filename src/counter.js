/**
 * counter.js - 访问计数器模块
 * 使用文件存储实现持久化计数
 */

const fs = require('fs');
const path = require('path');

const COUNTER_FILE = path.join(__dirname, '../data/counter.json');

// 确保数据目录存在
function ensureDataDir() {
  const dataDir = path.dirname(COUNTER_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 读取计数器数据
function getCounterData() {
  ensureDataDir();
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      const data = fs.readFileSync(COUNTER_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('读取计数器失败:', error);
  }
  return {
    total: 0,
    today: 0,
    lastDate: getTodayStr()
  };
}

// 保存计数器数据
function saveCounterData(data) {
  ensureDataDir();
  try {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('保存计数器失败:', error);
  }
}

// 获取今天的日期字符串
function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

// 增加访问次数
function incrementVisits() {
  const data = getCounterData();
  const today = getTodayStr();

  // 如果是新的一天，重置今日计数
  if (data.lastDate !== today) {
    data.today = 0;
    data.lastDate = today;
  }

  data.total += 1;
  data.today += 1;
  saveCounterData(data);

  return {
    total: data.total,
    today: data.today
  };
}

// 获取访问统计
function getStats() {
  const data = getCounterData();
  const today = getTodayStr();

  // 如果是新的日期，今日数据已重置
  if (data.lastDate !== today) {
    return { total: data.total, today: 0 };
  }

  return {
    total: data.total,
    today: data.today
  };
}

module.exports = {
  incrementVisits,
  getStats
};
