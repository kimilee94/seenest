<p align="center">
  <img src="./public/icons/seenest-logo.png" width="96" height="96" alt="Seenest 标志" />
</p>

<h1 align="center">Seenest</h1>

<p align="center"><strong>只要记得一点内容，就能找回看过的页面。</strong></p>

<p align="center">让每一次浏览都有归处。</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

Seenest 是一款本地优先的浏览器扩展。打开已支持的内容页面后，Seenest 会安静地收在本机。以后即使忘了来自哪里，只要还记得标题、正文或作者的一点线索，就能重新找到并打开原页面。

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
| YouTube | 标准视频 |
| 小红书 | 图文与视频笔记 |

更多平台会逐步加入。需要额外权限的网站由用户在 Seenest 的“网站权限”中主动开启。

## 隐私

Seenest 坚持本地优先，只在你主动打开的已支持页面中工作，不会收集密码、Cookie、私信或无关网站的浏览活动。

本地数据始终由你掌握，可以随时搜索、导出、恢复或清除。

## 手动安装

如果你想直接体验 Seenest，而不搭建开发环境：

1. 打开 [Seenest 最新版本](https://github.com/kimilee94/seenest/releases/latest)。
2. 在 **Assets** 中下载 `seenest-<版本号>-chrome.zip`。
3. 选择一个准备长期保留的文件夹，将 ZIP 中的内容解压到这里。例如 macOS 或 Linux 可以使用 `~/Documents/Seenest`，Windows 可以使用 `%USERPROFILE%\Documents\Seenest`。
4. 在 Chrome 地址栏打开 `chrome://extensions`。
5. 打开右上角的“开发者模式”。
6. 点击“加载已解压的扩展程序”。
7. 选择刚才解压的文件夹，该文件夹中应直接包含 `manifest.json`。
8. 如有需要，可以在 Chrome 扩展菜单中固定 Seenest。

手动安装的扩展不会自动更新。更新 Seenest 时，请下载新版本 ZIP，将内容解压并覆盖到原来的安装文件夹，然后在 `chrome://extensions` 中找到现有 Seenest 并点击“重新加载”。保持安装文件夹路径不变，Chrome 才能继续使用原有的扩展本地数据；移动或删除该文件夹会导致已加载的扩展失效。

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
