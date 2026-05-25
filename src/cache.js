/**
 * src/cache.js - 缓存管理模块
 * 使用内存Map对象存储新闻数据缓存
 */

// 缓存数据结构：
// {
//   news: [...],           // 新闻数组
//   lastUpdate: Date,      // 最后更新时间
//   source: 'cron' | 'manual'  // 数据来源
// }

class NewsCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * 设置缓存数据
   * @param {string} key - 缓存键名
   * @param {object} data - 要缓存的数据 {news, lastUpdate, source}
   */
  set(key, data) {
    const cacheItem = {
      data: data,
      timestamp: Date.now()
    };
    this.cache.set(key, cacheItem);
  }

  /**
   * 获取缓存数据
   * @param {string} key - 缓存键名
   * @returns {object|null} - 返回缓存数据或null（如果不存在）
   */
  get(key) {
    const cacheItem = this.cache.get(key);
    if (!cacheItem) return null;
    return cacheItem.data;
  }

  /**
   * 获取缓存数据及其时间戳
   * @param {string} key - 缓存键名
   * @returns {{ data: object|null, age: number }} - 数据和年龄(毫秒)
   */
  getWithAge(key) {
    const cacheItem = this.cache.get(key);
    if (!cacheItem) return { data: null, age: Infinity };
    return { data: cacheItem.data, age: Date.now() - cacheItem.timestamp };
  }

  /**
   * 检查缓存是否存在
   * @param {string} key - 缓存键名
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * 清除指定缓存
   * @param {string} key - 缓存键名，不传则清除所有
   */
  clear(key) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * 获取所有缓存的键名
   * @returns {string[]}
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * 批量设置缓存
   * @param {Map<string, object>} items - 键值对Map
   */
  setMultiple(items) {
    for (const [key, value] of items) {
      this.set(key, value);
    }
  }

  /**
   * 获取缓存统计信息
   * @returns {object}
   */
  getStats() {
    const stats = {
      totalKeys: this.cache.size,
      keys: [],
      oldestEntry: null,
      newestEntry: null
    };

    let oldestTime = Infinity;
    let newestTime = 0;

    for (const [key, item] of this.cache) {
      stats.keys.push(key);
      if (item.timestamp < oldestTime) {
        oldestTime = item.timestamp;
        stats.oldestEntry = { key, timestamp: item.timestamp };
      }
      if (item.timestamp > newestTime) {
        newestTime = item.timestamp;
        stats.newestEntry = { key, timestamp: item.timestamp };
      }
    }

    return stats;
  }
}

// 导出单例
module.exports = new NewsCache();
