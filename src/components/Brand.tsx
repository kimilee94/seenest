/** 在主页面和弹窗中复用统一的 Seenest 图形标志与品牌名称。 */
export function Brand({ label = 'Seenest' }: { label?: string }) {
  return (
    <span className="brand" aria-label={label}>
      <img className="brand-logo" src="/icons/seenest-logo.png" alt="" width="34" height="34" aria-hidden="true" />
      <span className="brand-text"><strong>Seenest</strong></span>
    </span>
  );
}
