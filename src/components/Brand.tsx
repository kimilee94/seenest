/** 在主页面和弹窗中复用统一的 Seenest 图形标志与品牌名称。 */
export function Brand() {
  return (
    <span className="brand" aria-label="Seenest 时光机首页">
      <img className="brand-logo" src="/icons/seenest-logo.png" alt="" width="34" height="34" aria-hidden="true" />
      <span className="brand-text"><strong>Seenest</strong></span>
    </span>
  );
}
