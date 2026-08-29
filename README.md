<p align="center">
  <img src="./public/icons/seenest-logo.png" width="96" height="96" alt="Seenest logo" />
</p>

<h1 align="center">Seenest</h1>

<p align="center"><strong>Everything you've seen, in one place.</strong></p>

<p align="center">A quiet, private home for the posts, articles, and videos you want to find again.</p>

<p align="center">
  <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a>
</p>

Seenest is a local-first browser extension that gives everything you have seen a place to return to. Open a supported post, article, or video detail page and Seenest quietly keeps its public content and source link on your device, ready whenever you need it again.

The name combines **Seen + Nest**: everything you have seen returns to one personal nest—a searchable home for useful content that would otherwise disappear into the feed.

The product is designed for multiple content platforms. The current version supports **X / Twitter posts and articles**, **Bilibili video detail pages**, and **public GitHub repositories and Issues**. Bilibili and GitHub access is requested only when you explicitly enable each adapter.

No Seenest account. No Seenest server. No analytics or AI processing. Everything Seenest keeps stays on your device unless you explicitly export or back it up.

## Features

- Automatically captures supported post, long-form article, and video detail pages
- Saves the original URL, title, content, author, avatar, publication time and last visit time
- Captures public engagement exposed by each platform, including replies/comments, reposts or shares, views, bookmarks/favorites, and likes
- Saves the Bilibili creator profile, avatar, video duration, and cover image; expiring playback URLs are intentionally not stored
- Keeps public GitHub repositories with description, topics, language, stars, forks, and up to 1,000 characters of README highlights
- Keeps public GitHub Issues with the opening body only, capped at 500 characters; comments and private repositories are excluded
- Keeps one Memory item per canonical content page and records each real page entry as a separate Visit
- Measures approximate active time only while a saved page is visible, focused, and the user is not idle
- Searches titles, content, authors and links
- Filters by source and date, groups items by day, and paginates large collections
- Opens the original page by clicking an item
- Exports your Seenest archive as JSON or Excel (`.xlsx`)
- Supports an optional user-selected JSON file for automatic local snapshots

## Supported sites

| Platform | Status | Captured pages |
| --- | --- | --- |
| X / Twitter | Supported | Post and long-form article detail pages |
| Bilibili | Supported, opt-in | Video detail pages |
| GitHub | Supported, opt-in | Public repository home pages and individual Issues |
| Other platforms | Planned | Added through separate adapters and explicit site access |

Seenest does not collect home feeds, direct messages, cookies, passwords or browsing activity from unrelated sites.

## How it works

```text
Open a supported detail page
  -> wait briefly for the page or route to settle
  -> extract public content or request the platform's public metadata
  -> keep or update one Memory item by platform and content ID
  -> append one Visit for this real page entry
  -> stop the short-lived DOM observer
```

X is a single-page application, so Seenest performs a lightweight route check. A DOM observer runs only during a short capture session and stops after a successful capture, timeout or route change. For Bilibili, Seenest reads the BVID from the opened video URL and makes one cookie-free request to Bilibili's public video-details endpoint. GitHub is parsed from the public page already open in the focused tab after a short settling delay; Seenest does not call the GitHub API or scan private repositories.

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
6. Open a supported X detail page. To capture Bilibili or GitHub, open **Site Access**, enable the source, approve its optional permission, and then visit a supported detail page.

To update a locally installed copy, pull the latest code, run `npm ci` and `npm run build` again, then click **Reload** on the existing Seenest card in `chrome://extensions`. Chrome keeps the same extension installation when the same unpacked folder is reloaded.

## Development

```bash
npm ci
npm run dev
```

For the Seenest dashboard with local demo data:

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
src/db/            IndexedDB schema and local content repository
src/adapters/      Shared capture lifecycle and platform adapters
src/parsers/       Platform-specific route matching and page parsers
src/sessions/      Dynamic grouping of Visits into browsing sessions
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
| `unlimitedStorage` | Protects a growing local IndexedDB archive from normal extension quotas |
| `alarms` | Debounces optional automatic JSON snapshots |
| `scripting` | Registers Bilibili and GitHub adapters only after the user enables them |
| `idle` | Stops active-time measurement when the device is idle or locked |
| `x.com` / `twitter.com` | Runs the current capture adapter only on supported pages |
| `bilibili.com` / `api.bilibili.com` | Optional access used for opened video pages and one public metadata request |
| `github.com` | Optional access used only for opened public repository and Issue pages; no GitHub API requests |

Seenest stores content as deduplicated Memory items and page entries as separate Visits in IndexedDB. Active time is attached to its Visit and also summarized on the Memory item for fast display. It is inferred locally from page visibility, window focus, recent interaction, and system idle state; Seenest does not store keystrokes, pointer coordinates, or scroll contents. An automatic snapshot is written only after the user chooses and authorizes a local JSON file. Uninstalling the extension may remove its browser-managed database, so export or enable a backup before uninstalling if the collection matters.

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
