// Validation of custom screen declarations: problems that need no variables. Re-exported by screens.ts.

import { stageLabel, DEFAULT_STAGE, type StageSize } from './stage.js';
import type { Src } from './types.js';
import { ACHIEVEMENT_TOAST_SCREEN, isClickable, type ScreenDef, type ScreenNode } from './screens.js';
import { shapeBounds } from './screen-geometry.js';

export interface ScreenProblem { src: Src; severity: 'error' | 'warning'; message: string }

/** Problems in one screen declaration that need no variables: ids, shapes, an empty screen. */
export function validateScreen(def: ScreenDef, stage: StageSize = DEFAULT_STAGE): ScreenProblem[] {
  const out: ScreenProblem[] = [];
  const stock = def.src.file.startsWith('stock/'); // the starters are laid out for the default stage: no off-stage warnings about them
  const problem = (src: Src, severity: 'error' | 'warning', message: string) => { if (!(stock && severity === 'warning')) out.push({ src, severity, message }); };
  const ids = new Set<string>();
  const hinted: { src: Src; from: string; to: string }[] = [];
  let interactive = 0, hasEach = false;
  const walk = (nodes: ScreenNode[], loop: string | null, area = false, nested = false) => {
    for (const n of nodes) {
      if (n.kind === 'scroll') {
        if (area) problem(n.src, 'error', 'A scroll area cannot be inside another scroll area');
        else if (nested) problem(n.src, 'error', 'A scroll area goes directly in the screen, not inside each, row, column or grid');
        if (n.w <= 0 || n.h <= 0) problem(n.src, 'error', 'A scroll area needs a size above zero');
        walk(n.body, loop, true, nested);
        continue;
      }
      if (n.kind === 'each') { hasEach = true; walk(n.body, n.as, area, true); continue; }
      if (n.kind === 'panel') {
        if ((n.w !== null && n.w <= 0) || (n.h !== null && n.h <= 0)) problem(n.src, 'error', 'A panel needs a size above zero');
        else if (n.w === null && n.h === null && !n.body.length && !n.file) problem(n.src, 'warning', 'An empty panel without a size or an image draws nothing useful (give it size w,h)');
        if (n.slice.some(s => s < 0)) problem(n.src, 'error', 'A panel slice cannot be negative');
        walk(n.body, loop, area, nested);
        continue;
      }
      if (n.kind === 'bar') {
        if (n.w <= 0 || n.h <= 0) problem(n.src, 'error', 'A bar needs a size above zero');
        continue;
      }
      if (n.kind === 'layout') {
        if (n.type === 'grid' && n.cell && (n.cell[0] <= 0 || n.cell[1] <= 0)) problem(n.src, 'error', 'A grid cell needs a size above zero');
        walk(n.body, loop, area, true);
        continue;
      }
      if (area && n.kind === 'hotspot' && (n.shape.k === 'poly' || n.shape.k === 'mask')) problem(n.src, 'error', 'A poly or mask hotspot cannot be inside a scroll area (use a rect or ellipse)');
      if (area && n.kind === 'slider') problem(n.src, 'error', 'A slider cannot be inside a scroll area');
      if (isClickable(n) && n.body?.length && loop !== null) problem(n.src, 'error', `"${n.id}" has child elements, which "each" cannot repeat (every copy would share the children's ids); put the group outside the each`);
      if (isClickable(n)) {
        interactive++;
        if (loop !== null && n.id !== loop && !n.id.startsWith(`${loop}.`)) problem(n.src, 'error', `Inside "each", the element id must be "${loop}" (the entry) or "${loop}.<word>", or every copy would share one id`);
        else if (loop === null && ids.has(n.id)) problem(n.src, 'error', `Duplicate element id "${n.id}" in screen ${def.name}`);
        if (loop === null) ids.add(n.id);
        if (loop === null) for (const to of Object.values(n.focus)) hinted.push({ src: n.src, from: n.id, to });
        if (n.id === '') problem(n.src, 'error', 'An element id cannot be empty (an empty answer means cancel)');
      }
      if (n.kind === 'hotspot') {
        const s = n.shape, b = shapeBounds(s);
        if (s.k === 'poly' && s.points.length < 3) problem(n.src, 'error', 'A poly needs at least three points');
        if (s.k !== 'poly' && (s.w <= 0 || s.h <= 0)) problem(n.src, 'error', 'A hotspot needs a size above zero');
        if (loop === null && (b.x + b.w < 0 || b.y + b.h < 0 || b.x > stage.width || b.y > stage.height)) {
          problem(n.src, 'warning', `Hotspot "${n.id}" is outside the ${stageLabel(stage)} stage (coordinates are stage pixels)`);
        }
      }
      if (n.kind === 'button' && loop === null && (n.x < 0 || n.y < 0 || n.x > stage.width || n.y > stage.height)) {
        problem(n.src, 'warning', `Button "${n.id}" is outside the ${stageLabel(stage)} stage (coordinates are stage pixels)`);
      }
      if (isClickable(n) && n.body?.length) walk(n.body, loop, area, nested);
    }
  };
  walk(def.body, null);
  if (!hasEach) for (const h of hinted) if (!ids.has(h.to)) problem(h.src, 'error', `"${h.from}" moves focus to "${h.to}", which is not an element of screen ${def.name}`);
  if (!interactive && !def.cancel && def.name !== ACHIEVEMENT_TOAST_SCREEN) problem(def.src, 'warning', `Screen ${def.name} has nothing to choose (it would return at once)`);
  if (def.default !== null && !ids.has(def.default) && !hasEach) problem(def.src, 'error', `Default "${def.default}" is not an element of screen ${def.name}`);
  return out;
}
