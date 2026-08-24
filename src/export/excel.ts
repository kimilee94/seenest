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

const HEADERS = ['类型', '标题', '正文', '发布人', '用户名', '发布时间', '首次访问', '最近访问', '访问次数', '原始链接'];

function formatExcelDate(value: string | null): string {
  return value ? EXCEL_DATE_FORMAT.format(new Date(value)) : '';
}

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
    formatExcelDate(record.firstVisitedAt),
    formatExcelDate(record.lastVisitedAt),
    record.visitCount,
    { value: record.url, textColor: '#247CF2', textDecoration: { underline: true }, wrap: true },
  ]);

  return [headerRow, ...rows];
}

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
