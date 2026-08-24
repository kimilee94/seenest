# Seenest · 拾见

Seenest 是一个本地优先的浏览器扩展。打开 X 帖子或文章详情时，它会自动保存公开正文、作者、头像、发布时间、原始链接和访问时间。详情页采集成功后会立即停止 DOM 监听，仅保留轻量的路由检查。

浏览记录支持搜索、时间筛选、JSON 备份以及 Excel（`.xlsx`）表格导出。

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm test
npm run build
npm run zip
```

构建产物位于 `.output/`。历史记录保存在扩展自己的 IndexedDB 中，设置保存在 `chrome.storage.local`，不会上传到服务器。
