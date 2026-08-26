import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Seenest',
    short_name: 'Seenest',
    description: '你的专属浏览时光机，自动留住打开过的精彩内容，数据仅保存在本机。',
    permissions: ['storage', 'unlimitedStorage', 'alarms'],
    host_permissions: ['https://x.com/*', 'https://twitter.com/*'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Seenest',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
  },
});
