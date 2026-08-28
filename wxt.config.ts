import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    default_locale: 'en',
    name: '__MSG_extName__',
    short_name: 'Seenest',
    description: '__MSG_extDescription__',
    permissions: ['storage', 'unlimitedStorage', 'alarms', 'scripting'],
    host_permissions: ['https://x.com/*', 'https://twitter.com/*'],
    optional_host_permissions: ['https://www.bilibili.com/*', 'https://api.bilibili.com/*'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: '__MSG_actionTitle__',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
  },
});
