const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });

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
export function relativeDayLabel(input: string, now = new Date()): string {
  const distance = dayDistance(input, now);
  if (distance === 0) return '今天';
  if (distance === 1) return '昨天';
  return WEEKDAY_FORMATTER.format(new Date(input));
}

/** 将时间格式化为本地化的月日文本。 */
export function formatDate(input: string): string {
  return DATE_FORMATTER.format(new Date(input));
}

/** 将时间格式化为 24 小时制的时分文本。 */
export function formatTime(input: string): string {
  return TIME_FORMATTER.format(new Date(input));
}

/** 格式化内容发布时间；来源未提供时间时返回明确的缺失提示。 */
export function formatPublishedAt(input: string | null): string {
  if (!input) return '发布时间未知';
  return `发布于 ${formatDate(input)} ${formatTime(input)}`;
}
