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

/** 更新文档语言，帮助浏览器和辅助技术使用正确的语言规则。 */
export function applyLocale(locale: 'zh-CN' | 'en'): void {
  document.documentElement.lang = locale;
  document.title = locale === 'en' ? 'Seenest · Browsing Time Machine' : 'Seenest · 浏览时光机';
}
