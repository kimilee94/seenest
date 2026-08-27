import type { Locale } from '../i18n';

/** 根据当前界面语言创建格式化器，避免切换语言后仍显示中文日期。 */
function formatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', options);
}

/** 按设备本地时区生成 YYYY-MM-DD 键，避免 UTC 跨日导致记录分组错误。 */
export function localDateKey(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** 计算目标时间与今天相隔的自然日数量，用于今天、昨天和最近七天筛选。 */
export function dayDistance(input: string, now = new Date()): number {
  const date = new Date(input);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((today - target) / 86_400_000);
}

/** 将日期转换为“今天”“昨天”或本地星期名称。 */
export function relativeDayLabel(input: string, locale: Locale = 'zh-CN', now = new Date()): string {
  const distance = dayDistance(input, now);
  if (distance === 0) return locale === 'en' ? 'Today' : '今天';
  if (distance === 1) return locale === 'en' ? 'Yesterday' : '昨天';
  return formatter(locale, { weekday: 'long' }).format(new Date(input));
}

/** 将时间格式化为本地化的月日文本。 */
export function formatDate(input: string, locale: Locale = 'zh-CN'): string {
  return formatter(locale, { month: locale === 'en' ? 'short' : 'long', day: 'numeric' }).format(new Date(input));
}

/** 将时间格式化为 24 小时制的时分文本。 */
export function formatTime(input: string, locale: Locale = 'zh-CN'): string {
  return formatter(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(input));
}

/** 格式化内容发布时间；来源未提供时间时返回明确的缺失提示。 */
export function formatPublishedAt(input: string | null, locale: Locale = 'zh-CN'): string {
  if (!input) return locale === 'en' ? 'Published time unknown' : '发布时间未知';
  const dateTime = `${formatDate(input, locale)} ${formatTime(input, locale)}`;
  return locale === 'en' ? `Published ${dateTime}` : `发布于 ${dateTime}`;
}
