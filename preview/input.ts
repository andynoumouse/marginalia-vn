// Keyboard and gamepad navigation. Every input device is turned into the same few actions:
//   up / down / left / right   move between buttons, sliders and selects (and change a slider or select sideways)
//   confirm / cancel           press the focused button; go back
//   tabPrev / tabNext          switch tab in the options
//   backspace / shift          X and Y on the on-screen keyboard of a name prompt
//   advance / rollback / auto / hide / history / pause / skip   while playing, no menu open
//   hud                        right stick click while playing: focus the HUD (B or Backspace leaves it)
// The pure parts (spatial focus search, the gamepad mapper) work without a browser and are covered by tests.

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Action = Dir | 'confirm' | 'cancel' | 'tabPrev' | 'tabNext' | 'backspace' | 'shift'
  | 'rollback' | 'auto' | 'hide' | 'history' | 'pause' | 'skipOn' | 'skipOff' | 'hud';

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Focus `el` for a prompt or menu that just opened, unless the game sits in the editor and the player is not in it:
 * focusing inside a same-origin iframe pulls focus out of the editor, and every edit replays the preview to the cursor.
 */
export function autoFocus(el: HTMLElement | null | undefined, opts?: FocusOptions): boolean {
  if (!el || (window.parent !== window && !document.hasFocus())) return false;
  el.focus(opts);
  return true;
}

/**
 * The box to move to from `boxes[from]` in direction `dir`, or -1. Candidates must lie mostly in that direction
 * (entirely past the starting box's edge). Of those, the nearest row (or column) wins, and within it the
 * one best aligned with the starting box, so a wide button does not skip over the row below it.
 */
export function spatialNext(boxes: Box[], from: number, dir: Dir): number {
  const a = boxes[from];
  if (!a) return -1;
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  const vertical = dir === 'up' || dir === 'down';
  const found: { i: number; along: number; across: number }[] = [];
  boxes.forEach((b, i) => {
    if (i === from) return;
    const dx = b.x + b.w / 2 - ax, dy = b.y + b.h / 2 - ay;
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    const across = vertical ? Math.abs(dx) : Math.abs(dy);
    const edge = dir === 'up' ? a.y - (b.y + b.h) : dir === 'down' ? b.y - (a.y + a.h)
      : dir === 'left' ? a.x - (b.x + b.w) : b.x - (a.x + a.w); // a box beside or above is not ahead when moving the other way
    if (along <= 1 || edge < -4) return;
    found.push({ i, along, across });
  });
  if (!found.length) return -1;
  const nearest = Math.min(...found.map(f => f.along));
  const band = (vertical ? a.h : a.w) * 0.75; // boxes this much further are the same row or column
  const inBand = found.filter(f => f.along <= nearest + band);
  return inBand.reduce((best, f) => (f.across < best.across || (f.across === best.across && f.along < best.along) ? f : best)).i;
}

/** Elements the keyboard or pad can land on inside `root`: visible and enabled. */
export function focusables(root: HTMLElement): HTMLElement[] {
  const all = root.querySelectorAll<HTMLElement>('button, input:not([type=hidden]), select, [tabindex="0"]');
  return [...all].filter(e => {
    if ((e as HTMLButtonElement).disabled || e.getAttribute('aria-disabled') === 'true' || e.closest('[inert], [hidden]')) return false;
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && e.getClientRects().length > 0;
  });
}

/** Move focus within `root`; with nothing focused there, land on the first element. Returns false if nothing moved. */
export function moveFocus(root: HTMLElement, dir: Dir): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.classList.contains('sc-scroll') && root.contains(active) && (dir === 'up' || dir === 'down')) {
    // a scroll area with focus scrolls first; at its end the move goes on to the elements around it
    const before = active.scrollTop;
    active.scrollBy({ top: (dir === 'down' ? 1 : -1) * active.clientHeight * 0.8 });
    if (Math.abs(active.scrollTop - before) > 1) return true;
  }
  const items = focusables(root);
  if (!items.length) return false;
  const from = items.indexOf(document.activeElement as HTMLElement);
  if (from < 0) { items[0].focus(); return true; }
  const to = spatialNext(items.map(e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }), from, dir);
  if (to < 0) return false;
  items[to].focus();
  items[to].scrollIntoView({ block: 'nearest' });
  return true;
}

/** Left/right on a slider or select changes its value; true if the focused element took the key. */
export function adjustFocused(dir: 'left' | 'right'): boolean {
  const e = document.activeElement;
  const step = dir === 'right' ? 1 : -1;
  if (e instanceof HTMLInputElement && e.type === 'range') {
    if (step > 0) e.stepUp(); else e.stepDown();
    e.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (e instanceof HTMLSelectElement) {
    const next = Math.min(e.options.length - 1, Math.max(0, e.selectedIndex + step));
    if (next !== e.selectedIndex) { e.selectedIndex = next; e.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  }
  return false;
}

// ---- gamepad ----

export interface PadSnapshot { buttons: boolean[]; axes: number[] }

/** Standard-mapping button numbers. */
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, SELECT: 8, START: 9, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const STICK = 0.6;               // how far the stick must be pushed
const REPEAT_FIRST = 400, REPEAT = 130; // ms before a held direction repeats, then between repeats

export interface PadMapOptions { menu: boolean }

/**
 * Turns pad snapshots into actions. Feed it every frame with a timestamp. The meaning of the buttons depends on
 * whether a menu is open: in a menu the d-pad moves focus, in the game up goes back a line and A advances.
 */
export class PadMapper {
  private prev = new Set<string>();
  private nextRepeat = new Map<string, number>();

  update(snap: PadSnapshot, now: number, o: PadMapOptions): Action[] {
    const down = new Set<string>();
    const btn = (n: number, name: string) => { if (snap.buttons[n]) down.add(name); };
    btn(B.UP, 'up'); btn(B.DOWN, 'down'); btn(B.LEFT, 'left'); btn(B.RIGHT, 'right');
    if ((snap.axes[1] ?? 0) < -STICK) down.add('up');
    if ((snap.axes[1] ?? 0) > STICK) down.add('down');
    if ((snap.axes[0] ?? 0) < -STICK) down.add('left');
    if ((snap.axes[0] ?? 0) > STICK) down.add('right');
    btn(B.A, 'A'); btn(B.B, 'B'); btn(B.X, 'X'); btn(B.Y, 'Y'); btn(B.LB, 'LB'); btn(B.RB, 'RB');
    btn(B.SELECT, 'SELECT'); btn(B.START, 'START'); btn(B.R3, 'R3');

    const out: Action[] = [];
    const pressed = (k: string) => down.has(k) && !this.prev.has(k);
    for (const d of ['up', 'down', 'left', 'right'] as const) {
      let fire = pressed(d);
      if (fire) this.nextRepeat.set(d, now + REPEAT_FIRST);
      else if (down.has(d) && now >= (this.nextRepeat.get(d) ?? Infinity)) { fire = true; this.nextRepeat.set(d, now + REPEAT); }
      if (!down.has(d)) this.nextRepeat.delete(d);
      if (!fire) continue;
      if (o.menu) out.push(d);
      else if (d === 'up') out.push('rollback');
      else if (d === 'down' || d === 'right') out.push('confirm'); // advance
    }
    if (pressed('A')) out.push('confirm');
    if (pressed('B')) out.push(o.menu ? 'cancel' : 'pause');
    if (pressed('START')) out.push(o.menu ? 'cancel' : 'pause');
    if (pressed('LB')) out.push(o.menu ? 'tabPrev' : 'rollback');
    if (pressed('RB') && o.menu) out.push('tabNext');
    if (o.menu) {
      if (pressed('X')) out.push('backspace'); // on the on-screen keyboard
      if (pressed('Y')) out.push('shift');
    } else {
      if (pressed('X')) out.push('auto');
      if (pressed('Y')) out.push('hide');
      if (pressed('SELECT')) out.push('history');
      if (pressed('R3')) out.push('hud');
      if (pressed('RB')) out.push('skipOn');
      if (!down.has('RB') && this.prev.has('RB')) out.push('skipOff'); // skip while the shoulder button is held
    }
    this.prev = down;
    return out;
  }
}

export function snapshotOf(pad: Gamepad): PadSnapshot {
  return { buttons: pad.buttons.map(b => b.pressed), axes: [...pad.axes] };
}

export interface PadStatus { connected: boolean; id: string; standard: boolean }

/** The pad to read: a connected one with the standard layout if there is one (virtual devices and odd HID gear come first otherwise). */
export function pickPad(pads: (Gamepad | null)[]): Gamepad | undefined {
  const live = pads.filter((p): p is Gamepad => !!p?.connected);
  return live.find(p => p.mapping === 'standard') ?? live[0];
}

/**
 * Polls for a pad every frame and reports its actions. Polling never stops: browsers only list a pad after
 * a button is pressed on it, and the connect events are not reliable (a pad that was already connected, a page
 * without focus), so the poll itself notices pads appearing and going away and reports that through `onStatus`.
 */
export function watchGamepad(onAction: (a: Action) => void, isMenu: () => boolean, onStatus?: (s: PadStatus) => void) {
  if (typeof navigator.getGamepads !== 'function') return;
  let mapper = new PadMapper();
  let current: Gamepad | undefined;
  const tick = (now: number) => {
    const pad = pickPad([...navigator.getGamepads()]);
    if (pad?.index !== current?.index || pad?.id !== current?.id) {
      current = pad;
      mapper = new PadMapper(); // a held button on the old pad must not carry over
      onStatus?.({ connected: !!pad, id: pad?.id ?? '', standard: pad?.mapping === 'standard' });
    }
    if (pad) for (const a of mapper.update(snapshotOf(pad), now, { menu: isMenu() })) onAction(a);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---- on-screen keyboard (name prompts with a gamepad) ----

export const OSK_ROWS = ['1234567890', 'qwertyuiopå', 'asdfghjklöä', "zxcvbnm-'."];

export interface OskState {
  value: string;
  shift: boolean;  // one-shot capital
  fresh: boolean;  // the field still shows the default: the first key replaces it
}

/** Whether the next letter is a capital: after Shift, or at the start of the text (names). */
export const oskCaps = (s: OskState) => s.shift || s.fresh || s.value === '';

/** Apply one key of the on-screen keyboard: a character, 'space', 'back' or 'shift'. */
export function oskPress(s: OskState, key: string, max: number): OskState {
  if (key === 'shift') return { ...s, shift: !s.shift };
  if (key === 'back') return { value: s.fresh ? '' : Array.from(s.value).slice(0, -1).join(''), shift: false, fresh: false };
  const base = s.fresh ? '' : s.value;
  if (Array.from(base).length >= max) return { ...s, fresh: false, value: base };
  const ch = key === 'space' ? ' ' : oskCaps(s) ? key.toLocaleUpperCase() : key;
  return { value: base + ch, shift: false, fresh: false };
}

/** The on-screen keyboard for a text field: always built, shown by CSS while the last input came from a pad. */
export function oskBoard(field: HTMLInputElement, max: number): HTMLElement {
  let osk: OskState = { value: field.value, shift: false, fresh: true };
  const board = document.createElement('div');
  board.className = 'osk';
  const key = (label: string, id: string, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.textContent = label;
    b.dataset.osk = id;
    if (cls) b.className = cls;
    b.addEventListener('click', e => {
      e.stopPropagation();
      osk = oskPress(osk, id, max);
      field.value = osk.value;
      board.dataset.caps = String(oskCaps(osk));
    });
    return b;
  };
  for (const row of OSK_ROWS) {
    const r = document.createElement('div');
    for (const ch of row) r.append(key(ch, ch));
    board.append(r);
  }
  const bottom = document.createElement('div');
  bottom.append(key('⇧', 'shift', 'wide'), key('space', 'space', 'space'), key('⌫', 'back', 'wide'));
  board.append(bottom);
  board.dataset.caps = String(oskCaps(osk));
  field.addEventListener('input', () => { osk = { value: field.value, shift: false, fresh: false }; });
  return board;
}
