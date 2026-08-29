<p align="center">
  <img src="./public/icons/seenest-logo.png" width="96" height="96" alt="Seenest logo" />
</p>

<h1 align="center">Seenest</h1>

<p align="center"><strong>Everything you've seen, in one place.</strong></p>

<p align="center">Quietly keep the things worth finding again in a place of your own.</p>

<p align="center">
  <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a>
</p>

Seenest is a local-first browser extension that gives the things you have genuinely seen online a place to return to. Open a supported content page and Seenest quietly keeps it on your device, making it easy to search and open again later.

The name combines **Seen + Nest**. Everything valuable you have seen returns to a nest of your own.

No account is required. Your Seenest collection stays on your device unless you choose to export or back it up.

## Key features

- Automatically keeps supported content pages
- Searches and filters content you have seen before
- Returns to the original page with one click
- Records visit count and approximate active time
- Organizes content by source and date
- Supports local data export, backup, and restore
- Supports light, dark, and bilingual interfaces

## Supported sites

| Platform | Current support |
| --- | --- |
| X / Twitter | Posts and articles |
| Bilibili | Videos |
| GitHub | Public repositories and Issues |

More platforms will be added gradually. Optional sites are enabled by the user from **Site Access** inside Seenest.

## Privacy

Seenest is local-first and works only on supported pages that you open. It does not collect passwords, cookies, direct messages, or browsing activity from unrelated sites.

You remain in control of your local data and can search, export, restore, or clear it at any time.

## Install from source

Requirements: Node.js, npm, and Chrome or another Chromium-based browser.

```bash
npm ci
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `.output/chrome-mv3` from this project.

To update the extension, build again and click **Reload** on the existing Seenest extension card.

## Development

```bash
npm ci
npm run dev
```

Preview the interface with local demo data:

```bash
npm run preview:ui
```

Build and package:

```bash
npm run typecheck
npm run build
npm run zip
```

Generated extension packages are written to `.output/` and should normally be published through GitHub Releases.

## Technology

- Chrome Manifest V3 and WXT
- React and TypeScript
- IndexedDB and Dexie

## Roadmap

- Support more useful content platforms
- Improve search, organization, and recovery
- Continue building a Browser Memory that truly belongs to the user

Seenest is under active development. Feedback and contributions are welcome.

## License

Released under the [MIT License](./LICENSE).
