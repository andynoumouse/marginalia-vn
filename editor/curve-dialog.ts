// The curve dialog of the ease selects ("curve…", docs/design/param-curve-editor.md): a cubic Bezier from (0, 0) to (1, 1) shaped by
// dragging its two handles, picking a preset or typing the four numbers, with a dot that runs with the curve's timing. A native
// <dialog>, as editor/ask.ts: it keeps the focus inside, Esc cancels, and it works over the animation studio.

import { bezierEase, bezierSpec, curveStart, moveHandle, presetBezier, CURVE_Y_MAX, CURVE_Y_MIN, type Bezier } from '../engine/src/index.js';

const STYLE = `
dialog.curve-ask { background: var(--panel, #171b23); color: var(--text, #e6e9ef); border: 1px solid var(--line, #2a303c); border-radius: 8px; padding: 16px 18px; }
dialog.curve-ask::backdrop { background: #0e1117cc; }
dialog.curve-ask p { margin: 0 0 10px; color: var(--muted, #9aa3b2); font-size: 12px; max-width: 420px; }
dialog.curve-ask .cv-row { display: flex; gap: 16px; align-items: flex-start; }
dialog.curve-ask .cv-graph { width: 220px; height: 260px; background: var(--ink, #0e1117); border: 1px solid var(--line, #2a303c); border-radius: 4px; touch-action: none; }
dialog.curve-ask .cv-side { display: flex; flex-direction: column; gap: 10px; }
dialog.curve-ask .cv-presets { display: flex; gap: 4px; }
dialog.curve-ask .cv-presets button { width: 34px; height: 34px; padding: 3px; }
dialog.curve-ask .cv-presets svg { width: 100%; height: 100%; display: block; }
dialog.curve-ask .cv-nums { display: grid; grid-template-columns: auto 64px auto 64px; gap: 6px 8px; align-items: center; font-size: 12px; color: var(--muted, #9aa3b2); }
dialog.curve-ask .cv-nums input { width: 64px; }
dialog.curve-ask .cv-run { width: 196px; height: 18px; }
dialog.curve-ask .cv-handle { cursor: grab; }
dialog.curve-ask .cv-handle:focus-visible { outline: none; stroke: var(--text, #e6e9ef); stroke-width: 3; }
dialog.curve-ask .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
dialog.curve-ask button.primary { background: var(--accent, #5fd1c3); color: var(--ink, #0e1117); border-color: var(--accent, #5fd1c3); }`;

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>, parent?: Element) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
};

// The graph: time 0-1 across the unit square, the value from CURVE_Y_MIN to CURVE_Y_MAX up its height, so an overshoot has room.
const W = 220, H = 260, PAD = 20, SPAN = W - 2 * PAD, UNIT = (H - 2 * PAD / 2) / (CURVE_Y_MAX - CURVE_Y_MIN);
const gx = (x: number) => PAD + x * SPAN, gy = (y: number) => PAD / 2 + (CURVE_Y_MAX - y) * UNIT;
const ux = (px: number) => (px - PAD) / SPAN, uy = (py: number) => CURVE_Y_MAX - (py - PAD / 2) / UNIT;
const PRESETS = ['linear', 'in', 'out', 'inout', 'back'] as const;

/** A preset's icon: its curve in a small square. */
function presetIcon(b: Bezier): SVGElement {
  const s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  const p = (x: number, y: number) => `${2 + x * 20},${20 - y * 16}`;
  svg('path', { d: `M${p(0, 0)} C${p(b[0], b[1])} ${p(b[2], b[3])} ${p(1, 1)}`, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }, s);
  return s;
}

/** Ask for a curve, starting from `start` (an ease value): its `bezier(...)`, or null when cancelled. */
export function curveAsk(start: string): Promise<string | null> {
  if (!document.getElementById('curveAskStyle')) document.head.append(Object.assign(document.createElement('style'), { id: 'curveAskStyle', textContent: STYLE }));
  return new Promise(resolve => {
    let b = curveStart(start);
    const dlg = Object.assign(document.createElement('dialog'), { className: 'curve-ask' });
    dlg.setAttribute('aria-label', 'Curve');
    const form = Object.assign(document.createElement('form'), { method: 'dialog', noValidate: true }); // the numbers are clamped as typed: a field's min or max must not block Use curve
    form.innerHTML = `<p>Drag the two handles, pick a preset or type the numbers. Time runs left to right, the value up; above the square
      overshoots, below it pulls back first.</p>
      <div class="cv-row"><svg class="cv-graph" viewBox="0 0 ${W} ${H}"></svg>
        <div class="cv-side"><div class="cv-presets" role="group" aria-label="Presets"></div>
          <div class="cv-nums">${['x1', 'y1', 'x2', 'y2'].map((n, i) => `<label for="cv-${n}">${n}</label><input id="cv-${n}" type="number" step="0.01" ${i % 2 ? `min="${CURVE_Y_MIN}" max="${CURVE_Y_MAX}"` : 'min="0" max="1"'} data-i="${i}">`).join('')}</div>
          <svg class="cv-run" viewBox="0 0 196 18" aria-hidden="true"></svg></div></div>
      <div class="buttons"><button type="button" class="cv-cancel">Cancel</button><button type="submit" class="primary">Use curve</button></div>`;
    dlg.append(form);
    document.body.append(dlg);
    const graph = form.querySelector<SVGSVGElement>('.cv-graph')!, nums = [...form.querySelectorAll<HTMLInputElement>('.cv-nums input')];

    // The graph's fixed parts, then the curve and handles drawn again on every change.
    svg('rect', { x: PAD, y: PAD / 2, width: SPAN, height: H - PAD, fill: 'none', stroke: 'var(--line, #2a303c)', 'stroke-dasharray': '3 3' }, graph);
    svg('rect', { x: gx(0), y: gy(1), width: SPAN, height: gy(0) - gy(1), fill: 'rgba(255,255,255,.03)', stroke: 'var(--line, #2a303c)' }, graph);
    const live = svg('g', {}, graph);
    const handles = [0, 1].map(which => {
      const h = svg('circle', { r: 7, class: 'cv-handle', tabindex: 0, fill: 'var(--accent, #5fd1c3)', stroke: '#000', 'stroke-width': 1.5, 'data-h': which }, graph) as SVGCircleElement;
      h.append(Object.assign(document.createElementNS(NS, 'title'), { textContent: `Handle ${which + 1}: drag it, or arrows (Shift: by 0.1)` }));
      return h;
    });
    const draw = (typed?: HTMLInputElement) => {
      const p0 = [gx(0), gy(0)], p1 = [gx(b[0]), gy(b[1])], p2 = [gx(b[2]), gy(b[3])], p3 = [gx(1), gy(1)];
      live.replaceChildren();
      for (const [a, c] of [[p0, p1], [p3, p2]]) svg('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: 'var(--muted, #9aa3b2)', 'stroke-width': 1 }, live);
      svg('path', { d: `M${p0} C${p1} ${p2} ${p3}`, fill: 'none', stroke: 'var(--text, #e6e9ef)', 'stroke-width': 2.5 }, live);
      handles[0].setAttribute('cx', String(p1[0])); handles[0].setAttribute('cy', String(p1[1]));
      handles[1].setAttribute('cx', String(p2[0])); handles[1].setAttribute('cy', String(p2[1]));
      nums.forEach((n, i) => { if (n !== typed) n.value = String(Math.round(b[i] * 100) / 100); });
    };

    // Presets: a button per named ease a Bezier makes.
    const presets = form.querySelector('.cv-presets')!;
    for (const name of PRESETS) {
      const pb = presetBezier(name)!, btn = Object.assign(document.createElement('button'), { type: 'button', title: name });
      btn.setAttribute('aria-label', name);
      btn.append(presetIcon(pb));
      btn.addEventListener('click', () => { b = [...pb] as Bezier; draw(); });
      presets.append(btn);
    }

    // Dragging and nudging a handle; typing a number.
    for (const h of handles) {
      const which = Number(h.dataset.h) as 0 | 1;
      h.addEventListener('pointerdown', e => {
        e.preventDefault();
        h.setPointerCapture(e.pointerId);
        h.focus();
        const at = (m: PointerEvent) => { const r = graph.getBoundingClientRect(), px = (m.clientX - r.left) * (W / r.width), py = (m.clientY - r.top) * (H / r.height); b = moveHandle(b, which, ux(px), uy(py)); draw(); };
        const move = (m: PointerEvent) => at(m), up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
        h.addEventListener('pointermove', move);
        h.addEventListener('pointerup', up);
      });
      h.addEventListener('keydown', e => {
        const step = e.shiftKey ? 0.1 : 0.01, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
        if (!d) return;
        e.preventDefault();
        b = moveHandle(b, which, b[which * 2] + d[0], b[which * 2 + 1] + d[1]);
        draw();
      });
    }
    for (const n of nums) n.addEventListener('input', () => {
      const v = Number(n.value), i = Number(n.dataset.i), which = (i >> 1) as 0 | 1;
      if (n.value === '' || !Number.isFinite(v)) return;
      b = i % 2 ? moveHandle(b, which, b[which * 2], v) : moveHandle(b, which, v, b[which * 2 + 1]);
      draw(n);
    });

    // The preview: a dot runs along a line with the curve's timing, 1 s each way and a short rest (none with Reduce motion).
    const run = form.querySelector<SVGSVGElement>('.cv-run')!;
    svg('line', { x1: 8, y1: 9, x2: 188, y2: 9, stroke: 'var(--line, #2a303c)', 'stroke-width': 2 }, run);
    const dot = svg('circle', { cx: 8, cy: 9, r: 6, fill: 'var(--accent, #5fd1c3)' }, run);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const u = ((now - t0) / 1000) % 1.4, k = Math.min(1, u);
      dot.setAttribute('cx', String(8 + 180 * Math.max(-0.2, Math.min(1.2, bezierEase(b)(k)))));
      frame = requestAnimationFrame(tick);
    };
    if (!still) frame = requestAnimationFrame(tick);

    let result: string | null = null;
    form.addEventListener('submit', () => { result = bezierSpec(b); });
    form.querySelector('.cv-cancel')!.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { cancelAnimationFrame(frame); dlg.remove(); resolve(result); });
    draw();
    dlg.showModal();
    handles[0].focus();
  });
}
