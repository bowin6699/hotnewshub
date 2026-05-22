# HotNewsHub 热点新闻聚合站

汇集8大平台热点资讯，自动抓取、定时更新。

## 功能特性

- 聚合8大新闻平台：观察者网、品玩、驱动之家、新浪新闻、网易新闻、腾讯新闻、搜狐新闻、IT之家
- 每5分钟自动刷新数据
- 支持按来源筛选
- 支持关键词搜索
- 响应式设计，适配PC和移动端
- 显示访问统计

## 技术栈

- **后端**：Node.js + Express + node-cron
- **爬虫**：Cheerio + Puppeteer
- **前端**：原生HTML/CSS/JavaScript
- **部署**：Nginx反向代理

## 快速部署

### 环境要求

- Node.js 16+
- Chromium (用于Puppeteer)
- Nginx
- Linux服务器

### 安装步骤

1. 克隆项目
```bash
git clone https://github.com/你的用户名/HotNewsHub.git
cd HotNewsHub
```

2. 安装依赖
```bash
npm install
```

3. 配置Nginx反向代理（参考 nginx.conf）

4. 启动服务
```bash
node server.js
```

5. 访问 http://your-server:3000

### 生产环境部署

使用systemd管理进程或nohup后台运行。

## API接口

| 接口 | 说明 |
|------|------|
| GET /news/api/news | 获取新闻列表 |
| GET /news/api/refresh | 强制刷新数据 |
| GET /news/api/status | 查看缓存状态 |
| GET /news/api/visitStats | 访问统计 |

## 项目结构

```
HotNewsHub/
├── server.js          # Express服务器
├── package.json       # 依赖配置
├── public/            # 前端静态文件
│   ├── index.html
│   ├── app.js
│   └── style.css
└── src/              # 核心模块
    ├── fetcher.js     # 数据抓取
    ├── cache.js       # 缓存管理
    └── counter.js     # 访问计数
```

## 注意事项

- 部分新闻源需要Puppeteer绕过反爬机制
- 爬虫频率请遵守各平台robots.txt规定
- 请勿将本项目用于商业用途

## License

MIT
