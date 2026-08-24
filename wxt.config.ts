import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Seenest · 拾见',
    short_name: 'Seenest',
    description: '自动记录你在 X 上打开过的帖子和文章，数据仅保存在本机。',
    permissions: ['storage'],
    host_permissions: ['https://x.com/*', 'https://twitter.com/*'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Seenest · 拾见',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
  },
});
