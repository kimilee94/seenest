const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });

export function localDateKey(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function dayDistance(input: string, now = new Date()): number {
  const date = new Date(input);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((today - target) / 86_400_000);
}

export function relativeDayLabel(input: string, now = new Date()): string {
  const distance = dayDistance(input, now);
  if (distance === 0) return '今天';
  if (distance === 1) return '昨天';
  return WEEKDAY_FORMATTER.format(new Date(input));
}

export function formatDate(input: string): string {
  return DATE_FORMATTER.format(new Date(input));
}

export function formatTime(input: string): string {
  return TIME_FORMATTER.format(new Date(input));
}

export function formatPublishedAt(input: string | null): string {
  if (!input) return '发布时间未知';
  return `发布于 ${formatDate(input)} ${formatTime(input)}`;
}
