// Studio mode of the preview page (`preview/index.html?studio=<char>`): the animation dialog of the editor embeds it
// to show one character on a plain stage. The editor drives it with postMessage; the page answers with `studioTime`
// while an animation plays. Messages from the editor:
//   { type: 'studioShow', pose, overrides }               dress the character
//   { type: 'studioAnims', anims }                        the working copy of the character's `animations`
//   { type: 'studioSeek', name, t, part }                 stop and pose at progress t (0-1)
//   { type: 'studioPlay', name, dur, loop, part }         play from the start; `studioPause` stops where it is
//   { type: 'studioPivots', pivots, bones, parts, width, height }   the working copy of rig.json `pivots`, `bones`, `parts` and the PSD canvas size
//   { type: 'studioFocus', part }                         dim every part but this one (or a bone's parts); null shows all
//   { type: 'studioPick', part }                          show the character at rest with that part's pivot; a click
//                                                         answers { type: 'studioPicked', part, x, y, drag } in PSD pixels (a press and each
//                                                         move are drag 'move', the release 'end'); null ends it
//   { type: 'studioMarks', on }                           rig inspection: the character at rest with a cross for every pivot, picking or not
//   { type: 'studioPlace', on, x, y, scale, flip, anchor: [fx, fy] }        where the character stands; with `on` a drag on the stage moves it and
//                                                         answers { type: 'studioPlaced', x, y } (stage fractions, as `show` takes them)
//   { type: 'studioScene', file, line }                   draw the background and the other characters as the story has them
//                                                         at that script line (null file: a plain stage again); not while picking

import { psdToStage, stageToPsd, type AnimDef, type BoneDef, type DisplayState, type PivotFrame, type Pivots } from '../engine/src/index.js';
import type { PixiRenderer } from './pixi-renderer.js';
import { H, stage, W } from './stage-ui.js';

interface Run { name: string; dur: number; loop: boolean; part: string | null; start: number }
type Msg = { type?: string; file?: unknown; line?: unknown; on?: unknown; x?: unknown; y?: unknown; scale?: unknown; flip?: unknown; anchor?: unknown; pivots?: unknown; bones?: unknown; parts?: unknown; width?: unknown; height?: unknown; pose?: unknown; overrides?: unknown; anims?: unknown; name?: unknown; t?: unknown; dur?: unknown; loop?: unknown; part?: unknown };

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) ? v : or);

export class Studio {
  private anims: Record<string, AnimDef> = {};
  private pose: string | null = null;
  private overrides: Record<string, string> = {};
  private last: { name: string; t: number; part: string | null } | null = null;
  private run: Run | null = null;
  private pivots: Pivots = {};
  private bones: Record<string, BoneDef> = {};   // the editor's working copy of rig.json `bones` and `parts`
  private partBones: Record<string, { bone?: string; pivot?: [number, number] }> = {};
  private lines: SVGSVGElement;
  private size = { width: 0, height: 0 };
  private pick: string | null = null;     // the part whose pivot is being placed
  private place = { x: 0.5, y: 0, scale: 1, flip: false, anchor: [0.5, 1] as [number, number] };
  private marks = false;                  // every pivot is shown, the character at rest (the editor's Rig mode)
  private placing = false;                // a drag on the stage moves the character
  private showing = false;                // a sync is under way
  private again = false;                  // and the placement changed meanwhile
  private marker = document.createElement('div');
  private others: HTMLElement[] = [];     // dim crosses for the other parts' pivots, shown while picking
  private sceneLine: { file: string; line: number } | null = null;
  private scene: DisplayState | null = null; // the stage at sceneLine, without this character

  /** `sceneAt` replays the project's scripts to a line (the page's current program, so a hot reload is followed). */
  constructor(private renderer: PixiRenderer, readonly char: string, private sceneAt: (at: { file: string; line: number }) => Promise<DisplayState>) {
    this.marker.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;z-index:30;display:none';
    const bar = (css: string) => `<div style="position:absolute;background:#ff3b6b;box-shadow:0 0 0 2px #000;${css}"></div>`;
    this.marker.innerHTML = bar('left:-30px;top:-1.5px;width:60px;height:3px') + bar('left:-1.5px;top:-30px;width:3px;height:60px');
    stage.append(this.marker);
    this.lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.lines.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.lines.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:28';
    stage.append(this.lines);
    stage.addEventListener('click', e => this.onClick(e), true);
    stage.addEventListener('pointerdown', e => this.onDrag(e));
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      void this.handle(e.data as Msg | null);
    });
  }

  /** Put the character on stage with the current pose (again after a hot reload of the project). */
  async show(announce = true) {
    // Pivots are placed in PSD pixels from a character standing bottom-centre, so picking ignores the placement and the scene.
    const rest = this.pick || this.marks;
    const at = rest ? { x: 0.5, y: 0, scale: 1, flip: false, anchor: [0.5, 1] as [number, number] } : this.place;
    const scene = rest ? null : this.scene;
    const state: DisplayState = {
      bg: scene?.bg ?? null, music: null, musicLoop: false,
      sprites: [...scene?.sprites ?? [], { char: this.char, pose: this.pose, more: [], overrides: this.overrides, ...at, rotation: 0, alpha: 1, anim: null }],
    };
    await this.renderer.prepare(state);
    this.renderer.sync(state);
    if (this.size.width) this.renderer.studioPivots(this.char, this.pivots, this.bones, this.partBones); // the editor's working copy, not the file's
    if (this.last) this.poseAt(this.last.name, this.last.t, this.last.part);
    if (rest) this.renderer.studioRest(this.char);
    if (announce) window.parent.postMessage({ type: 'studioReady' }, location.origin);
  }

  /** Replay the story to the scene line again (it is set, or the scripts changed). */
  async loadScene() {
    const at = this.sceneLine;
    if (!at) { this.scene = null; return; }
    const s = await this.sceneAt(at);
    if (at !== this.sceneLine) return; // a newer line arrived meanwhile
    this.scene = { ...s, sprites: s.sprites.filter(x => x.char !== this.char).map(x => ({ ...x, anim: null })) };
  }

  /** Redraw after the placement or pick mode changed; changes that arrive during a redraw are drawn once it is done. */
  private redraw() {
    if (this.showing) { this.again = true; return; }
    this.showing = true;
    void this.show(false).finally(() => {
      this.showing = false;
      if (this.again) { this.again = false; this.redraw(); }
    });
  }

  /** A press while picking places the pivot there and dragging moves it; the editor gets `drag: 'move'` and, on release, `'end'` (one undo step). */
  private dragPivot(e: PointerEvent) {
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const at = (p: PointerEvent, drag: 'move' | 'end') => {
      const r = stage.getBoundingClientRect();
      const [x, y] = stageToPsd(this.frame, ((p.clientX - r.left) / r.width) * W, ((p.clientY - r.top) / r.height) * H);
      window.parent.postMessage({ type: 'studioPicked', part: this.pick, x, y, drag }, location.origin);
    };
    at(e, 'move');
    const move = (m: PointerEvent) => at(m, 'move');
    const up = (m: PointerEvent) => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); at(m, 'end'); };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  }

  private onDrag(e: PointerEvent) {
    if (this.pick) { this.dragPivot(e); return; }
    if (!this.placing) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    const move = (m: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      this.place = { ...this.place, x: this.place.x + (m.clientX - lx) / r.width, y: this.place.y + (m.clientY - ly) / r.height };
      lx = m.clientX; ly = m.clientY;
      window.parent.postMessage({ type: 'studioPlaced', x: this.place.x, y: this.place.y }, location.origin);
      this.redraw();
    };
    const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
  }

  private get frame(): PivotFrame { return { stageW: W, stageH: H, ...this.size }; }

  /** Where bone `b` turns: its own pivot, else the nearest parent's; undefined when nothing up the chain has one. */
  private bonePivot(b: string): [number, number] | undefined {
    for (let cur: string | undefined = b, i = 0; cur !== undefined && Object.hasOwn(this.bones, cur) && i < 99; cur = this.bones[cur].parent, i++) {
      const p = this.bones[cur].pivot;
      if (Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) return [p[0], p[1]];
    }
    return undefined;
  }
  /** The pivot shown for `name`: a bone's (own or inherited), else the part's `pivots` entry. */
  private pivotOf(name: string): [number, number] | undefined {
    return Object.hasOwn(this.bones, name) ? this.bonePivot(name) : this.pivots[name];
  }
  /** A line from each bone's pivot to its children's, while the rig is shown (Rig mode and picking). */
  private drawLines() {
    this.lines.replaceChildren();
    if (!(this.pick || this.marks)) return;
    for (const [b, def] of Object.entries(this.bones)) {
      const from = typeof def.parent === 'string' ? this.bonePivot(def.parent) : undefined, to = this.bonePivot(b);
      if (!from || !to) continue;
      const [x1, y1] = psdToStage(this.frame, from[0], from[1]), [x2, y2] = psdToStage(this.frame, to[0], to[1]);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      for (const [k, v] of Object.entries({ x1, y1, x2, y2, stroke: '#ffd23b', 'stroke-width': 3, 'stroke-dasharray': '6 5', 'stroke-opacity': 0.8 })) line.setAttribute(k, String(v));
      line.dataset.bone = b;
      this.lines.append(line);
    }
  }

  /** Pick mode: the character at rest and a cross where the part's pivot is. */
  private showPick() {
    const at = this.pick ? this.pivotOf(this.pick) : undefined;
    const [x, y] = at ? psdToStage(this.frame, at[0], at[1]) : [0, 0];
    this.marker.style.display = at ? 'block' : 'none';
    this.marker.style.left = `${x}px`;
    this.marker.style.top = `${y}px`;
    // The other pivots, so a group sharing one point shows as one cross with every part's name.
    const every: [string, [number, number]][] = [...Object.entries(this.pivots), ...Object.keys(this.bones).flatMap((b): [string, [number, number]][] => { const p = this.bonePivot(b); return p ? [[b, p]] : []; })];
    const rest = this.pick ? (at ? every.filter(([n]) => n !== this.pick) : []) : this.marks ? every : [];
    const spots = new Map<string, string[]>();
    for (const [n, p] of rest) {
      const k = psdToStage(this.frame, p[0], p[1]).map(Math.round).join(',');
      spots.set(k, [...(spots.get(k) ?? []), n]);
    }
    while (this.others.length < spots.size) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border:2px solid #ffd23b;border-radius:50%;box-shadow:0 0 0 1px #000;pointer-events:none;z-index:29';
      stage.append(d);
      this.others.push(d);
    }
    this.others.forEach((d, i) => {
      const e = [...spots.entries()][i];
      d.style.display = e ? 'block' : 'none';
      if (!e) return;
      const [px, py] = e[0].split(',');
      d.style.left = `${px}px`;
      d.style.top = `${py}px`;
      d.title = e[1].join(', ');
    });
    this.drawLines();
    stage.style.cursor = this.pick ? 'crosshair' : '';
    if (this.pick || this.marks) this.renderer.studioRest(this.char);
    else if (this.last) this.poseAt(this.last.name, this.last.t, this.last.part);
  }

  /** The press itself placed the pivot (dragPivot); the click after it must not reach the stage's own handlers. */
  private onClick(e: MouseEvent) {
    if (this.pick) e.stopPropagation();
  }

  private poseAt(name: string, t: number, part: string | null) {
    this.last = { name, t, part };
    if (this.pick || this.marks) return;
    this.renderer.studioPose(this.char, this.anims, name, Math.min(1, Math.max(0, t)), part);
  }

  private async handle(m: Msg | null) {
    switch (m?.type) {
      case 'studioShow': {
        this.pose = str(m.pose);
        const o = m.overrides && typeof m.overrides === 'object' ? Object.entries(m.overrides) : [];
        this.overrides = Object.fromEntries(o.filter((p): p is [string, string] => typeof p[1] === 'string'));
        await this.show(false);
        break;
      }
      case 'studioPlace':
        this.placing = m.on === true;
        this.place = { x: num(m.x, 0.5), y: num(m.y, 0), scale: Math.max(0.05, num(m.scale, 1)), flip: m.flip === true, anchor: Array.isArray(m.anchor) && m.anchor.length === 2 ? [num(m.anchor[0], 0.5), num(m.anchor[1], 1)] : [0.5, 1] };
        stage.style.cursor = this.placing ? 'move' : '';
        this.redraw();
        break;
      case 'studioScene':
        this.sceneLine = typeof m.file === 'string' && typeof m.line === 'number' ? { file: m.file, line: m.line } : null;
        await this.loadScene();
        this.redraw();
        break;
      case 'studioAnims':
        if (m.anims && typeof m.anims === 'object') this.anims = m.anims as Record<string, AnimDef>;
        if (this.last && !this.run) this.poseAt(this.last.name, this.last.t, this.last.part);
        break;
      case 'studioSeek': {
        const name = str(m.name);
        this.run = null;
        if (name) this.poseAt(name, num(m.t, 0), str(m.part));
        break;
      }
      case 'studioPlay': {
        const name = str(m.name);
        if (!name) break;
        this.run = { name, dur: Math.max(0.05, num(m.dur, 1)), loop: m.loop === true, part: str(m.part), start: performance.now() };
        requestAnimationFrame(this.tick);
        break;
      }
      case 'studioPivots': {
        const o = m.pivots && typeof m.pivots === 'object' ? Object.entries(m.pivots) : [];
        this.pivots = Object.fromEntries(o.filter((p): p is [string, [number, number]] => Array.isArray(p[1]) && p[1].length === 2 && p[1].every(Number.isFinite)));
        const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, d]) => d && typeof d === 'object' && !Array.isArray(d))) : {});
        this.bones = rec(m.bones) as Record<string, BoneDef>;
        this.partBones = rec(m.parts);
        this.size = { width: num(m.width, 0), height: num(m.height, 0) };
        this.renderer.studioPivots(this.char, this.pivots, this.bones, this.partBones);
        this.showPick();
        break;
      }
      case 'studioMarks':
        this.marks = m.on === true;
        this.run = null;
        this.showPick();
        this.redraw();
        break;
      case 'studioPick':
        this.pick = str(m.part);
        this.run = null;
        this.showPick();
        this.redraw();
        break;
      case 'studioPause':
        this.run = null;
        break;
      case 'studioFocus':
        this.renderer.studioFocus(this.char, str(m.part));
        break;
    }
  }

  private tick = (now: number) => {
    const r = this.run;
    if (!r) return;
    const k = (now - r.start) / 1000 / r.dur;
    const done = !r.loop && k >= 1;
    const t = done ? 1 : r.loop ? k % 1 : k;
    this.poseAt(r.name, t, r.part);
    if (done) this.run = null;
    window.parent.postMessage({ type: 'studioTime', t, playing: !done }, location.origin);
    if (!done) requestAnimationFrame(this.tick);
  };
}
