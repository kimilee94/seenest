import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Brand } from '../../src/components/Brand';
import { db } from '../../src/db/database';
import {
  clearHistory,
  exportHistory,
  importHistory,
  queryHistoryPage,
  type HistoryTimeFilter,
} from '../../src/db/history-repository';
import { exportHistoryExcel } from '../../src/export/excel';
import {
  AUTO_BACKUP_KEY,
  connectAutoBackupFile,
  disconnectAutoBackupFile,
  reconnectAutoBackupFile,
  writeAutoBackupSnapshot,
} from '../../src/storage/auto-backup';
import { getSettings, updateSettings } from '../../src/storage/settings';
import type { AutoBackupRecord, AutoBackupResult } from '../../src/types/backup';
import type { ExportPayload, HistoryRecord } from '../../src/types/history';
import { dayDistance, formatDate, formatPublishedAt, formatTime, localDateKey, relativeDayLabel } from '../../src/utils/date';

type View = 'history' | 'permissions' | 'data';
type TimeFilter = HistoryTimeFilter;

const PAGE_SIZE = 20;

/** 将来源标识转换为界面名称；未知来源保留原名称，方便未来动态扩展。 */
function sourceLabel(source: string): string {
  if (source === 'all') return '全部来源';
  if (source === 'x') return 'X / Twitter';
  return source;
}

/** 统一的向下箭头，避免字符箭头受字体基线影响而与文字错位。 */
function ChevronDownIcon() {
  return <svg className="chevron-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d="m4.5 6 3.5 3.5L11.5 6" /></svg>;
}

/** 展示来源的本地 SVG 标志；未知平台保留首字母，方便后续扩展适配器。 */
function SourceIcon({ source }: { source: string }) {
  if (source === 'all') return <img className="source-symbol" src="/icons/source-all.svg" alt="" aria-hidden="true" />;
  if (source === 'x') return <img className="source-symbol" src="/icons/source-x.svg" alt="" aria-hidden="true" />;
  return <span className="source-letter" aria-hidden="true">{source.slice(0, 1).toUpperCase()}</span>;
}

/** 自绘来源下拉菜单，替代不同系统下外观不一致的原生 select 弹窗。 */
function SourceSelect({ value, sources, onChange }: {
  value: string;
  sources: string[];
  onChange: (source: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = ['all', ...sources];

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  return (
    <div className={`source-select ${open ? 'open' : ''}`} ref={rootRef}>
      <button className="source-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="source-trigger-icon"><SourceIcon source={value} /></span>
        <span>{sourceLabel(value)}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <div className="source-menu" role="listbox" aria-label="按来源筛选">
          {options.map((source) => (
            <button className="source-option" type="button" role="option" aria-selected={source === value} key={source} onClick={() => { onChange(source); setOpen(false); }}>
              <span className="source-glyph"><SourceIcon source={source} /></span>
              <span>{sourceLabel(source)}</span>
              {source === value ? <span className="source-check">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 生成最多五个连续页码，避免记录较多时分页栏无限增长。 */
function paginationNumbers(currentPage: number, totalPages: number): number[] {
  const visibleCount = Math.min(5, totalPages);
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - visibleCount + 1));
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

/** 将自动备份状态转换为不暴露系统路径的简短说明。 */
function autoBackupDescription(config?: AutoBackupRecord): string {
  if (!config) return '选择一个本地 JSON 文件；记录变化后约 30 秒自动更新完整快照。';
  if (config.permission !== 'granted') return `${config.fileName} · 文件权限已失效，需要重新授权。`;
  if (config.lastError) return `${config.fileName} · ${config.lastError}`;
  if (config.lastBackupAt) {
    return `${config.fileName} · 最近备份 ${formatDate(config.lastBackupAt)} ${formatTime(config.lastBackupAt)}`;
  }
  return `${config.fileName} · 已连接，等待首次备份。`;
}

/** 根据写入结果生成用户可以直接理解的操作反馈。 */
function autoBackupNotice(result: AutoBackupResult): string {
  if (result.status === 'written') return '自动备份文件已更新';
  if (result.status === 'permission-required') return '需要重新授权备份文件';
  if (result.status === 'failed') return result.config?.lastError || '写入备份失败';
  return '自动备份尚未开启';
}

/** 用户关闭系统文件选择窗口属于正常取消，不显示错误提醒。 */
function isPickerCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** 将完整历史数据序列化为 JSON，并在当前浏览器中触发本地下载。 */
function downloadJson(payload: ExportPayload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `seenest-backup-${localDateKey(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 展示发布人头像；远程头像加载失败时退回到名称首字母。 */
function Avatar({ record }: { record: HistoryRecord }) {
  const [failed, setFailed] = useState(false);
  const initials = (record.authorName || record.authorHandle || 'X').slice(0, 1).toUpperCase();

  return (
    <span className="avatar-shell" aria-label={`${record.authorName} 的头像`}>
      <span>{initials}</span>
      {record.authorAvatarUrl && !failed ? (
        <img className="author-avatar" src={record.authorAvatarUrl} alt="" width="36" height="36" onError={() => setFailed(true)} />
      ) : null}
    </span>
  );
}

/** 顶部 Excel 导出按钮图标，使用 currentColor 与按钮状态保持一致。 */
function ExcelIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5v4h4M9 11h6M9 15h6M12 9v8" /></svg>;
}

/** 清晰可缩放的设置齿轮图标。 */
function SettingsIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1A1.7 1.7 0 0 0 2.5 13.6H2v-4h.5A1.7 1.7 0 0 0 4.2 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.66 3.2l.06.06A1.7 1.7 0 0 0 8.6 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1h4a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 .6 1c.3.35.7.55 1.1.6h.9v4h-.9a1.7 1.7 0 0 0-1.7 1.4Z" /></svg>;
}

const COMPACT_NUMBER = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });

/** 以紧凑格式展示已抓到的互动数据，未渲染的指标不会伪装成 0。 */
function EngagementStats({ record }: { record: HistoryRecord }) {
  const items = [
    ['评论', record.replyCount],
    ['转发', record.repostCount],
    ['浏览', record.viewCount],
    ['收藏', record.bookmarkCount],
    ['喜欢', record.likeCount],
  ] as const;
  const visibleItems: Array<readonly [string, number]> = items.flatMap(([label, value]) =>
    typeof value === 'number' ? [[label, value] as const] : [],
  );
  if (!visibleItems.length) return null;

  return <div className="engagement-meta" aria-label="帖子互动数据">{visibleItems.map(([label, value]) => <span key={label}><b>{COMPACT_NUMBER.format(value)}</b>{label}</span>)}</div>;
}

/** 渲染单条时光记录，包括内容摘要、作者信息、浏览时间和原文入口。 */
function HistoryRow({ record }: { record: HistoryRecord }) {
  return (
    <article className="history-row">
      <Avatar record={record} />
      <div className="history-content">
        <div className="title-line">
          <a href={record.url} target="_blank" rel="noreferrer">{record.title}</a>
          <span className="type-badge">{record.contentType === 'article' ? '文章' : '帖子'}</span>
        </div>
        <p>{record.contentText}</p>
        <div className="item-meta">
          <strong>{record.authorName}</strong>
          {record.authorHandle ? <span>{record.authorHandle}</span> : null}
          <i />
          <span>{formatPublishedAt(record.publishedAt)}</span>
          {record.visitCount > 1 ? <><i /><span>看过 {record.visitCount} 次</span></> : null}
        </div>
        <EngagementStats record={record} />
      </div>
      <div className="visit-info">
        <strong>{dayDistance(record.lastVisitedAt) < 2 ? formatTime(record.lastVisitedAt) : formatDate(record.lastVisitedAt)}</strong>
        <span>{dayDistance(record.lastVisitedAt) < 2 ? '上次看过' : '看过日期'}</span>
        <a href={record.url} target="_blank" rel="noreferrer" aria-label="回到原文" title="回到原文">↗</a>
      </div>
    </article>
  );
}

/** 渲染全局导航、采集状态和快捷导出操作。 */
function Header({ view, setView, captureEnabled, onExportExcel }: {
  view: View;
  setView: (view: View) => void;
  captureEnabled: boolean;
  onExportExcel: () => void;
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="brand-button" onClick={() => setView('history')}><Brand /></button>
        <nav className="header-nav" aria-label="页面导航">
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>浏览记录</button>
          <button className={view === 'permissions' ? 'active' : ''} onClick={() => setView('permissions')}>网站权限</button>
          <button className={view === 'data' ? 'active' : ''} onClick={() => setView('data')}>数据管理</button>
        </nav>
        <div className="header-actions">
          <span className={`recording-state ${captureEnabled ? '' : 'paused'}`}><i /><span>{captureEnabled ? '时光机运行中' : '时光机已暂停'}</span></span>
          <button className="header-action-link export-action" type="button" onClick={onExportExcel}><ExcelIcon /><span>导出 Excel</span></button>
          <button className="header-action-link settings-action" type="button" aria-label="打开设置" onClick={() => setView('data')}><SettingsIcon /><span>设置</span></button>
        </div>
      </div>
    </header>
  );
}

/** 根据当前是否存在筛选条件，展示无数据或无搜索结果提示。 */
function EmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <div className="empty-state">
      <span className="empty-search" />
      <h3>{filtered ? '没有找到这段记忆' : '你的时光机还没有留下记录'}</h3>
      <p>{filtered ? '换一个关键词，或者查看全部时间。' : '打开一条 X 帖子或文章，它会自动留在这里。'}</p>
      {filtered ? <button type="button" onClick={onReset}>清除筛选</button> : <a className="empty-link" href="https://x.com/home" target="_blank" rel="noreferrer">去 X 看看</a>}
    </div>
  );
}

/** Seenest 主页面：组织本地记录查询、筛选、备份和设置管理。 */
export function App() {
  const autoBackup = useLiveQuery(() => db.autoBackup.get(AUTO_BACKUP_KEY), [], undefined);
  const [view, setView] = useState<View>('history');
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [query, setQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [newestFirst, setNewestFirst] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // 列表使用来源与时间索引按页读取；关键词搜索也只在本地执行。
  const historyPage = useLiveQuery(() => queryHistoryPage({
    page: currentPage,
    pageSize: PAGE_SIZE,
    query,
    source: sourceFilter,
    timeFilter,
    newestFirst,
  }), [currentPage, query, sourceFilter, timeFilter, newestFirst], { items: [], total: 0 });
  const totalCount = useLiveQuery(() => db.history.count(), [], 0);
  const sourceOptions = useLiveQuery(async () => (await db.history.orderBy('source').uniqueKeys())
    .filter((source): source is string => typeof source === 'string'), [], []);
  // 侧栏摘要最多读取最近 1000 条，避免它抵消主列表分页带来的内存收益。
  const recentRecords = useLiveQuery(() => db.history.orderBy('lastVisitedAt').reverse().limit(1_000).toArray(), [], []);
  const todayCount = useLiveQuery(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return db.history.where('firstVisitedAt').aboveOrEqual(today.toISOString()).count();
  }, [], 0);
  const totalPages = Math.max(1, Math.ceil(historyPage.total / PAGE_SIZE));
  const availableSources = useMemo(() => Array.from(new Set(['x', ...sourceOptions])), [sourceOptions]);
  const pageStart = historyPage.total ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, historyPage.total);

  // 首次渲染时恢复用户的自动记录开关状态。
  useEffect(() => { void getSettings().then((settings) => setCaptureEnabled(settings.captureEnabled)); }, []);
  // 任一筛选或排序发生变化都从第一页重新开始。
  useEffect(() => { setCurrentPage(1); }, [query, sourceFilter, timeFilter, newestFirst]);
  // 删除或导入数据导致总页数减少时，自动回到仍然存在的最后一页。
  useEffect(() => { setCurrentPage((page) => Math.min(page, totalPages)); }, [totalPages]);
  // 注册 ⌘/Ctrl + K 快捷键，并在组件卸载时移除监听器。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('#history-search')?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // 将记录按最后浏览日期分组，形成时光线式的浏览列表。
  const groups = useMemo(() => {
    const map = new Map<string, HistoryRecord[]>();
    for (const record of historyPage.items) {
      const key = localDateKey(record.lastVisitedAt);
      const group = map.get(key) ?? [];
      group.push(record);
      map.set(key, group);
    }
    return [...map.entries()];
  }, [historyPage.items]);

  // 汇总最近四个有记录的日期，用于右侧时光日历快速浏览。
  const recentDates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of recentRecords) {
      const key = localDateKey(record.lastVisitedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 4);
  }, [recentRecords]);

  /** 更新界面状态并把自动记录开关持久化到扩展设置。 */
  const toggleCapture = async () => {
    const next = !captureEnabled;
    setCaptureEnabled(next);
    await updateSettings({ captureEnabled: next });
  };

  /** 导出可完整恢复的 JSON 备份。 */
  const handleExport = async () => {
    downloadJson(await exportHistory());
    setNotice('备份已导出');
  };

  /** 将当前全部记录整理为 Excel 文件并下载。 */
  const handleExportExcel = async () => {
    await exportHistoryExcel(await db.history.orderBy('lastVisitedAt').reverse().toArray());
    setNotice('时光记录表格已导出');
  };

  /** 读取用户选择的 JSON 备份，校验后合并到本地数据库。 */
  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as ExportPayload;
      const count = await importHistory(payload);
      // 导入会改变完整数据集；若已开启自动备份，立即同步一份新的快照。
      await writeAutoBackupSnapshot();
      setNotice(`已恢复 ${count} 条记录`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导入失败');
    } finally {
      event.target.value = '';
    }
  };

  /**
   * 首次开启时让用户选择文件；授权过期时只重新请求原文件权限；
   * 已正常连接时再次点击则允许更换备份文件。
   */
  const handleAutoBackupConnect = async () => {
    setBackupBusy(true);
    try {
      const result = autoBackup && autoBackup.permission !== 'granted'
        ? await reconnectAutoBackupFile(autoBackup)
        : await connectAutoBackupFile();
      setNotice(autoBackupNotice(result));
    } catch (error) {
      if (!isPickerCancelled(error)) {
        setNotice(error instanceof Error ? error.message : '无法连接备份文件');
      }
    } finally {
      setBackupBusy(false);
    }
  };

  /** 不更换文件，立即把当前全部记录写入已经连接的备份。 */
  const handleAutoBackupNow = async () => {
    setBackupBusy(true);
    try {
      setNotice(autoBackupNotice(await writeAutoBackupSnapshot()));
    } finally {
      setBackupBusy(false);
    }
  };

  /** 关闭自动备份只移除扩展保存的授权，不删除磁盘上已有的 JSON 文件。 */
  const handleAutoBackupDisconnect = async () => {
    await disconnectAutoBackupFile();
    setNotice('自动备份已关闭，已有备份文件仍保留');
  };

  /** 二次确认后删除当前设备中的全部时光记录。 */
  const handleClear = async () => {
    if (!window.confirm('确定清除全部本地浏览记录吗？此操作无法撤销。')) return;
    await clearHistory();
    setNotice('全部记录已清除');
  };

  /** 同时清空来源、关键词和时间范围，恢复完整记录列表。 */
  const resetFilters = () => { setQuery(''); setSourceFilter('all'); setTimeFilter('all'); };

  return (
    <main className="page-shell">
      <Header view={view} setView={setView} captureEnabled={captureEnabled} onExportExcel={() => void handleExportExcel()} />
      {notice ? <button className="toast" onClick={() => setNotice('')}>{notice}</button> : null}

      {view === 'history' ? (
        <>
          <section className="search-zone">
            <div className="search-inner">
              <div className="search-copy"><h1>你的专属浏览时光机</h1><p>自动留住每一次打开的精彩内容，让美好不再一刷而过。</p></div>
              <label className="search-box"><span className="search-icon" /><input id="history-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索你曾看过的标题、正文、作者或链接" /><kbd>⌘ K</kbd></label>
              <div className="quick-filters" role="group" aria-label="时间筛选">
                <SourceSelect value={sourceFilter} sources={availableSources} onChange={setSourceFilter} />
                {([['all', '全部记录'], ['today', '今天'], ['yesterday', '昨天'], ['week', '最近 7 天']] as const).map(([key, label]) => (
                  <button key={key} className={`time-filter-button ${timeFilter === key ? 'selected' : ''}`} onClick={() => setTimeFilter(key)}>{label}</button>
                ))}
              </div>
            </div>
          </section>

          <div className="content-area">
            <section className="history-panel">
              <div className="panel-head"><div><h2>时光记录</h2><span>已留住 {totalCount} 条，当前筛选 {historyPage.total} 条</span></div><button className="sort-control" onClick={() => setNewestFirst((value) => !value)}><span>{newestFirst ? '最近看过' : '最早看过'}</span><ChevronDownIcon /></button></div>
              {groups.length ? <>
                <div className="history-groups">{groups.map(([date, items]) => (
                  <section className="history-group" key={date}>
                    <div className="date-divider"><strong>{relativeDayLabel(items[0]!.lastVisitedAt)}</strong><span>{formatDate(items[0]!.lastVisitedAt)}</span><i /><small>本页 {items.length} 条</small></div>
                    <div className="history-list">{items.map((record) => <HistoryRow key={record.id} record={record} />)}</div>
                  </section>
                ))}</div>
                {historyPage.total > PAGE_SIZE ? <nav className="pagination" aria-label="浏览记录分页">
                  <span>第 {pageStart}–{pageEnd} 条，共 {historyPage.total} 条</span>
                  <div>
                    <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1} aria-label="上一页">‹</button>
                    {paginationNumbers(currentPage, totalPages).map((page) => <button type="button" key={page} className={page === currentPage ? 'active' : ''} aria-current={page === currentPage ? 'page' : undefined} onClick={() => setCurrentPage(page)}>{page}</button>)}
                    <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages} aria-label="下一页">›</button>
                  </div>
                </nav> : null}
              </> : <EmptyState filtered={Boolean(query || sourceFilter !== 'all' || timeFilter !== 'all')} onReset={resetFilters} />}
            </section>

            <aside className="side-column">
              <section className="side-card status-card">
                <div className="side-card-head"><h3>时光机状态</h3><span className={captureEnabled ? 'live-dot' : 'idle-dot'} /></div>
                <div className="source-row"><span className="x-logo"><SourceIcon source="x" /></span><div><strong>X / Twitter</strong><small>已授权访问 x.com</small></div><button className={`switch ${captureEnabled ? 'on' : ''}`} onClick={() => void toggleCapture()} aria-label={captureEnabled ? '暂停自动记录' : '开启自动记录'}><i /></button></div>
                <div className="capture-rule"><span>✓</span><p><strong>只留住详情页面</strong>不会记录首页信息流、私信或其他网站。</p></div>
                <div className="capture-fields"><span>自动留住</span><p>原始链接 · 正文 · 发布人 · 发布时间 · 互动数据 · 看过时间</p></div>
              </section>
              <section className="side-card data-card"><div className="side-card-head"><h3>本地记忆</h3><button onClick={() => setView('data')}>管理</button></div><div className="data-grid"><div><strong>{totalCount}</strong><span>已留住</span></div><div><strong>{todayCount}</strong><span>今日新增</span></div></div><div className="local-note"><span>⌂</span><p><strong>记录仅在此设备</strong><small>未上传到任何服务器</small></p></div></section>
              <section className="side-card dates-card"><div className="side-card-head"><h3>时光日历</h3><button onClick={() => setTimeFilter('all')}>全部</button></div>{recentDates.length ? recentDates.map(([date, count]) => <button className="date-row" key={date} onClick={() => { setQuery(''); setTimeFilter(date === localDateKey(new Date()) ? 'today' : 'week'); }}><span><strong>{relativeDayLabel(`${date}T12:00:00`)}</strong><small>{formatDate(`${date}T12:00:00`)}</small></span><b>{count}</b></button>) : <p className="side-empty">暂无日期记录</p>}</section>
            </aside>
          </div>
        </>
      ) : null}

      {view === 'permissions' ? (
        <section className="settings-page"><div className="settings-heading"><span>网站权限</span><h1>决定时光机在哪些网站留下记录</h1><p>当前版本只支持 X。暂停后，已保存的记录不会被删除。</p></div><div className="settings-card"><div className="permission-logo"><SourceIcon source="x" /></div><div className="permission-copy"><strong>X / Twitter</strong><span>仅在帖子和文章详情页面读取公开内容</span><code>https://x.com/*</code></div><button className={`switch large ${captureEnabled ? 'on' : ''}`} onClick={() => void toggleCapture()} aria-label={captureEnabled ? '暂停自动记录' : '开启自动记录'}><i /></button></div><div className="privacy-card"><strong>最小权限原则</strong><p>Seenest 不读取首页信息流、私信、Cookie、登录信息或其他网站。后续新增网站时，会先向你请求单独授权。</p></div></section>
      ) : null}

      {view === 'data' ? (
        <section className="settings-page">
          <div className="settings-heading"><span>数据管理</span><h1>你的每一段记录，都由你掌握</h1><p>可以自动备份、整理成 Excel、恢复记录，也可以随时清除本地数据。</p></div>
          <div className="data-actions">
            <article className={`backup-action ${autoBackup?.permission === 'granted' ? 'connected' : ''}`}>
              <span className="action-icon">↻</span>
              <div><strong>自动本地备份</strong><p>{autoBackupDescription(autoBackup)}</p></div>
              <div className="action-controls">
                <button onClick={() => void handleAutoBackupConnect()} disabled={backupBusy}>{!autoBackup ? '开启备份' : autoBackup.permission !== 'granted' ? '重新授权' : '更换文件'}</button>
                {autoBackup ? <button className="secondary" onClick={() => void handleAutoBackupNow()} disabled={backupBusy || autoBackup.permission !== 'granted'}>立即备份</button> : null}
                {autoBackup ? <button className="text-button" onClick={() => void handleAutoBackupDisconnect()} disabled={backupBusy}>关闭</button> : null}
              </div>
            </article>
            <article><span className="action-icon">▦</span><div><strong>整理成 Excel 表格</strong><p>生成可用 Excel、Numbers 或 WPS 打开的 .xlsx 时光记录表格。</p></div><button onClick={() => void handleExportExcel()}>导出 Excel</button></article>
            <article><span className="action-icon">⇩</span><div><strong>手动备份全部记录</strong><p>立即下载一份用于迁移和恢复 Seenest 记录的完整 JSON 备份。</p></div><button onClick={() => void handleExport()}>导出备份</button></article>
            <article><span className="action-icon">⇧</span><div><strong>恢复记录</strong><p>导入已有 JSON 备份；相同记录会合并，不会重复创建。</p></div><button onClick={() => importRef.current?.click()}>选择备份</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => void handleImport(event)} /></article>
            <article className="danger"><span className="action-icon">×</span><div><strong>清除全部记录</strong><p>删除当前设备中的 {totalCount} 条浏览记录；已有外部备份文件不会被删除。</p></div><button onClick={() => void handleClear()} disabled={!totalCount}>清除数据</button></article>
          </div>
        </section>
      ) : null}
    </main>
  );
}
