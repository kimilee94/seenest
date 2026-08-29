<p align="center">
  <img src="./public/icons/seenest-logo.png" width="96" height="96" alt="Seenest 标志" />
</p>

<h1 align="center">Seenest</h1>

<p align="center"><strong>让每一次所见，都有归处。</strong></p>

<p align="center">把想再次找到的帖子、文章和视频，安静地收进属于你的地方。</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

Seenest 是一款本地优先的浏览器扩展。打开已支持网站的帖子、文章或视频详情页后，它会把公开内容和来源链接安静地收在本机，需要时可以搜索并回到原始页面。

Seenest 来自 **Seen + Nest**。你在互联网上认真看过的内容，都可以回到同一个属于自己的 Nest，给每一次有价值的所见一个归处。

Seenest 从产品设计上面向多个内容平台。当前版本已支持 **X / Twitter 帖子与文章**，以及 **哔哩哔哩视频详情页**。B 站适配器只会在用户主动开启后请求站点权限。

无需 Seenest 账号，不依赖 Seenest 服务器，当前也没有统计分析或 AI 处理。除非你主动导出或备份，Seenest 收好的内容只保存在自己的设备中。

## 功能

- 自动收好已支持的帖子、长文章和视频详情页
- 保存原始链接、标题、正文、作者、头像、发布时间和最后访问时间
- 收好各平台公开展示的评论、转发或分享、浏览、收藏和喜欢数量
- 保存 B 站 UP 主主页、头像、视频时长和封面；不保存会过期的播放地址
- 每份内容只保留一个 Memory 条目，每次真实进入页面则单独留下一个 Visit
- 仅在已收好页面可见、窗口聚焦且用户未空闲时统计近似活跃停留时间
- 支持按标题、正文、作者和链接搜索
- 支持来源及日期筛选、按天分组和分页查看
- 点击内容即可跳转到原始页面
- 支持将 Seenest 所见存档导出为 JSON 和 Excel（`.xlsx`）
- 可主动选择一个本地 JSON 文件，用于自动生成本地快照

## 支持的网站

| 平台 | 状态 | 收录范围 |
| --- | --- | --- |
| X / Twitter | 已支持 | 帖子与长文章详情页 |
| 哔哩哔哩 | 已支持，需主动开启 | 视频详情页 |
| 其他平台 | 规划中 | 通过独立适配器和明确的网站访问授权加入 |

Seenest 不会采集首页信息流、私信、Cookie、密码，也不会读取未启用网站的浏览活动。

## 工作方式

```text
打开已支持的内容详情页
  -> 短暂等待页面或路由稳定
  -> 提取公开内容，或请求平台的公开元数据
  -> 按平台和内容 ID 收好或更新一个 Memory
  -> 为本次真实进入页面追加一个 Visit
  -> 停止本次短时 DOM 监听
```

X 使用单页应用路由，因此 Seenest 会进行轻量的地址检查。DOM 观察器只在短时采集会话中运行，并在采集成功、超时或切换页面后停止。B 站则从已打开的视频地址读取 BVID，再不带 Cookie 地请求一次 B 站公开视频详情接口，不扫描首页信息流，也不会长期监听 DOM。

## 从源码安装

需要当前版本的 Node.js、npm，以及支持 Manifest V3 的 Chrome 或其他 Chromium 浏览器。

1. 克隆或下载本仓库。
2. 安装依赖并构建扩展：

   ```bash
   npm ci
   npm run build
   ```

3. 打开 `chrome://extensions`。
4. 开启右上角的“开发者模式”。
5. 点击“加载已解压的扩展程序”，选择项目中的 `.output/chrome-mv3` 文件夹。
6. 打开一个已支持的 X 详情页。如需收好 B 站视频，请在 Seenest 的“网站权限”中开启哔哩哔哩，确认可选站点授权后再访问视频详情页。

更新本地安装版本时，拉取最新代码，重新运行 `npm ci` 和 `npm run build`，再到 `chrome://extensions` 中点击现有 Seenest 卡片上的“重新加载”。只要继续加载同一个解压目录，Chrome 会更新现有扩展，不会另外安装一份。

## 开发

```bash
npm ci
npm run dev
```

如需查看带本地演示数据的 Seenest 页面：

```bash
npm run preview:ui
```

随后访问 `http://localhost:3000/preview.html`。预览页面使用独立的网站数据库，不会读取或修改真实扩展数据。

检查代码并生成生产安装包：

```bash
npm run typecheck
npm run build
npm run zip
```

构建文件和 ZIP 安装包会生成到 `.output/`，该目录不会提交到 Git。面向用户发布的 ZIP 或 CRX 应上传到 GitHub Releases，不要放进源码目录。

## 项目结构

```text
entrypoints/       后台、采集脚本、弹窗和 Seenest 页面入口
src/db/            IndexedDB 数据结构与本地内容仓库
src/adapters/      共用采集生命周期与平台适配器
src/parsers/       各平台的路由识别和页面解析器
src/sessions/      将 Visit 动态归组为浏览会话
src/storage/       设置、持久化与可选的本地备份
src/export/        数据导出实现
src/components/    共用界面组件
public/icons/      正式使用的扩展图标和 Logo
preview/           本地界面预览数据
```

工程配置和 `package-lock.json` 属于项目源码，应当提交。依赖目录、构建结果和仅供本地使用的项目文件会被忽略。

## 本地数据与权限

| 权限 | 用途 |
| --- | --- |
| `storage` | 将扩展设置保存到 `chrome.storage.local` |
| `unlimitedStorage` | 避免不断增长的 IndexedDB 所见存档受到普通扩展配额影响 |
| `alarms` | 对可选的 JSON 自动快照进行延迟合并，避免频繁写文件 |
| `scripting` | 只在用户开启 B 站后注册对应的采集适配器 |
| `idle` | 在设备空闲或锁屏时停止统计活跃停留时间 |
| `x.com` / `twitter.com` | 只在当前已支持的页面运行采集适配器 |
| `bilibili.com` / `api.bilibili.com` | 可选权限，用于已打开的视频页和一次公开元数据请求 |

Seenest 会把去重后的内容作为 Memory、每次真实进入页面作为 Visit 分开保存在 IndexedDB。活跃停留归属于具体 Visit，同时汇总到 Memory 供列表快速展示。时长只根据页面可见性、窗口焦点、近期交互和系统空闲状态在本机推算，不保存按键内容、鼠标坐标或滚动内容。只有用户主动选择并授权一个本地 JSON 文件后，Seenest 才会写入自动快照。卸载扩展可能同时删除浏览器管理的本地数据库，如果这些内容很重要，请先导出或开启备份。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 浏览器扩展 | Chrome Manifest V3、WXT |
| 界面 | React、TypeScript |
| 本地数据库 | IndexedDB、Dexie |
| Excel 导出 | write-excel-file |

## 后续计划

- 增加更多由用户主动授权的内容平台适配器
- 持续兼容网站页面结构变化
- 完善备份恢复与数据迁移流程
- 坚持本地优先，并把权限限制在用户启用的平台范围内

Seenest 仍在持续迭代，已支持的网站页面结构也可能随时发生变化。

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。
