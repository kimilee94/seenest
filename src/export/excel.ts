import writeExcelFile, { type Cell, type SheetData } from 'write-excel-file/browser';
import type { Locale } from '../i18n';
import type { HistoryRecord } from '../types/history';
import { localDateKey } from '../utils/date';

const EXCEL_COPY = {
  'zh-CN': {
    headers: ['来源', '类型', '标题', '正文', '发布人', '用户名', '作者主页', '发布时间', '评论数', '转发数', '分享数', '浏览量', '收藏量', '喜欢数', '视频时长（秒）', '媒体类型', '媒体链接', '媒体预览图', '首次收好', '最近看过', '看过次数', '活跃停留（秒）', '开始统计时间', '最近活跃时间', '原始链接'],
    sourceBilibili: '哔哩哔哩', sourceYoutube: 'YouTube', sourceXiaohongshu: '小红书', article: '文章', video: '视频', post: '帖子', image: '图片', sheet: 'Seenest 所见',
  },
  en: {
    headers: ['Source', 'Type', 'Title', 'Content', 'Author', 'Username', 'Author Profile', 'Published At', 'Replies', 'Reposts', 'Shares', 'Views', 'Bookmarks', 'Likes', 'Video Duration (sec)', 'Media Type', 'Media URL', 'Media Preview', 'First Kept', 'Last Seen', 'Times Seen', 'Active Time (sec)', 'Measured From', 'Last Active At', 'Original URL'],
    sourceBilibili: 'Bilibili', sourceYoutube: 'YouTube', sourceXiaohongshu: 'Xiaohongshu', article: 'Article', video: 'Video', post: 'Post', image: 'Image', sheet: 'Seenest Archive',
  },
} as const;

/** 将可空的 ISO 时间转换为 Excel 中易读的本地日期时间。 */
function formatExcelDate(value: string | null, locale: Locale): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value));
}

/** 把历史记录转换为包含样式表头和数据行的 Excel 工作表结构。 */
export function createHistorySheetData(records: HistoryRecord[], locale: Locale = 'zh-CN'): SheetData {
  const copy = EXCEL_COPY[locale];
  const headerRow: Cell[] = copy.headers.map((value) => ({
    value,
    fontWeight: 'bold',
    textColor: '#FFFFFF',
    backgroundColor: '#247CF2',
    alignVertical: 'center',
    height: 26,
  }));

  const rows: SheetData = records.map((record) => [
    record.source === 'bilibili' ? copy.sourceBilibili : record.source === 'youtube' ? copy.sourceYoutube : record.source === 'xiaohongshu' ? copy.sourceXiaohongshu : record.source === 'x' ? 'X / Twitter' : record.source,
    record.contentType === 'article' ? copy.article : record.contentType === 'video' ? copy.video : copy.post,
    { value: record.title, wrap: true, alignVertical: 'top' },
    { value: record.contentText, wrap: true, alignVertical: 'top' },
    record.authorName,
    record.authorHandle,
    record.authorProfileUrl
      ? { value: record.authorProfileUrl, textColor: '#247CF2', textDecoration: { underline: true }, wrap: true }
      : '',
    formatExcelDate(record.publishedAt, locale),
    record.replyCount ?? '',
    record.repostCount ?? '',
    record.shareCount ?? '',
    record.viewCount ?? '',
    record.bookmarkCount ?? '',
    record.likeCount ?? '',
    record.durationSeconds ?? '',
    record.mediaType === 'video' ? copy.video : record.mediaType === 'image' ? copy.image : '',
    record.mediaUrl ? { value: record.mediaUrl, textColor: '#247CF2', textDecoration: { underline: true }, wrap: true } : '',
    record.mediaPreviewUrl ? { value: record.mediaPreviewUrl, textColor: '#247CF2', textDecoration: { underline: true }, wrap: true } : '',
    formatExcelDate(record.firstSeenAt, locale),
    formatExcelDate(record.lastSeenAt, locale),
    record.visitCount,
    Math.round(Math.max(0, record.activeDurationMs ?? 0) / 1_000),
    formatExcelDate(record.activeMeasuredFrom ?? null, locale),
    formatExcelDate(record.lastActiveAt ?? null, locale),
    { value: record.url, textColor: '#247CF2', textDecoration: { underline: true }, wrap: true },
  ]);

  return [headerRow, ...rows];
}

// Excel 文件完全在浏览器本地生成并下载，不会把记录上传到服务器。
export async function exportHistoryExcel(records: HistoryRecord[], locale: Locale = 'zh-CN'): Promise<void> {
  const copy = EXCEL_COPY[locale];
  const fileName = `seenest-archive-${localDateKey(new Date())}.xlsx`;
  await writeExcelFile(createHistorySheetData(records, locale), {
    sheet: copy.sheet,
    stickyRowsCount: 1,
    showGridLines: true,
    columns: [
      { width: 9 }, { width: 12 }, { width: 34 }, { width: 58 },
      { width: 18 }, { width: 18 }, { width: 34 }, { width: 22 },
      { width: 11 }, { width: 11 }, { width: 11 }, { width: 14 },
      { width: 13 }, { width: 11 }, { width: 11 }, { width: 11 },
      { width: 48 }, { width: 48 }, { width: 22 }, { width: 22 },
      { width: 11 }, { width: 16 }, { width: 22 }, { width: 22 },
      { width: 48 },
    ],
  }, {
    fontFamily: locale === 'en' ? 'Arial' : 'Microsoft YaHei',
    fontSize: 11,
  }).toFile(fileName);
}
