import type { ThemeMode } from '../storage/settings';

let systemThemeQuery: MediaQueryList | undefined;
let systemThemeListener: (() => void) | undefined;

/** 把用户选择转换成实际明暗主题，并同步浏览器原生控件的配色。 */
export function applyTheme(theme: ThemeMode): void {
  if (systemThemeQuery && systemThemeListener) {
    systemThemeQuery.removeEventListener('change', systemThemeListener);
  }

  systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    const resolved = theme === 'system' ? (systemThemeQuery!.matches ? 'dark' : 'light') : theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = theme;
    document.documentElement.style.colorScheme = resolved;
  };

  systemThemeListener = update;
  update();
  if (theme === 'system') systemThemeQuery.addEventListener('change', update);
}

/** 同步文档语言、标题和页面描述，帮助浏览器、搜索工具及辅助技术正确识别语言。 */
export function applyLocale(locale: 'zh-CN' | 'en'): void {
  document.documentElement.lang = locale;
  document.title = locale === 'en'
    ? "Seenest · Find a page you've seen"
    : 'Seenest · 记得一点内容，就能找回看过的页面';
  const description = locale === 'en'
    ? "Find a page you've seen, even when you don't remember where."
    : '只要记得一点内容，就能找回看过的页面。';
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', description);
}
