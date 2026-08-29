/** Chrome 在扩展更新或重新加载后会让旧页面中的内容脚本上下文失效。 */
export function isExtensionContextInvalidated(error: unknown): boolean {
  return error instanceof Error && /extension context invalidated/i.test(error.message);
}
