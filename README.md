<p align="center">
  <img src="./public/icons/seenest-logo.png" width="96" height="96" alt="Seenest logo" />
</p>

<h1 align="center">Seenest</h1>

<p align="center"><strong>Your private browsing time machine.</strong></p>

<p align="center">Automatically keep the pages you deliberately open, so useful moments do not disappear into the feed.</p>

<p align="center">
  <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a>
</p>

Seenest is a local-first browser extension for building a personal, searchable browsing history. It records supported detail pages after you open them, keeps one local record per item, and lets you return to the original page at any time.

The product is designed for multiple content platforms. The current version supports **X / Twitter posts and articles** plus **Bilibili video detail pages**. Bilibili access is requested only when you explicitly enable its adapter.

No Seenest account. No Seenest server. No analytics or AI processing. Your captured history stays on your device unless you explicitly export or back it up.

## Features

- Automatically captures supported post, long-form article, and video detail pages
- Saves the original URL, title, content, author, avatar, publication time and last visit time
- Captures public engagement exposed by each platform, including replies/comments, reposts or shares, views, bookmarks/favorites, and likes
- Saves the Bilibili creator profile, avatar, video duration, and cover image; expiring playback URLs are intentionally not stored
- Deduplicates repeated visits and updates the existing record instead of creating copies
- Searches titles, content, authors and links
- Filters by source and date, groups records by day, and paginates large histories
- Opens the original page by clicking a record
- Exports history as JSON or Excel (`.xlsx`)
- Supports an optional user-selected JSON file for automatic local snapshots

## Supported sites

| Platform | Status | Captured pages |
| --- | --- | --- |
| X / Twitter | Supported | Post and long-form article detail pages |
| Bilibili | Supported, opt-in | Video detail pages |
| Other platforms | Planned | Added through separate adapters and explicit site access |

Seenest does not collect home feeds, direct messages, cookies, passwords or browsing activity from unrelated sites.

## How it works

```text
Open a supported detail page
  -> wait briefly for the page or route to settle
  -> extract public content or request the platform's public metadata
  -> deduplicate by platform and content ID
  -> save or update the record in local IndexedDB
  -> stop the short-lived DOM observer
```

X is a single-page application, so Seenest performs a lightweight route check. A DOM observer runs only during a short capture session and stops after a successful capture, timeout or route change. For Bilibili, Seenest reads the BVID from the opened video URL and makes one cookie-free request to Bilibili's public video-details endpoint; it does not scan the home feed or keep a long-running DOM observer.

## Install from source

Requirements: a current Node.js release, npm, and Chrome or another Chromium-based browser that supports Manifest V3.

1. Clone or download this repository.
2. Install dependencies and build the extension:

   ```bash
   npm ci
   npm run build
   ```

3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select `.output/chrome-mv3` from this project.
6. Open a supported X detail page. To capture Bilibili videos, open **Site Access** in Seenest, enable Bilibili, approve the optional site permission, and then visit a video detail page.

To update a locally installed copy, pull the latest code, run `npm ci` and `npm run build` again, then click **Reload** on the existing Seenest card in `chrome://extensions`. Chrome keeps the same extension installation when the same unpacked folder is reloaded.

## Development

```bash
npm ci
npm run dev
```

For the dashboard with local demo data:

```bash
npm run preview:ui
```

Then open `http://localhost:3000/preview.html`. The preview uses a separate website database and does not read or modify extension data.

Quality checks and production packaging:

```bash
npm run typecheck
npm run build
npm run zip
```

Generated extension files and ZIP packages are written to `.output/` and are intentionally excluded from Git. Publish distributable ZIP or CRX files through GitHub Releases instead of committing them to the source tree.

## Project structure

```text
entrypoints/       Extension background, content, popup and dashboard entrypoints
src/db/            IndexedDB schema and history repository
src/parsers/       Platform-specific route matching and page parsers
src/storage/       Settings, persistence and optional local backup
src/export/        Data export implementations
src/components/    Shared interface components
public/icons/      Production extension icons and logo
preview/           Local dashboard preview data
```

Source configuration and `package-lock.json` are part of the project and should be committed. Installed dependencies, generated builds and local-only project files are ignored.

## Local data and permissions

| Permission | Why Seenest needs it |
| --- | --- |
| `storage` | Stores settings in `chrome.storage.local` |
| `unlimitedStorage` | Protects a growing local IndexedDB history from normal extension quotas |
| `alarms` | Debounces optional automatic JSON snapshots |
| `scripting` | Registers the Bilibili adapter only after the user enables it |
| `x.com` / `twitter.com` | Runs the current capture adapter only on supported pages |
| `bilibili.com` / `api.bilibili.com` | Optional access used for opened video pages and one public metadata request |

History records and backup file handles are stored in IndexedDB. An automatic snapshot is written only after the user chooses and authorizes a local JSON file. Uninstalling the extension may remove its browser-managed database, so export or enable a backup before uninstalling if the history matters.

## Technology

| Area | Technology |
| --- | --- |
| Extension | Chrome Manifest V3, WXT |
| Interface | React, TypeScript |
| Local database | IndexedDB with Dexie |
| Excel export | write-excel-file |

## Roadmap

- Add adapters for more user-authorized content platforms
- Improve compatibility with changing page structures
- Add clearer backup restoration and migration flows
- Keep capture local-first and permissions scoped to enabled platforms

Seenest is under active development, and supported page structures may change without notice.

## License

Released under the [MIT License](./LICENSE).
