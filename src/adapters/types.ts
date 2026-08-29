import type { CapturedVisit, HistorySource } from '../types/history';

export interface CaptureContext {
  document: Document;
  url: URL;
}

/** 每个平台 Adapter 只负责识别路由和提取平台数据，不处理计时、去重或数据库。 */
export interface SiteAdapter<TResult> {
  source: HistorySource;
  match(url: URL): boolean;
  getRouteKey(url: URL): string | null;
  capture(context: CaptureContext): Promise<TResult | null> | TResult | null;
}

export interface CapturedRoute<TResult> {
  result: TResult;
  visit: CapturedVisit;
}
