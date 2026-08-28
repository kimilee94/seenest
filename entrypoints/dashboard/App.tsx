import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import packageMetadata from '../../package.json';
import { Brand } from '../../src/components/Brand';
import { db } from '../../src/db/database';
import { translate, type Locale, type Translate } from '../../src/i18n';
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
import { getSettings, subscribeSettings, updateSettings, type SeenestSettings, type ThemeMode } from '../../src/storage/settings';
import { applyLocale, applyTheme } from '../../src/theme/apply-theme';
import type { AutoBackupRecord, AutoBackupResult } from '../../src/types/backup';
import type { ExportPayload, HistoryRecord } from '../../src/types/history';
import type { SeenestMessage } from '../../src/types/messages';
import { dayDistance, formatDate, formatPublishedAt, formatTime, localDateKey, relativeDayLabel } from '../../src/utils/date';
import { BILIBILI_OPTIONAL_ORIGINS } from '../../src/sources/bilibili';

type View = 'history' | 'permissions' | 'data';
type TimeFilter = HistoryTimeFilter;

const PAGE_SIZE = 20;
const CALENDAR_RECORD_LIMIT = 500;
const CALENDAR_DATE_LIMIT = 20;
const CALENDAR_PAGE_SIZE = 5;
const CALENDAR_AUTOPLAY_MS = 5_000;

/** 将来源标识转换为界面名称；未知来源保留原名称，方便未来动态扩展。 */
function sourceLabel(source: string, t: Translate): string {
  if (source === 'all') return t('source.all');
  if (source === 'x') return 'X / Twitter';
  if (source === 'bilibili') return t('source.bilibili');
  return source;
}

/** 列表来源标签使用短名，避免与内容类型一起挤压标题。 */
function shortSourceLabel(source: string, t: Translate): string {
  if (source === 'x') return t('source.xShort');
  if (source === 'bilibili') return t('source.bilibiliShort');
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
  if (source === 'bilibili') return <img className="source-symbol" src="/icons/source-bilibili.svg" alt="" aria-hidden="true" />;
  return <span className="source-letter" aria-hidden="true">{source.slice(0, 1).toUpperCase()}</span>;
}

/** 自绘来源下拉菜单，替代不同系统下外观不一致的原生 select 弹窗。 */
function SourceSelect({ value, sources, onChange, t }: {
  value: string;
  sources: string[];
  onChange: (source: string) => void;
  t: Translate;
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
        <span>{sourceLabel(value, t)}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <div className="source-menu" role="listbox" aria-label={t('source.filter')}>
          {options.map((source) => (
            <button className="source-option" type="button" role="option" aria-selected={source === value} key={source} onClick={() => { onChange(source); setOpen(false); }}>
              <span className="source-glyph"><SourceIcon source={source} /></span>
              <span>{sourceLabel(source, t)}</span>
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
function autoBackupDescription(config: AutoBackupRecord | undefined, locale: Locale, t: Translate): string {
  if (!config) return t('backup.select');
  if (config.permission !== 'granted') return t('backup.permissionExpired', { file: config.fileName });
  if (config.lastError) return `${config.fileName} · ${config.lastError}`;
  if (config.lastBackupAt) {
    return t('backup.lastBackup', { file: config.fileName, date: formatDate(config.lastBackupAt, locale), time: formatTime(config.lastBackupAt, locale) });
  }
  return t('backup.connected', { file: config.fileName });
}

/** 根据写入结果生成用户可以直接理解的操作反馈。 */
function autoBackupNotice(result: AutoBackupResult, t: Translate): string {
  if (result.status === 'written') return t('backup.updated');
  if (result.status === 'permission-required') return t('backup.permissionRequired');
  if (result.status === 'failed') return result.config?.lastError || t('backup.failed');
  return t('backup.disabled');
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
function Avatar({ record, t }: { record: HistoryRecord; t: Translate }) {
  const [failed, setFailed] = useState(false);
  const initials = (record.authorName || record.authorHandle || 'X').slice(0, 1).toUpperCase();

  return (
    <span className="avatar-shell" aria-label={t('author.avatar', { name: record.authorName })}>
      <span>{initials}</span>
      {record.authorAvatarUrl && !failed ? (
        <img className="author-avatar" src={record.authorAvatarUrl} alt="" width="36" height="36" onError={() => setFailed(true)} />
      ) : null}
    </span>
  );
}

/** 旧记录没有独立主页字段时，根据已保存的 X 用户名安全补全作者主页。 */
function getAuthorProfileUrl(record: HistoryRecord): string {
  if (record.authorProfileUrl) return record.authorProfileUrl;
  if (record.source !== 'x') return '';
  const handle = record.authorHandle.replace(/^@/, '');
  return /^[A-Za-z0-9_]+$/.test(handle) ? `https://x.com/${handle}` : '';
}

/** 顶部 Excel 导出按钮图标，使用 currentColor 与按钮状态保持一致。 */
function ExcelIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5v4h4M9 11h6M9 15h6M12 9v8" /></svg>;
}

/** 清晰可缩放的设置齿轮图标。 */
function SettingsIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1A1.7 1.7 0 0 0 2.5 13.6H2v-4h.5A1.7 1.7 0 0 0 4.2 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.66 3.2l.06.06A1.7 1.7 0 0 0 8.6 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1h4a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 .6 1c.3.35.7.55 1.1.6h.9v4h-.9a1.7 1.7 0 0 0-1.7 1.4Z" /></svg>;
}

/** 以紧凑格式展示已抓到的互动数据，未渲染的指标不会伪装成 0。 */
function EngagementStats({ record, locale, t }: { record: HistoryRecord; locale: Locale; t: Translate }) {
  const items = [
    [t('engagement.reply'), record.replyCount],
    [t('engagement.repost'), record.repostCount],
    [t('engagement.share'), record.shareCount],
    [t('engagement.view'), record.viewCount],
    [t('engagement.bookmark'), record.bookmarkCount],
    [t('engagement.like'), record.likeCount],
  ] as const;
  const visibleItems: Array<readonly [string, number]> = items.flatMap(([label, value]) =>
    typeof value === 'number' ? [[label, value] as const] : [],
  );
  if (!visibleItems.length) return null;

  const numberFormatter = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
  return <div className="engagement-meta" aria-label={t('engagement.label')}>{visibleItems.map(([label, value]) => <span key={label}><b>{numberFormatter.format(value)}</b>{label}</span>)}</div>;
}

/** 活跃停留不足 5 秒时不展示；较长时长只保留对用户有意义的小时、分钟和秒。 */
function formatActiveDuration(durationMs: number | undefined, locale: Locale): string {
  const totalSeconds = Math.floor(Math.max(0, durationMs ?? 0) / 1_000);
  if (totalSeconds < 5) return '';
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (locale === 'en') {
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }
  if (hours) return `${hours}小时${minutes}分`;
  if (minutes) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

/** 渲染单条时光记录，包括内容摘要、作者信息、浏览时间和原文入口。 */
function HistoryRow({ record, locale, t }: { record: HistoryRecord; locale: Locale; t: Translate }) {
  const authorProfileUrl = getAuthorProfileUrl(record);
  const mediaImageUrl = record.mediaPreviewUrl || (record.mediaType !== 'video' ? record.mediaUrl : '');
  const hasMedia = Boolean(mediaImageUrl || (record.mediaType === 'video' && record.mediaUrl));
  const activeDuration = formatActiveDuration(record.activeDurationMs, locale);
  return (
    <article className={`history-row ${hasMedia ? 'has-media' : ''}`}>
      {authorProfileUrl ? (
        <a className="avatar-profile-link" href={authorProfileUrl} target="_blank" rel="noreferrer" aria-label={t('author.openProfile', { name: record.authorName })} title={t('action.openAuthor')}>
          <Avatar record={record} t={t} />
        </a>
      ) : <Avatar record={record} t={t} />}
      <div className="history-content">
        <div className="title-line">
          <a href={record.url} target="_blank" rel="noreferrer">{record.title}</a>
          <span className="record-badges">
            <span className={`source-badge source-${record.source}`} title={sourceLabel(record.source, t)}>
              <span><SourceIcon source={record.source} /></span>
              {shortSourceLabel(record.source, t)}
            </span>
            <span className="type-badge">{record.contentType === 'article' ? t('content.article') : record.contentType === 'video' ? t('content.video') : t('content.post')}</span>
          </span>
        </div>
        <p>{record.contentText}</p>
        <div className="item-meta">
          {authorProfileUrl ? (
            <a className="author-profile-link" href={authorProfileUrl} target="_blank" rel="noreferrer" title={t('action.openAuthor')}>
              <strong>{record.authorName}</strong>
              {record.authorHandle && record.source !== 'bilibili' ? <span>{record.authorHandle}</span> : null}
            </a>
          ) : <>
            <strong>{record.authorName}</strong>
            {record.authorHandle && record.source !== 'bilibili' ? <span>{record.authorHandle}</span> : null}
          </>}
          <i />
          <span>{formatPublishedAt(record.publishedAt, locale)}</span>
          {record.visitCount > 1 ? <><i /><span>{t('history.visitCount', { count: record.visitCount })}</span></> : null}
          {activeDuration ? <><i /><span className="active-time">{t('history.activeTime', { duration: activeDuration })}</span></> : null}
        </div>
        <EngagementStats record={record} locale={locale} t={t} />
      </div>
      {hasMedia ? (
        <div className="history-media" aria-label={record.mediaType === 'video' ? t('media.video') : undefined}>
          {mediaImageUrl
            ? <img src={mediaImageUrl} alt={record.mediaAlt || (record.mediaType === 'video' ? t('media.video') : record.title)} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            : <video src={record.mediaUrl} muted preload="metadata" aria-label={t('media.video')} />}
        </div>
      ) : null}
      <div className="visit-info">
        <strong>{dayDistance(record.lastVisitedAt) < 2 ? formatTime(record.lastVisitedAt, locale) : formatDate(record.lastVisitedAt, locale)}</strong>
        <span>{dayDistance(record.lastVisitedAt) < 2 ? t('history.lastViewed') : t('history.viewedDate')}</span>
        <a href={record.url} target="_blank" rel="noreferrer" aria-label={t('action.backOriginal')} title={t('action.backOriginal')}>↗</a>
      </div>
    </article>
  );
}

/** 渲染全局导航、采集状态和快捷导出操作。 */
function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === 'dark') return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M15.7 12.5A6.2 6.2 0 0 1 7.5 4.3 6.2 6.2 0 1 0 15.7 12.5Z" /></svg>;
  if (mode === 'system') return <svg aria-hidden="true" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="10" rx="1.8" /><path d="M7.5 17h5M10 14v3" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="10" cy="10" r="3" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4" /></svg>;
}

/** 三段式主题选择器，与语言开关一起作为全局界面偏好。 */
function AppearanceControls({ locale, theme, onLocaleChange, onThemeChange, t }: {
  locale: Locale;
  theme: ThemeMode;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: ThemeMode) => void;
  t: Translate;
}) {
  return <div className="appearance-controls">
    <button className="locale-toggle" type="button" onClick={() => onLocaleChange(locale === 'zh-CN' ? 'en' : 'zh-CN')} title={t('appearance.language')} aria-label={t('appearance.language')}>
      <span className={locale === 'zh-CN' ? 'active' : ''}>中</span><i /> <span className={locale === 'en' ? 'active' : ''}>EN</span>
    </button>
    <div className="theme-toggle" role="group" aria-label={t('appearance.theme')}>
      {(['dark', 'system', 'light'] as ThemeMode[]).map((mode) => <button key={mode} type="button" className={theme === mode ? 'active' : ''} onClick={() => onThemeChange(mode)} aria-pressed={theme === mode} title={t(`appearance.${mode}` as 'appearance.dark' | 'appearance.system' | 'appearance.light')}><ThemeIcon mode={mode} /></button>)}
    </div>
  </div>;
}

function Header({ view, setView, captureEnabled, onExportExcel, locale, theme, onLocaleChange, onThemeChange, t }: {
  view: View;
  setView: (view: View) => void;
  captureEnabled: boolean;
  onExportExcel: () => void;
  locale: Locale;
  theme: ThemeMode;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: ThemeMode) => void;
  t: Translate;
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="brand-button" onClick={() => setView('history')}><Brand label={t('brand.home')} /></button>
        <nav className="header-nav" aria-label={t('nav.history')}>
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>{t('nav.history')}</button>
          <button className={view === 'permissions' ? 'active' : ''} onClick={() => setView('permissions')}>{t('nav.permissions')}</button>
          <button className={view === 'data' ? 'active' : ''} onClick={() => setView('data')}>{t('nav.data')}</button>
        </nav>
        <div className="header-actions">
          <span className={`recording-state ${captureEnabled ? '' : 'paused'}`}><i /><span>{captureEnabled ? t('status.running') : t('status.paused')}</span></span>
          <button className="header-action-link export-action" type="button" onClick={onExportExcel}><ExcelIcon /><span>{t('action.exportExcel')}</span></button>
          <AppearanceControls locale={locale} theme={theme} onLocaleChange={onLocaleChange} onThemeChange={onThemeChange} t={t} />
          <button className="header-action-link settings-action" type="button" aria-label={t('action.openSettings')} onClick={() => setView('data')}><SettingsIcon /><span>{t('action.settings')}</span></button>
        </div>
      </div>
    </header>
  );
}

/** 根据当前是否存在筛选条件，展示无数据或无搜索结果提示。 */
function EmptyState({ filtered, onReset, onOpenPermissions, t }: { filtered: boolean; onReset: () => void; onOpenPermissions: () => void; t: Translate }) {
  return (
    <div className="empty-state">
      <span className="empty-search" />
      <h3>{filtered ? t('history.emptyFilteredTitle') : t('history.emptyTitle')}</h3>
      <p>{filtered ? t('history.emptyFilteredText') : t('history.emptyText')}</p>
      {filtered ? <button type="button" onClick={onReset}>{t('action.clearFilters')}</button> : <button className="empty-link" type="button" onClick={onOpenPermissions}>{t('action.visitSupported')}</button>}
    </div>
  );
}

/** Seenest 主页面：组织本地记录查询、筛选、备份和设置管理。 */
export function App() {
  const autoBackup = useLiveQuery(() => db.autoBackup.get(AUTO_BACKUP_KEY), [], undefined);
  const [view, setView] = useState<View>('history');
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [xEnabled, setXEnabled] = useState(true);
  const [bilibiliEnabled, setBilibiliEnabled] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [locale, setLocale] = useState<Locale>('zh-CN');
  const [query, setQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [newestFirst, setNewestFirst] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [calendarPage, setCalendarPage] = useState(0);
  // 多页轨道的第 0 张是末页克隆，因此初始位置从第 1 张真实页面开始。
  const [calendarTrackIndex, setCalendarTrackIndex] = useState(1);
  const [calendarTransitionEnabled, setCalendarTransitionEnabled] = useState(false);
  const [calendarPaused, setCalendarPaused] = useState(false);
  const [calendarCycle, setCalendarCycle] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);
  const calendarPointerStart = useRef<number | null>(null);
  const t: Translate = (key, values) => translate(locale, key, values);
  // 真实扩展从 manifest 读取版本；普通网页预览使用当前演示版本。
  const appVersion = typeof browser !== 'undefined' && browser.runtime?.getManifest
    ? browser.runtime.getManifest().version
    : packageMetadata.version;

  // 列表使用来源与时间索引按页读取；关键词搜索也只在本地执行。
  const historyPage = useLiveQuery(() => queryHistoryPage({
    page: currentPage,
    pageSize: PAGE_SIZE,
    query,
    source: sourceFilter,
    timeFilter,
    selectedDate,
    newestFirst,
  }), [currentPage, query, sourceFilter, timeFilter, selectedDate, newestFirst], { items: [], total: 0 });
  const totalCount = useLiveQuery(() => db.history.count(), [], 0);
  const sourceOptions = useLiveQuery(async () => (await db.history.orderBy('source').uniqueKeys())
    .filter((source): source is string => typeof source === 'string'), [], []);
  // 时光日历只汇总最近 500 条，数据量固定，不会随历史记录增长而持续占用更多内存。
  const recentRecords = useLiveQuery(() => db.history.orderBy('lastVisitedAt').reverse().limit(CALENDAR_RECORD_LIMIT).toArray(), [], []);
  const todayCount = useLiveQuery(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return db.history.where('firstVisitedAt').aboveOrEqual(today.toISOString()).count();
  }, [], 0);
  const totalPages = Math.max(1, Math.ceil(historyPage.total / PAGE_SIZE));
  const availableSources = useMemo(() => Array.from(new Set(['x', ...(bilibiliEnabled ? ['bilibili'] : []), ...sourceOptions])), [bilibiliEnabled, sourceOptions]);
  const pageStart = historyPage.total ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, historyPage.total);

  // 首次渲染时恢复采集、主题和语言偏好，三个界面入口始终使用同一份本地设置。
  useEffect(() => {
    const applySettingsState = (settings: SeenestSettings) => {
      setCaptureEnabled(settings.captureEnabled);
      setXEnabled(settings.enabledSources.x);
      setBilibiliEnabled(settings.enabledSources.bilibili);
      setTheme(settings.theme);
      setLocale(settings.locale);
      applyTheme(settings.theme);
      applyLocale(settings.locale);
    };
    void getSettings().then(applySettingsState);
    // 弹窗修改全局开关后，已经打开的管理页无需刷新即可同步导航栏和来源开关。
    return subscribeSettings(applySettingsState);
  }, []);
  // 任一筛选或排序发生变化都从第一页重新开始。
  useEffect(() => { setCurrentPage(1); }, [query, sourceFilter, timeFilter, selectedDate, newestFirst]);
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

  // 从最近 500 条记录中取最多 20 个真实存在的日期，不生成数量为 0 的空日期。
  const recentDates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of recentRecords) {
      const key = localDateKey(record.lastVisitedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, CALENDAR_DATE_LIMIT);
  }, [recentRecords]);
  const calendarPageCount = Math.ceil(recentDates.length / CALENDAR_PAGE_SIZE);
  const calendarPages = useMemo(() => Array.from({ length: calendarPageCount }, (_, page) =>
    recentDates.slice(page * CALENDAR_PAGE_SIZE, (page + 1) * CALENDAR_PAGE_SIZE)), [calendarPageCount, recentDates]);
  // 首尾各放一个克隆页，最后一页回到第一页时也能保持连续的单页滑动距离。
  const calendarTrackPages = useMemo(() => calendarPageCount > 1
    ? [calendarPages[calendarPageCount - 1]!, ...calendarPages, calendarPages[0]!]
    : calendarPages, [calendarPageCount, calendarPages]);

  // 页数变化时回到第一张真实页面；下一帧再恢复过渡，避免初始化位置产生动画。
  useEffect(() => {
    setCalendarPage(0);
    setCalendarTransitionEnabled(false);
    setCalendarTrackIndex(calendarPageCount > 1 ? 1 : 0);
    const frame = window.requestAnimationFrame(() => setCalendarTransitionEnabled(true));
    return () => window.cancelAnimationFrame(frame);
  }, [calendarPageCount]);

  /** 移动整条日历轨道，让旧页离场的同时新页从另一侧进入。 */
  const showCalendarPage = (page: number, direction: 1 | -1 = 1) => {
    if (!calendarPageCount) return;
    const nextPage = (page + calendarPageCount) % calendarPageCount;
    if (nextPage === calendarPage) {
      setCalendarCycle((cycle) => cycle + 1);
      return;
    }

    setCalendarTransitionEnabled(true);
    setCalendarPage(nextPage);
    if (direction > 0 && calendarPage === calendarPageCount - 1 && nextPage === 0) {
      setCalendarTrackIndex(calendarPageCount + 1);
    } else if (direction < 0 && calendarPage === 0 && nextPage === calendarPageCount - 1) {
      setCalendarTrackIndex(0);
    } else {
      setCalendarTrackIndex(nextPage + 1);
    }
    setCalendarCycle((cycle) => cycle + 1);
  };

  // 每页停留 5 秒后轮播；鼠标停留时暂停，移开后从完整的 5 秒重新开始。
  useEffect(() => {
    if (calendarPaused || calendarPageCount <= 1) return undefined;
    const timer = window.setTimeout(() => showCalendarPage(calendarPage + 1, 1), CALENDAR_AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [calendarPage, calendarPageCount, calendarPaused]);

  /** 抵达首尾克隆页后无动画复位到对应真实页，为下一轮滑动做好准备。 */
  const finishCalendarTransition = () => {
    if (calendarPageCount <= 1) return;
    const resetIndex = calendarTrackIndex === 0
      ? calendarPageCount
      : calendarTrackIndex === calendarPageCount + 1 ? 1 : null;
    if (resetIndex === null) return;
    setCalendarTransitionEnabled(false);
    setCalendarTrackIndex(resetIndex);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setCalendarTransitionEnabled(true)));
  };

  /** 触控和鼠标横向拖动超过 36px 才翻页，避免点击日期时误触。 */
  const finishCalendarSwipe = (clientX: number) => {
    if (calendarPointerStart.current === null) return;
    const distance = clientX - calendarPointerStart.current;
    calendarPointerStart.current = null;
    if (Math.abs(distance) < 36 || calendarPageCount <= 1) return;
    showCalendarPage(calendarPage + (distance < 0 ? 1 : -1), distance < 0 ? 1 : -1);
  };

  /** X 与其他来源独立开关；开启任一来源时同时恢复旧版的全局记录开关。 */
  const toggleXCapture = async () => {
    const current = await getSettings();
    // 全局暂停时，点击视觉上已关闭的来源开关表示恢复 Seenest 并启用该来源。
    const next = current.captureEnabled ? !current.enabledSources.x : true;
    const nextCaptureEnabled = next || current.enabledSources.bilibili;
    setXEnabled(next);
    setCaptureEnabled(nextCaptureEnabled);
    await updateSettings({
      captureEnabled: nextCaptureEnabled,
      enabledSources: { ...current.enabledSources, x: next },
    });
  };

  /** B 站使用可选站点权限；只有用户主动打开开关时浏览器才显示授权提示。 */
  const toggleBilibiliCapture = async () => {
    const current = await getSettings();
    const next = current.captureEnabled ? !current.enabledSources.bilibili : true;
    if (next && !current.enabledSources.bilibili && typeof browser !== 'undefined') {
      const granted = await browser.permissions.request({ origins: BILIBILI_OPTIONAL_ORIGINS });
      if (!granted) {
        setNotice(t('permissions.requestDenied'));
        return;
      }
    }

    setBilibiliEnabled(next);
    const nextCaptureEnabled = next || current.enabledSources.x;
    setCaptureEnabled(nextCaptureEnabled);
    await updateSettings({
      captureEnabled: nextCaptureEnabled,
      enabledSources: { ...current.enabledSources, bilibili: next },
    });
    if (typeof browser !== 'undefined') {
      const message: SeenestMessage = { type: 'SEENEST_SYNC_SOURCE_REGISTRATION' };
      await browser.runtime.sendMessage(message);
    }
    setNotice(next ? t('permissions.bilibiliEnabled') : t('permissions.bilibiliDisabled'));
  };

  /** 即时应用并持久化主题；system 模式会继续监听操作系统外观变化。 */
  const changeTheme = async (next: ThemeMode) => {
    setTheme(next);
    applyTheme(next);
    await updateSettings({ theme: next });
  };

  /** 切换预置界面词典；历史记录标题、正文和作者信息保持原样。 */
  const changeLocale = async (next: Locale) => {
    setLocale(next);
    applyLocale(next);
    await updateSettings({ locale: next });
  };

  /** 导出可完整恢复的 JSON 备份。 */
  const handleExport = async () => {
    downloadJson(await exportHistory());
    setNotice(t('backup.exported'));
  };

  /** 将当前全部记录整理为 Excel 文件并下载。 */
  const handleExportExcel = async () => {
    await exportHistoryExcel(await db.history.orderBy('lastVisitedAt').reverse().toArray(), locale);
    setNotice(t('backup.excelExported'));
  };

  /** 读取用户选择的 JSON 备份，校验后合并到本地数据库。 */
  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as ExportPayload;
      const count = await importHistory(payload, t('backup.invalid'));
      // 导入会改变完整数据集；若已开启自动备份，立即同步一份新的快照。
      await writeAutoBackupSnapshot(locale);
      setNotice(t('backup.restored', { count }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('backup.importFailed'));
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
        ? await reconnectAutoBackupFile(autoBackup, locale)
        : await connectAutoBackupFile(locale);
      setNotice(autoBackupNotice(result, t));
    } catch (error) {
      if (!isPickerCancelled(error)) {
        setNotice(error instanceof Error ? error.message : t('backup.connectFailed'));
      }
    } finally {
      setBackupBusy(false);
    }
  };

  /** 不更换文件，立即把当前全部记录写入已经连接的备份。 */
  const handleAutoBackupNow = async () => {
    setBackupBusy(true);
    try {
      setNotice(autoBackupNotice(await writeAutoBackupSnapshot(locale), t));
    } finally {
      setBackupBusy(false);
    }
  };

  /** 关闭自动备份只移除扩展保存的授权，不删除磁盘上已有的 JSON 文件。 */
  const handleAutoBackupDisconnect = async () => {
    await disconnectAutoBackupFile();
    setNotice(t('backup.disconnected'));
  };

  /** 二次确认后删除当前设备中的全部时光记录。 */
  const handleClear = async () => {
    if (!window.confirm(t('clear.confirm'))) return;
    await clearHistory();
    setNotice(t('clear.done'));
  };

  /** 同时清空来源、关键词和时间范围，恢复完整记录列表。 */
  const resetFilters = () => { setQuery(''); setSourceFilter('all'); setTimeFilter('all'); setSelectedDate(null); };
  const xCaptureActive = captureEnabled && xEnabled;
  const bilibiliCaptureActive = captureEnabled && bilibiliEnabled;

  return (
    <main className="page-shell">
      <Header view={view} setView={setView} captureEnabled={captureEnabled && (xEnabled || bilibiliEnabled)} onExportExcel={() => void handleExportExcel()} locale={locale} theme={theme} onLocaleChange={(next) => void changeLocale(next)} onThemeChange={(next) => void changeTheme(next)} t={t} />
      {notice ? <button className="toast" onClick={() => setNotice('')}>{notice}</button> : null}

      {view === 'history' ? (
        <>
          <section className="search-zone">
            <div className="search-inner">
              <div className="search-copy"><h1>{t('hero.title')}</h1><p>{t('hero.subtitle')}</p></div>
              <label className="search-box"><span className="search-icon" /><input id="history-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search.placeholder')} /><kbd>⌘ K</kbd></label>
              <div className="quick-filters" role="group" aria-label={t('filter.time')}>
                <SourceSelect value={sourceFilter} sources={availableSources} onChange={setSourceFilter} t={t} />
                {([['all', t('filter.all')], ['today', t('filter.today')], ['yesterday', t('filter.yesterday')], ['week', t('filter.week')]] as const).map(([key, label]) => (
                  <button key={key} className={`time-filter-button ${timeFilter === key && !selectedDate ? 'selected' : ''}`} onClick={() => { setSelectedDate(null); setTimeFilter(key); }}>{label}</button>
                ))}
              </div>
            </div>
          </section>

          <div className="content-area">
            <section className="history-panel">
              <div className="panel-head"><div><div className="history-title-line"><h2>{t('history.title')}</h2>{selectedDate ? <button className="active-date-filter" type="button" onClick={() => setSelectedDate(null)} title={t('filter.clearDate')}><span>{formatDate(`${selectedDate}T12:00:00`, locale)}</span><b aria-hidden="true">×</b></button> : null}</div><span>{t('history.summary', { total: totalCount, filtered: historyPage.total })}</span></div><button className="sort-control" onClick={() => setNewestFirst((value) => !value)}><span>{newestFirst ? t('history.newest') : t('history.oldest')}</span><ChevronDownIcon /></button></div>
              {groups.length ? <>
                <div className="history-groups">{groups.map(([date, items]) => (
                  <section className="history-group" key={date}>
                    <div className="date-divider"><strong>{relativeDayLabel(items[0]!.lastVisitedAt, locale)}</strong><span>{formatDate(items[0]!.lastVisitedAt, locale)}</span><i /><small>{t('history.pageCount', { count: items.length })}</small></div>
                    <div className="history-list">{items.map((record) => <HistoryRow key={record.id} record={record} locale={locale} t={t} />)}</div>
                  </section>
                ))}</div>
                {historyPage.total > PAGE_SIZE ? <nav className="pagination" aria-label={t('history.paginationLabel')}>
                  <span>{t('history.pagination', { start: pageStart, end: pageEnd, total: historyPage.total })}</span>
                  <div>
                    <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1} aria-label={t('history.previousPage')}>‹</button>
                    {paginationNumbers(currentPage, totalPages).map((page) => <button type="button" key={page} className={page === currentPage ? 'active' : ''} aria-current={page === currentPage ? 'page' : undefined} onClick={() => setCurrentPage(page)}>{page}</button>)}
                    <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages} aria-label={t('history.nextPage')}>›</button>
                  </div>
                </nav> : null}
              </> : <EmptyState filtered={Boolean(query || sourceFilter !== 'all' || timeFilter !== 'all' || selectedDate)} onReset={resetFilters} onOpenPermissions={() => setView('permissions')} t={t} />}
            </section>

            <aside className="side-column">
              <section className="side-card status-card">
                <div className="side-card-head"><h3>{t('sidebar.status')}</h3><span className={captureEnabled && (xEnabled || bilibiliEnabled) ? 'live-dot' : 'idle-dot'} /></div>
                <div className="source-row"><span className="x-logo"><SourceIcon source="x" /></span><div><strong>X / Twitter</strong><small>{!captureEnabled ? t('sidebar.globallyPaused') : xEnabled ? t('sidebar.authorized') : t('sidebar.xDisabled')}</small></div><button className={`switch ${xCaptureActive ? 'on' : ''}`} onClick={() => void toggleXCapture()} aria-label={xCaptureActive ? t('capture.pause') : t('capture.enable')}><i /></button></div>
                <div className="source-row bilibili-source-row"><span className="x-logo"><SourceIcon source="bilibili" /></span><div><strong>{t('source.bilibili')}</strong><small>{!captureEnabled ? t('sidebar.globallyPaused') : bilibiliEnabled ? t('sidebar.bilibiliAuthorized') : t('sidebar.bilibiliDisabled')}</small></div><button className={`switch ${bilibiliCaptureActive ? 'on' : ''}`} onClick={() => void toggleBilibiliCapture()} aria-label={bilibiliCaptureActive ? t('capture.pause') : t('capture.enable')}><i /></button></div>
                <div className="capture-rule"><span>✓</span><p><strong>{t('sidebar.detailOnly')}</strong>{t('sidebar.detailOnlyText')}</p></div>
                <div className="capture-fields"><span>{t('sidebar.autoSave')}</span><p>{t('sidebar.fields')}</p></div>
              </section>
              <section className="side-card data-card"><div className="side-card-head"><h3>{t('sidebar.localMemory')}</h3><button onClick={() => setView('data')}>{t('action.manage')}</button></div><div className="data-grid"><div><strong>{totalCount}</strong><span>{t('sidebar.saved')}</span></div><div><strong>{todayCount}</strong><span>{t('sidebar.todayAdded')}</span></div></div><div className="local-note"><span>⌂</span><p><strong>{t('sidebar.localOnly')}</strong><small>{t('sidebar.notUploaded')}</small></p></div></section>
              <section
                className={`side-card dates-card ${calendarPaused ? 'paused' : ''}`}
                onMouseEnter={() => setCalendarPaused(true)}
                onMouseLeave={() => { setCalendarPaused(false); setCalendarCycle((cycle) => cycle + 1); }}
              >
                <div className="side-card-head"><h3>{t('sidebar.calendar')}</h3><button onClick={() => { setSelectedDate(null); setTimeFilter('all'); }}>{t('action.all')}</button></div>
                {recentDates.length ? <>
                  <div
                    className="calendar-viewport"
                    onPointerDown={(event) => { calendarPointerStart.current = event.clientX; }}
                    onPointerUp={(event) => finishCalendarSwipe(event.clientX)}
                    onPointerCancel={() => { calendarPointerStart.current = null; }}
                  >
                    <div
                      className={`calendar-track ${calendarTransitionEnabled ? '' : 'without-transition'}`}
                      style={{ transform: `translate3d(-${calendarTrackIndex * 100}%, 0, 0)` }}
                      onTransitionEnd={(event) => { if (event.currentTarget === event.target) finishCalendarTransition(); }}
                    >
                      {calendarTrackPages.map((dates, trackPage) => <div className="calendar-page" key={trackPage}>
                        {dates.map(([date, count]) => <button className={`date-row ${selectedDate === date ? 'active' : ''}`} aria-pressed={selectedDate === date} key={date} onClick={() => { setSelectedDate(date); setTimeFilter('all'); }}><span><strong>{relativeDayLabel(`${date}T12:00:00`, locale)}</strong><small>{formatDate(`${date}T12:00:00`, locale)}</small></span><b>{count}</b></button>)}
                      </div>)}
                    </div>
                  </div>
                  {calendarPageCount > 0 ? <div className={`calendar-progress ${calendarPageCount === 1 ? 'single' : ''}`} aria-label={t('sidebar.calendarPages')}>
                    {Array.from({ length: calendarPageCount }, (_, page) => <button type="button" className={page === calendarPage ? 'active' : ''} aria-label={t('sidebar.calendarPage', { page: page + 1 })} aria-current={page === calendarPage ? 'page' : undefined} key={page} onClick={() => showCalendarPage(page, page >= calendarPage ? 1 : -1)}>{page === calendarPage ? <span key={calendarCycle} /> : null}</button>)}
                  </div> : null}
                </> : <p className="side-empty">{t('sidebar.noDates')}</p>}
              </section>
              <section className="side-card disclaimer-card">
                <div className="disclaimer-heading">
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M10 2.5 16 5v4.4c0 3.8-2.3 6.5-6 8.1-3.7-1.6-6-4.3-6-8.1V5z" /><path d="M10 7v3.5M10 13.4h.01" /></svg>
                  <strong>{t('sidebar.disclaimerTitle')}</strong>
                </div>
                <p>{t('sidebar.disclaimerText')}</p>
                <span>{t('sidebar.version', { version: appVersion })}</span>
              </section>
            </aside>
          </div>
        </>
      ) : null}

      {view === 'permissions' ? (
        <section className="settings-page"><div className="settings-heading"><span>{t('permissions.eyebrow')}</span><h1>{t('permissions.title')}</h1><p>{t('permissions.subtitle')}</p></div><div className="settings-list"><div className="settings-card"><div className="permission-logo"><SourceIcon source="x" /></div><div className="permission-copy"><strong>X / Twitter</strong><span>{t('permissions.publicOnly')}</span><code>https://x.com/*</code></div><button className={`switch large ${xCaptureActive ? 'on' : ''}`} onClick={() => void toggleXCapture()} aria-label={xCaptureActive ? t('capture.pause') : t('capture.enable')}><i /></button></div><div className="settings-card"><div className="permission-logo"><SourceIcon source="bilibili" /></div><div className="permission-copy"><strong>{t('source.bilibili')}</strong><span>{t('permissions.bilibiliPublicOnly')}</span><code>https://www.bilibili.com/video/*</code></div><button className={`switch large ${bilibiliCaptureActive ? 'on' : ''}`} onClick={() => void toggleBilibiliCapture()} aria-label={bilibiliCaptureActive ? t('capture.pause') : t('capture.enable')}><i /></button></div></div><div className="privacy-card"><strong>{t('permissions.minimum')}</strong><p>{t('permissions.minimumText')}</p></div></section>
      ) : null}

      {view === 'data' ? (
        <section className="settings-page">
          <div className="settings-heading"><span>{t('data.eyebrow')}</span><h1>{t('data.title')}</h1><p>{t('data.subtitle')}</p></div>
          <div className="data-actions">
            <article className={`backup-action ${autoBackup?.permission === 'granted' ? 'connected' : ''}`}>
              <span className="action-icon">↻</span>
              <div><strong>{t('data.autoBackup')}</strong><p>{autoBackupDescription(autoBackup, locale, t)}</p></div>
              <div className="action-controls">
                <button onClick={() => void handleAutoBackupConnect()} disabled={backupBusy}>{!autoBackup ? t('data.enableBackup') : autoBackup.permission !== 'granted' ? t('data.reauthorize') : t('data.changeFile')}</button>
                {autoBackup ? <button className="secondary" onClick={() => void handleAutoBackupNow()} disabled={backupBusy || autoBackup.permission !== 'granted'}>{t('data.backupNow')}</button> : null}
                {autoBackup ? <button className="text-button" onClick={() => void handleAutoBackupDisconnect()} disabled={backupBusy}>{t('action.close')}</button> : null}
              </div>
            </article>
            <article><span className="action-icon">▦</span><div><strong>{t('data.excelTitle')}</strong><p>{t('data.excelText')}</p></div><button onClick={() => void handleExportExcel()}>{t('action.exportExcel')}</button></article>
            <article><span className="action-icon">⇩</span><div><strong>{t('data.manualBackup')}</strong><p>{t('data.manualBackupText')}</p></div><button onClick={() => void handleExport()}>{t('data.exportBackup')}</button></article>
            <article><span className="action-icon">⇧</span><div><strong>{t('data.restore')}</strong><p>{t('data.restoreText')}</p></div><button onClick={() => importRef.current?.click()}>{t('data.selectBackup')}</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => void handleImport(event)} /></article>
            <article className="danger"><span className="action-icon">×</span><div><strong>{t('data.clear')}</strong><p>{t('data.clearText', { count: totalCount })}</p></div><button onClick={() => void handleClear()} disabled={!totalCount}>{t('data.clearButton')}</button></article>
          </div>
        </section>
      ) : null}
    </main>
  );
}
