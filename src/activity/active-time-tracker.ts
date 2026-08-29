import type { SeenestMessage } from '../types/messages';
import { isExtensionContextInvalidated } from '../utils/extension-context';

const ACTIVITY_TIMEOUT_MS = 90_000;
const CHECKPOINT_INTERVAL_MS = 30_000;
const SYSTEM_STATE_REFRESH_MS = 15_000;
const TICK_INTERVAL_MS = 1_000;
const MAX_TICK_GAP_MS = 2_000;

export interface ActiveTimeEligibility {
  hasRecord: boolean;
  pageVisible: boolean;
  windowFocused: boolean;
  systemActive: boolean;
  now: number;
  lastActivityAt: number;
}

/** 只有内容可见、窗口聚焦，且页面与系统都未进入空闲状态时才累计。 */
export function isActiveTimeEligible(state: ActiveTimeEligibility): boolean {
  return state.hasRecord
    && state.pageVisible
    && state.windowFocused
    && state.systemActive
    && state.now - state.lastActivityAt <= ACTIVITY_TIMEOUT_MS;
}

function createSessionId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 为一个已经成功入库的详情页累计活跃停留时间。
 * 这里只保存时间增量，不保存鼠标坐标、按键内容或滚动位置。
 */
export function createActiveTimeTracker() {
  let memoryId = '';
  let visitId = '';
  let trackerSessionId = '';
  let sequence = 0;
  let accumulatedMs = 0;
  let lastTickAt = performance.now();
  let lastActivityAt = performance.now();
  let systemActive = false;
  let systemStateRequestInFlight = false;
  let tickTimer: number | undefined;
  let systemStateTimer: number | undefined;
  let contextInvalidated = false;

  const refreshSystemState = async () => {
    if (contextInvalidated || !memoryId || !visitId || systemStateRequestInFlight) return;
    systemStateRequestInFlight = true;
    try {
      const response = await browser.runtime.sendMessage({ type: 'SEENEST_ACTIVITY_STATE' } satisfies SeenestMessage) as { ok?: boolean; active?: boolean } | undefined;
      systemActive = response?.ok === true && response.active === true;
    } catch (error) {
      systemActive = false;
      if (isExtensionContextInvalidated(error)) {
        contextInvalidated = true;
        stopTimers();
      }
    } finally {
      systemStateRequestInFlight = false;
    }
  };

  const accumulateElapsed = () => {
    const now = performance.now();
    const elapsed = Math.min(MAX_TICK_GAP_MS, Math.max(0, now - lastTickAt));
    if (isActiveTimeEligible({
      hasRecord: Boolean(memoryId && visitId),
      pageVisible: document.visibilityState === 'visible',
      windowFocused: document.hasFocus(),
      systemActive,
      now,
      lastActivityAt,
    })) accumulatedMs += elapsed;
    lastTickAt = now;
  };

  const flush = async () => {
    if (contextInvalidated) return;
    accumulateElapsed();
    const targetMemoryId = memoryId;
    const targetVisitId = visitId;
    const durationMs = Math.round(accumulatedMs);
    if (!targetMemoryId || !targetVisitId || durationMs < 250) return;
    accumulatedMs = 0;
    sequence += 1;
    const message: SeenestMessage = {
      type: 'SEENEST_ACTIVE_TIME',
      payload: {
        memoryId: targetMemoryId,
        visitId: targetVisitId,
        trackerSessionId,
        sequence,
        durationMs,
        measuredAt: new Date().toISOString(),
      },
    };
    try {
      await browser.runtime.sendMessage(message);
    } catch (error) {
      // 页面关闭或扩展更新时后台可能暂时不可用；最多损失当前未确认的一个短时间片。
      if (isExtensionContextInvalidated(error)) {
        contextInvalidated = true;
        stopTimers();
      }
    }
  };

  const closeVisit = async () => {
    if (contextInvalidated) return;
    const targetMemoryId = memoryId;
    const targetVisitId = visitId;
    if (!targetMemoryId || !targetVisitId) return;
    const message: SeenestMessage = {
      type: 'SEENEST_VISIT_END',
      payload: { memoryId: targetMemoryId, visitId: targetVisitId, endedAt: new Date().toISOString() },
    };
    try {
      await browser.runtime.sendMessage(message);
    } catch (error) {
      // 页面销毁期间属于尽力写入；最近一次活跃 checkpoint 仍可作为结束时间回退。
      if (isExtensionContextInvalidated(error)) {
        contextInvalidated = true;
        stopTimers();
      }
    }
  };

  const stopTimers = () => {
    if (tickTimer !== undefined) window.clearInterval(tickTimer);
    if (systemStateTimer !== undefined) window.clearInterval(systemStateTimer);
    tickTimer = undefined;
    systemStateTimer = undefined;
  };

  const tick = () => {
    accumulateElapsed();
    if (accumulatedMs >= CHECKPOINT_INTERVAL_MS) void flush();
  };

  const markActivity = () => {
    accumulateElapsed();
    lastActivityAt = performance.now();
    if (!systemActive) void refreshSystemState();
  };

  const handleVisibilityOrFocus = () => {
    accumulateElapsed();
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      lastActivityAt = performance.now();
      void refreshSystemState();
    } else {
      void flush();
    }
  };

  const handlePageHide = () => {
    void flush();
    void closeVisit();
  };

  document.addEventListener('visibilitychange', handleVisibilityOrFocus);
  window.addEventListener('focus', handleVisibilityOrFocus);
  window.addEventListener('blur', handleVisibilityOrFocus);
  window.addEventListener('pointerdown', markActivity, { passive: true });
  window.addEventListener('keydown', markActivity, { passive: true });
  window.addEventListener('scroll', markActivity, { passive: true });
  window.addEventListener('touchstart', markActivity, { passive: true });
  window.addEventListener('pagehide', handlePageHide);

  const start = (nextMemoryId: string, nextVisitId: string) => {
    if (contextInvalidated || !nextMemoryId || !nextVisitId || (nextMemoryId === memoryId && nextVisitId === visitId)) return;
    if (memoryId) void flush();
    stopTimers();
    memoryId = nextMemoryId;
    visitId = nextVisitId;
    trackerSessionId = createSessionId();
    sequence = 0;
    accumulatedMs = 0;
    lastTickAt = performance.now();
    lastActivityAt = lastTickAt;
    systemActive = false;
    void refreshSystemState();
    tickTimer = window.setInterval(tick, TICK_INTERVAL_MS);
    systemStateTimer = window.setInterval(() => void refreshSystemState(), SYSTEM_STATE_REFRESH_MS);
  };

  const stop = () => {
    if (!memoryId) return;
    void flush();
    void closeVisit();
    memoryId = '';
    visitId = '';
    systemActive = false;
    stopTimers();
  };

  const destroy = () => {
    stop();
    document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    window.removeEventListener('focus', handleVisibilityOrFocus);
    window.removeEventListener('blur', handleVisibilityOrFocus);
    window.removeEventListener('pointerdown', markActivity);
    window.removeEventListener('keydown', markActivity);
    window.removeEventListener('scroll', markActivity);
    window.removeEventListener('touchstart', markActivity);
    window.removeEventListener('pagehide', handlePageHide);
  };

  return { start, stop, destroy };
}
