import type { CapturedVisit } from '../types/history';
import type { CapturedRoute, SiteAdapter } from './types';

export interface CaptureRunnerOptions<TResult> {
  adapter: SiteAdapter<TResult>;
  settleMs: number;
  maxWaitMs: number;
  observeDom: boolean;
  isEnabled(): Promise<boolean>;
  onCaptured(capture: CapturedRoute<TResult>): Promise<void>;
  onRouteLeave(): void;
}

function createVisitId(source: string): string {
  const unique = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${source}:visit:${unique}`;
}

/** 去掉查询参数和 hash，避免把临时令牌或跟踪参数写入 Visit 的来源字段。 */
function sanitizeReferrer(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * 共享采集生命周期：监听 SPA URL、等待页面稳定、短时观察 DOM，并确保一个路由会话只提交一次。
 * Adapter 不需要重复实现定时器和 MutationObserver，也不会在采集完成后继续扫描页面。
 */
export function createCaptureRunner<TResult>(options: CaptureRunnerOptions<TResult>) {
  let currentRouteKey = options.adapter.getRouteKey(new URL(location.href)) ?? '';
  let currentUrl = location.href;
  let captureTimer: number | undefined;
  let timeoutTimer: number | undefined;
  let routePollTimer: number | undefined;
  let observer: MutationObserver | undefined;
  let generation = 0;
  let sessionStartedAt = 0;
  let visit: CapturedVisit | null = null;
  let capturedRouteKey = '';

  const stopCaptureSession = () => {
    generation += 1;
    observer?.disconnect();
    observer = undefined;
    if (captureTimer !== undefined) window.clearTimeout(captureTimer);
    if (timeoutTimer !== undefined) window.clearTimeout(timeoutTimer);
    captureTimer = undefined;
    timeoutTimer = undefined;
    visit = null;
  };

  const scheduleAttempt = (version: number, delay = 350) => {
    if (version !== generation) return;
    if (captureTimer !== undefined) window.clearTimeout(captureTimer);
    captureTimer = window.setTimeout(() => void attemptCapture(version), delay);
  };

  const attemptCapture = async (version: number): Promise<void> => {
    captureTimer = undefined;
    if (version !== generation || !visit || !await options.isEnabled()) return;
    const url = new URL(location.href);
    if (!options.adapter.match(url) || options.adapter.getRouteKey(url) !== currentRouteKey) return;

    const remainingSettleTime = options.settleMs - (Date.now() - sessionStartedAt);
    if (remainingSettleTime > 0) {
      scheduleAttempt(version, remainingSettleTime);
      return;
    }

    const result = await options.adapter.capture({ document, url });
    if (version !== generation) return;
    if (!result) {
      // DOM 型 Adapter 会等待下一次节点变化；API 请求型 Adapter 在本次页面不做循环重试。
      if (!options.observeDom) stopCaptureSession();
      return;
    }

    const capturedVisit = visit;
    capturedRouteKey = currentRouteKey;
    // 提交前先停止观察，保证异步后台响应期间也不会产生第二次采集。
    stopCaptureSession();
    await options.onCaptured({ result, visit: capturedVisit });
  };

  const startCaptureSession = async (referrer = document.referrer) => {
    stopCaptureSession();
    const version = generation;
    const url = new URL(location.href);
    const routeKey = options.adapter.getRouteKey(url);
    if (!routeKey || !options.adapter.match(url) || !await options.isEnabled() || version !== generation) return;

    currentRouteKey = routeKey;
    sessionStartedAt = Date.now();
    visit = {
      id: createVisitId(options.adapter.source),
      startedAt: new Date().toISOString(),
      referrer: sanitizeReferrer(referrer),
    };

    if (options.observeDom) {
      observer = new MutationObserver(() => scheduleAttempt(version));
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    timeoutTimer = window.setTimeout(stopCaptureSession, options.maxWaitMs);
    scheduleAttempt(version, options.settleMs);
  };

  const checkRoute = () => {
    const nextUrl = location.href;
    const nextRouteKey = options.adapter.getRouteKey(new URL(nextUrl)) ?? '';
    // 查询参数或 hash 变化不代表用户重新进入内容页，不应产生新的 Visit。
    if (nextRouteKey === currentRouteKey) {
      currentUrl = nextUrl;
      return;
    }
    const referrer = currentUrl;
    currentUrl = nextUrl;
    options.onRouteLeave();
    stopCaptureSession();
    currentRouteKey = nextRouteKey;
    capturedRouteKey = '';
    if (nextRouteKey) void startCaptureSession(referrer);
  };

  const start = () => {
    if (routePollTimer === undefined) routePollTimer = window.setInterval(checkRoute, 1_000);
    void startCaptureSession();
  };

  const restart = () => {
    options.onRouteLeave();
    capturedRouteKey = '';
    currentUrl = location.href;
    currentRouteKey = options.adapter.getRouteKey(new URL(currentUrl)) ?? '';
    void startCaptureSession();
  };

  const stop = () => {
    options.onRouteLeave();
    stopCaptureSession();
    capturedRouteKey = '';
  };

  /** 页面从后台恢复可见时只补做尚未完成的采集；已成功提交的同一路由不会重复计次。 */
  const ensure = () => {
    const routeKey = options.adapter.getRouteKey(new URL(location.href)) ?? '';
    if (!routeKey || routeKey === capturedRouteKey) return;
    if (visit) scheduleAttempt(generation, 0);
    else void startCaptureSession();
  };

  const destroy = () => {
    stop();
    if (routePollTimer !== undefined) window.clearInterval(routePollTimer);
    routePollTimer = undefined;
  };

  return { start, restart, ensure, stop, destroy };
}
