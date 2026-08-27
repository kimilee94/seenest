export const BILIBILI_REQUEST_GUARD_KEY = 'seenestBilibiliRequestGuard';
export const BILIBILI_MIN_REQUEST_INTERVAL_MS = 5_000;

const TRANSIENT_BACKOFF_BASE_MS = 30_000;
const RATE_LIMIT_BACKOFF_BASE_MS = 60_000;
const PROTECTION_BACKOFF_MS = 30 * 60_000;
const MAX_TRANSIENT_BACKOFF_MS = 10 * 60_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 30 * 60_000;

export interface BilibiliRequestGuardState {
  lastRequestAt: number;
  blockedUntil: number;
  consecutiveFailures: number;
  lastFailureStatus?: number | 'network';
}

export const DEFAULT_BILIBILI_REQUEST_GUARD: BilibiliRequestGuardState = {
  lastRequestAt: 0,
  blockedUntil: 0,
  consecutiveFailures: 0,
};

/** 后台每次准备请求前都要通过这个判断，同时覆盖持久化退避和全局最小间隔。 */
export function canRequestBilibili(
  state: BilibiliRequestGuardState,
  now: number,
): { allowed: boolean; retryAt: number } {
  if (state.blockedUntil > now) return { allowed: false, retryAt: state.blockedUntil };
  const intervalEndsAt = state.lastRequestAt + BILIBILI_MIN_REQUEST_INTERVAL_MS;
  if (intervalEndsAt > now) return { allowed: false, retryAt: intervalEndsAt };
  return { allowed: true, retryAt: now };
}

/** 实际发出 fetch 前立即写入时间，即使请求失败也不会绕过限流。 */
export function markBilibiliRequestStarted(
  state: BilibiliRequestGuardState,
  now: number,
): BilibiliRequestGuardState {
  return { ...state, lastRequestAt: now };
}

/** 成功后清空历史失败次数，但保留本次请求时间以继续限流。 */
export function markBilibiliRequestSucceeded(
  state: BilibiliRequestGuardState,
): BilibiliRequestGuardState {
  return { ...state, blockedUntil: 0, consecutiveFailures: 0, lastFailureStatus: undefined };
}

/**
 * 403/412 视为平台保护信号，直接冷却 30 分钟；429 指数退避。
 * 网络或 5xx 也会短时退避，但所有情况都不会在当前页面自动重试。
 */
export function markBilibiliRequestFailed(
  state: BilibiliRequestGuardState,
  status: number | 'network',
  now: number,
  retryAfterMs = 0,
): BilibiliRequestGuardState {
  const consecutiveFailures = state.consecutiveFailures + 1;
  let backoffMs = 0;

  if (status === 403 || status === 412) {
    backoffMs = PROTECTION_BACKOFF_MS;
  } else if (status === 429) {
    backoffMs = Math.min(
      RATE_LIMIT_BACKOFF_BASE_MS * 2 ** Math.min(consecutiveFailures - 1, 5),
      MAX_RATE_LIMIT_BACKOFF_MS,
    );
  } else if (status === 'network' || status >= 500) {
    backoffMs = Math.min(
      TRANSIENT_BACKOFF_BASE_MS * 2 ** Math.min(consecutiveFailures - 1, 5),
      MAX_TRANSIENT_BACKOFF_MS,
    );
  }

  return {
    ...state,
    consecutiveFailures,
    lastFailureStatus: status,
    blockedUntil: backoffMs ? now + Math.max(backoffMs, retryAfterMs) : state.blockedUntil,
  };
}

