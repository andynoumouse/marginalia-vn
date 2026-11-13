// Small DOM builders shared by the animation studio's modules.

import { curveAsk } from './curve-dialog.js';

const SVGNS = 'http://www.w3.org/2000/svg';
/** The value of the "curve…" entry every ease select ends with: it asks for a `bezier(...)` (see pickEase). */
const CURVE = '(curve)'; // never an ease name or a bezier(...)

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
/**
 * Show `value` in an ease select whose options are the named eases: a `bezier(...)` gets an option of its own (the one added
 * last time goes), so the select shows the curve instead of a blank, and the select ends with a "curve…" entry for pickEase.
 */
export function showEase(sel: HTMLSelectElement, value: string) {
  for (const o of sel.querySelectorAll('option[data-custom]')) if ((o as HTMLOptionElement).value !== value) o.remove();
  let curve = sel.querySelector<HTMLOptionElement>('option[data-curve]');
  if (!curve) {
    curve = el('option', { value: CURVE, textContent: 'curve…', title: 'Shape a curve of your own: drag its handles (written as bezier(x1,y1,x2,y2))' });
    curve.dataset.curve = '';
    sel.append(curve);
  }
  if (value && ![...sel.options].some(o => o.value === value)) {
    const o = el('option', { value, textContent: value });
    o.dataset.custom = '';
    sel.insertBefore(o, curve);
  }
  sel.value = value;
  sel.dataset.was = value;
}

/**
 * The ease an ease select's change picks: its value, or for "curve…" a `bezier(...)` shaped in the curve dialog (starting from the
 * current ease; UX round 3 AN-11: it was typed in a prompt). Null when cancelled: the select shows its old value again.
 */
export async function pickEase(sel: HTMLSelectElement): Promise<string | null> {
  if (sel.value !== CURVE) return sel.value;
  const was = sel.dataset.was ?? '';
  const spec = await curveAsk(was);
  showEase(sel, spec ?? was);
  return spec;
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

/**
 * Bring `row` into view inside the nearest box of the studio's columns that scrolls, and nothing beyond it: `scrollIntoView` would also scroll
 * the studio's card, which in a narrow window pushes the stage off the screen when the tree shows its chosen row (ES-4).
 */
export function scrollRowIntoBox(row: Element | null) {
  let box = row?.parentElement ?? null;
  while (box && !box.classList.contains('as-card') && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (!row || !box || box.classList.contains('as-card')) return;
  const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop -= b.top - r.top;
  else if (r.bottom > b.bottom) box.scrollTop += Math.min(r.bottom - b.bottom, r.top - b.top);
}
