import writeExcelFile, { type Cell, type SheetData } from 'write-excel-file/browser';
import type { HistoryRecord } from '../types/history';
import { localDateKey } from '../utils/date';

const EXCEL_DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

// 列顺序同时用于表头和数据行，保证导出的表格字段稳定、便于二次整理。
const HEADERS = ['类型', '标题', '正文', '发布人', '用户名', '发布时间', '评论数', '转发数', '浏览量', '收藏量', '喜欢数', '首次访问', '最近访问', '访问次数', '原始链接'];

/** 将可空的 ISO 时间转换为 Excel 中易读的本地日期时间。 */
function formatExcelDate(value: string | null): string {
  return value ? EXCEL_DATE_FORMAT.format(new Date(value)) : '';
}

/** 把历史记录转换为包含样式表头和数据行的 Excel 工作表结构。 */
export function createHistorySheetData(records: HistoryRecord[]): SheetData {
  const headerRow: Cell[] = HEADERS.map((value) => ({
    value,
    fontWeight: 'bold',
    textColor: '#FFFFFF',
    backgroundColor: '#247CF2',
    alignVertical: 'center',
    height: 26,
  }));

  const rows: SheetData = records.map((record) => [
    record.contentType === 'article' ? '文章' : '帖子',
    { value: record.title, wrap: true, alignVertical: 'top' },
    { value: record.contentText, wrap: true, alignVertical: 'top' },
    record.authorName,
    record.authorHandle,
    formatExcelDate(record.publishedAt),
    record.replyCount ?? '',
    record.repostCount ?? '',
    record.viewCount ?? '',
    record.bookmarkCount ?? '',
    record.likeCount ?? '',
    formatExcelDate(record.firstVisitedAt),
    formatExcelDate(record.lastVisitedAt),
    record.visitCount,
    { value: record.url, textColor: '#247CF2', textDecoration: { underline: true }, wrap: true },
  ]);

  return [headerRow, ...rows];
}

// Excel 文件完全在浏览器本地生成并下载，不会把记录上传到服务器。
export async function exportHistoryExcel(records: HistoryRecord[]): Promise<void> {
  const fileName = `seenest-history-${localDateKey(new Date())}.xlsx`;
  await writeExcelFile(createHistorySheetData(records), {
    sheet: '浏览记录',
    stickyRowsCount: 1,
    showGridLines: true,
    columns: [
      { width: 9 },
      { width: 34 },
      { width: 58 },
      { width: 18 },
      { width: 18 },
      { width: 22 },
      { width: 11 },
      { width: 11 },
      { width: 13 },
      { width: 11 },
      { width: 11 },
      { width: 22 },
      { width: 22 },
      { width: 11 },
      { width: 48 },
    ],
  }, {
    fontFamily: 'Microsoft YaHei',
    fontSize: 11,
  }).toFile(fileName);
}
