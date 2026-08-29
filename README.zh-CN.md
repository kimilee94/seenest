<p align="center">
  <img src="./public/icons/seenest-logo.png" width="96" height="96" alt="Seenest 标志" />
</p>

<h1 align="center">Seenest</h1>

<p align="center"><strong>让每一次所见，都有归处。</strong></p>

<p align="center">把互联网上值得再次找到的内容，安静地收进属于你的地方。</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

Seenest 是一款本地优先的浏览器扩展，让你在互联网上认真看过的内容有一个可以回去的地方。打开已支持的内容页面后，Seenest 会安静地收在本机，方便以后搜索和再次打开。

Seenest 来自 **Seen + Nest**。每一次有价值的所见，都会回到属于自己的 Nest。

无需注册账号。除非你主动导出或备份，Seenest 收好的内容只保存在自己的设备中。

## 主要功能

- 自动收好已支持的内容页面
- 搜索和筛选曾经看过的内容
- 点击即可回到原始页面
- 记录访问次数和近似活跃停留时间
- 按来源与日期整理内容
- 支持本地数据导出、备份和恢复
- 支持深浅主题及中英文界面

## 支持的网站

| 平台 | 当前支持 |
| --- | --- |
| X / Twitter | 帖子与文章 |
| 哔哩哔哩 | 视频 |
| GitHub | 公开仓库与 Issue |

更多平台会逐步加入。需要额外权限的网站由用户在 Seenest 的“网站权限”中主动开启。

## 隐私

Seenest 坚持本地优先，只在你主动打开的已支持页面中工作，不会收集密码、Cookie、私信或无关网站的浏览活动。

本地数据始终由你掌握，可以随时搜索、导出、恢复或清除。

## 从源码安装

需要 Node.js、npm，以及 Chrome 或其他 Chromium 浏览器。

```bash
npm ci
npm run build
```

随后：

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `.output/chrome-mv3` 文件夹。

需要更新时，重新构建并在现有 Seenest 扩展卡片上点击“重新加载”即可。

## 开发

```bash
npm ci
npm run dev
```

使用本地演示数据预览界面：

```bash
npm run preview:ui
```

检查、构建与打包：

```bash
npm run typecheck
npm run build
npm run zip
```

生成的扩展安装包位于 `.output/`，正式版本建议通过 GitHub Releases 发布。

## 技术栈

- Chrome Manifest V3、WXT
- React、TypeScript
- IndexedDB、Dexie

## 后续方向

- 支持更多有价值的内容平台
- 完善搜索、整理与数据恢复体验
- 继续打造真正属于用户自己的 Browser Memory

Seenest 仍在持续迭代，欢迎提出建议和参与贡献。

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。
