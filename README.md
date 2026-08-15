# 英语学习工作台 - GitHub Pages 静态版

## 目录结构
pages/
  index.html      水平测评页
  study.html      学习任务页
  words.html      词库浏览页
  styles.css      公共样式
  app.js          共享库 (词库/状态/出题/AI调用)
  data/           词库 JSON (按等级拆分, 6MB)
    index.json    等级索引
    primary3.json ... cet6.json
  worker/         部署到 Cloudflare 的 AI 代理
    worker.js

## 部署步骤

### 1. GitHub Pages (托管前端)
1. 新建 GitHub 仓库, 把 pages/ 内容推上去
2. 仓库 Settings -> Pages -> Source 选 main 分支根目录
3. 等待 1-2 分钟, 得到 https://<user>.github.io/<repo>/

### 2. Cloudflare Workers (AI 代理)
1. 注册 cloudflare.com 账号
2. 打开 https://dash.cloudflare.com -> Workers & Pages -> 创建 Worker
3. 把 worker/worker.js 内容粘贴进去
4. Settings -> Variables -> 添加 DEEPSEEK_API_KEY = 你的 key
5. 部署, 得到 https://<name>.<subdomain>.workers.dev

### 3. 前端指向 Worker
编辑 pages/app.js 顶部:
const API_BASE = "https://你的-worker.workers.dev";
重新推送到 GitHub。

### 4. 手机访问
手机浏览器打开 https://<user>.github.io/<repo>/ 即可, 任何网络都行。

## 说明
- 打卡/积分/历史记录存手机 localStorage (换设备不共享)
- 词库按等级按需加载, 首次加载对应等级 JSON (最大 2MB)
- AI 功能: 测评/计划/作文命题/验收/翻译 全部走 Worker -> DeepSeek
- 词汇出题 (中译英/英译中/拼写/短语/句子/同根词) 在本地 JS 完成, 不消耗 API
