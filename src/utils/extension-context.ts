/** Chrome 在扩展更新或重新加载后会让旧页面中的内容脚本上下文失效。 */
export function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : '';
  return /extension context invalidated/i.test(message);
}

/**
 * 扩展重新加载后，旧页面中已经启动的异步任务可能在任意一层被 Chrome 拒绝。
 * 这里只拦截明确的上下文失效错误，其他异常仍按原方式暴露，避免掩盖业务问题。
 */
export function installExtensionContextInvalidationGuard(): () => void {
  if (typeof globalThis.addEventListener !== 'function') return () => undefined;

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (isExtensionContextInvalidated(event.reason)) event.preventDefault();
  };
  globalThis.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);
}
