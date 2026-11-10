// Small DOM builders shared by the animation studio's modules.

const SVGNS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The property rows of the studio's right column (studio.css `.as-prow`): a bold name (`.as-pivot-name`), the controls, and hints
 * (`.as-pivot-hint`) under them. Rows whose own children are replaced wholesale (`.am-groupnote`) and strips of chips (`.ab-keys`) are not here.
 */
export const PROP_ROWS = '.as-gz-nums, .as-inspector, .as-pivot, .as-auto, .as-place, .af-bar, .af-edit, .ap-keyedit, .aw-bind, .aw-auto, .aww-mirror, .aww-pose, .aww-brush, .aww-sel, .aww-num, .aw-read, .aw-meshgen, .aw-members, .aw-grid, .aw-form, .aw-sel, .aw-pt, .aw-tools, .aw-xf, .aw-presets, .am-kind, .am-shape, .am-poly, .ab-form';

/**
 * Lay out the property rows under `root` as name | controls, hints beneath: each row gets the class `as-prow` and its controls (every child
 * that is neither the name nor a hint) move into one `.as-ctl` span after the name, so the CSS can give them a grid of their own whatever the
 * column's width. Call it once, after the markup is set; the rows' classes and the controls' selectors are unchanged.
 */
export function layoutRows(root: ParentNode) {
  for (const row of root.querySelectorAll<HTMLElement>(PROP_ROWS)) {
    if (row.classList.contains('as-prow')) continue;
    row.classList.add('as-prow');
    const kids = [...row.children];
    const name = kids[0]?.classList.contains('as-pivot-name') ? kids[0] : null;
    const ctl = el('span', { className: 'as-ctl' });
    const moved = kids.filter(k => k !== name && !k.classList.contains('as-pivot-hint'));
    if (!moved.length) continue;
    row.insertBefore(ctl, moved[0]);
    ctl.append(...moved);
  }
}
