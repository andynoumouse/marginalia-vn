// Studio mode of the preview page (`preview/index.html?studio=<char>`): the animation dialog of the editor embeds it
// to show one character on a plain stage. The editor drives it with postMessage; the page answers with `studioTime`
// while an animation plays. Messages from the editor:
//   { type: 'studioShow', pose, overrides }               dress the character
//   { type: 'studioAnims', anims }                        the working copy of the character's `animations`
//   { type: 'studioAuto', reactions, poses, vars }        rig.json `reactions` and `poses` as edited, and the Test variables (studio-only): Model mode runs the reactions from them (automatic animations stay suspended)
//   { type: 'studioSeek', name, t, part }                 stop and pose at progress t (0-1)
//   { type: 'studioPlay', name, dur, loop, part }         play from the start; `studioPause` stops where it is
//   { type: 'studioPivots', pivots, bones, parts, width, height }   the working copy of rig.json `pivots`, `bones`, `parts` and the PSD canvas size
//   { type: 'studioFocus', part, extra? }                 dim every part but this one (or a bone's parts) and the extra ones; null shows all
//   { type: 'studioHidden', parts }                       hide these parts (or a bone's parts) on the stage and from clicks; an export shows them
//   { type: 'studioParams', values, hold }              the Parameters panel: its values, and the ids the animator is moving by hand (they win over the
//                                                         animation's tracks; the rest follow the tracks as the game does)
//   { type: 'studioPhysics', chains, drive }              the working copy of rig.json `physics`; with a `drive` ({ param | bone + channel, amp, hz }) that input is
//                                                         swung back and forth so the chains can be watched, and settle for a moment after it ends
//   { type: 'studioPick', part }                          show the character at rest with that part's pivot; a click
//                                                         answers { type: 'studioPicked', part, x, y, drag } in PSD pixels (a press and each
//                                                         move are drag 'move', the release 'end'); null ends it
//   { type: 'studioMarks', on }                           rig inspection: the character at rest with a cross for every pivot, picking or not
//   { type: 'studioPlace', on, x, y, scale, flip, anchor: [fx, fy] }        where the character stands; with `on` a drag on the stage moves it and
//                                                         answers { type: 'studioPlaced', x, y } (stage fractions, as `show` takes them)
//   { type: 'studioGizmo', tool, name, space, stage, lock }   the bone gizmo (tool move / rotate / scale, or null for none), on the chosen part or bone, and the tool row's tool (the stage mode);
//                                                         `lock`: a drag would be thrown away, so no handles are drawn; see studio-gizmo.ts
//   { type: 'studioRig', parameters, keyforms }           the working copy of rig.json `parameters` and `keyforms` (Model mode writes keyforms): the pose is evaluated from them
//   { type: 'studioExtra', extra }                        offsets by name laid over the pose (a drag that is not keyed yet); ends a drag
//   { type: 'studioView', whole }                         fit the view to the character (or to the whole stage)
//   { type: 'studioEscape' }                              Esc pressed in the studio's side columns with a deform tool on: the stage clears the tool's selection, or answers studioKey escape
//   { type: 'studioDeformers', deformers }                the working copy of rig.json `deformers` (mesh warps); the character is shaped by it
//   { type: 'studioWeights', id, bone, heat, children, tip, picked, brush, selected, mode }  the Weights tool (see studio-gizmo.ts; null id: no tool; mode: what a press does); a click on a vertex answers { type: 'studioWeightsPick', id, vertex }
//   { type: 'studioMeshPreview', part, verts, tris }       the mesh Generate would make for the part (vertices in its image pixels), drawn dashed; null part: none
//   { type: 'studioWarp', id, points, radius, curve, topo, anchor }     the Warp tool (topo: the topology tool of a free mesh, else null; anchor: the vertex an Add edge started from): draw the lattice of the deformer with that id, a part's or a group's (null id: no tool), `points` the selected ones,
//                                                         `radius` (cells, 0 for none) and `curve` the soft selection's fade;
//                                                         answers { type: 'studioWarpBox', id, w, h } (the lattice's size in animation units) and, for a
//                                                         lattice point dragged, { type: 'studioWarpDrag', phase, id, point, delta } (see studio-gizmo.ts);
//                                                         in topology mode also { type: 'studioMeshTopo', id, op, vertex | a, b | at } (see studio-gizmo.ts)
//   { type: 'studioAlpha', id, part }                     the alpha channel of that part's image; answers { type: 'studioAlphaData', id, part, w, h, alpha } (a Uint8Array, transferred; w 0: unreadable)
//   { type: 'studioMasks', shapes, clips }                the working copy of the mask shapes (rig.json shape parts) and the `clip` link of each clipped part; the character is clipped by it
//   { type: 'studioMask', shape, part, tool, point }      draw the outline of mask shape `shape` (null: none); with `tool` every shape is outlined and the chosen one's points
//                                                         are handles, `point` the selected one; a click near another shape's outline selects it. `part` is the chosen part row:
//                                                         answers { type: 'studioMaskBox', part, x, y, w, h } (its image box in canvas pixels),
//                                                         { type: 'studioMaskDrag', phase, shape, point, delta } for a point dragged,
//                                                         { type: 'studioMaskAdd', shape, index, at } for a click on an edge and { type: 'studioMaskRemove', shape, point }
//   { type: 'studioScene', file, line }                   draw the background and the other characters as the story has them
//                                                         at that script line (null file: a plain stage again); not while picking
//   { type: 'studioExportBegin', id, name, fps, loop, loops, leadIn, width, height, framing, background }
//                                                         movie export of animation `name` (see engine/src/movie-export.ts): the character alone, nothing blinking, the chains
//                                                         at rest (then `leadIn` seconds run unseen); `framing` is 'stage' or 'character' (fitted over the whole animation);
//                                                         answers { type: 'studioExportReady', id, frames, width, height } or { type: 'studioExportError', id, error }
//   { type: 'studioExportFrame', id, n }                  pose frame n (in order, from 0), draw it and answer { type: 'studioExportData', id, n, bytes } (a PNG, transferred)
//   { type: 'studioExportEnd', id }                       the export is over or cancelled: the stage returns to what it showed; answers { type: 'studioExportDone', id }

import { exportBackground, stageMode, type ReactionDef, type Value, fitFrame, frameProgress, frameStep, movieProblem, newSprite, planMovie, psdToStage, resolveAnim, stageToPsd, unionBox, type AnimDef, type BoneDef, type Box, type DeformerDef, type DisplayState, type KeyformDef, type ShapeDef, type MoviePlan, type Offset, type ParamDef, type PivotFrame, type Pivots } from '../engine/src/index.js';
import type { StudioPixiRenderer } from './pixi-studio.js';
import { H, stage, W } from './stage-ui.js';
import { StageTools } from './studio-gizmo.js';
import { followPointer } from './input.js';

interface Drive { param?: string; bone?: string; channel: 'dx' | 'dy' | 'sx' | 'sy' | 'rot'; amp: number; hz: number }
interface Run { name: string; dur: number; loop: boolean; part: string | null; start: number }
/** A movie export under way: the plan, the piece of the stage drawn, and the next frame the editor may ask for. */
interface Export { id: number; name: string; plan: MoviePlan; width: number; height: number; frame: Box; background: string | null; next: number }
type Msg = { type?: string; shapes?: unknown; clips?: unknown; shape?: unknown; chains?: unknown; drive?: unknown; file?: unknown; line?: unknown; on?: unknown; x?: unknown; y?: unknown; scale?: unknown; flip?: unknown; anchor?: unknown; pivots?: unknown; bones?: unknown; parts?: unknown; width?: unknown; height?: unknown; pose?: unknown; overrides?: unknown; values?: unknown; hold?: unknown; parameters?: unknown; keyforms?: unknown; extra?: unknown; deformers?: unknown; masks?: unknown; point?: unknown; points?: unknown; radius?: unknown; curve?: unknown; tool?: unknown; topo?: unknown; space?: unknown; whole?: unknown; anims?: unknown; reactions?: unknown; poses?: unknown; vars?: unknown; name?: unknown; t?: unknown; dur?: unknown; loop?: unknown; part?: unknown; id?: unknown; n?: unknown; fps?: unknown; loops?: unknown; leadIn?: unknown; framing?: unknown; background?: unknown; heat?: unknown; brush?: unknown; children?: unknown; tip?: unknown; bone?: unknown; picked?: unknown; selected?: unknown; select?: unknown; mode?: unknown; stage?: unknown; lock?: unknown; verts?: unknown; tris?: unknown };

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) ? v : or);

export class Studio {
  private anims: Record<string, AnimDef> = {};
  private reactions: ReactionDef[] = [];
  private poses: Record<string, Record<string, number>> = {};
  private vars: Record<string, Value> = {};
  private pose: string | null = null;
  private overrides: Record<string, string> = {};
  private last: { name: string; t: number; part: string | null } | null = null;
  private run: Run | null = null;
  private panel: { values: Record<string, number>; hold: string[] } = { values: {}, hold: [] };
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
  private showSeq = 0;                    // the newest show(): an older one that finishes loading later must not draw over it
  private drive: Drive | null = null;      // the shake preview: one input swung by hand
  private driveStart = 0;
  private settleUntil = 0;               // after the shake ends the chains run on a little, to settle
  private physicsAt = 0;                  // when the chains were last stepped
  private hasChains = false;
  private chains: unknown = {};           // the chains last sent, so an export can start them at rest again
  private focusExtra: string[] = [];   // the parts chosen with it (Ctrl-click in Model mode)
  private hiddenParts: string[] = [];  // parts the editor hides on the stage (an export shows them)
  private focusPart: string | null = null; // the part last brought forward (an export shows every part at full strength and puts this back)
  private exp: Export | null = null;
  private marker = document.createElement('div');
  private others: HTMLElement[] = [];     // dim crosses for the other parts' pivots, shown while picking
  readonly tools: StageTools;
  private sceneLine: { file: string; line: number } | null = null;
  private scene: DisplayState | null = null; // the stage at sceneLine, without this character

  /** `sceneAt` replays the project's scripts to a line (the page's current program, so a hot reload is followed). */
  constructor(private renderer: StudioPixiRenderer, readonly char: string, private sceneAt: (at: { file: string; line: number }) => Promise<DisplayState>) {
    this.marker.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;z-index:30;display:none;transform:scale(var(--cross-scale,1));transform-origin:0 0'; // the viewport zoom must not grow it
    const bar = (css: string) => `<div style="position:absolute;background:#ff3b6b;box-shadow:0 0 0 2px #000;${css}"></div>`;
    this.marker.innerHTML = bar('left:-30px;top:-1.5px;width:60px;height:3px') + bar('left:-1.5px;top:-30px;width:3px;height:60px');
    renderer.studio = true;
    renderer.studioRefresh = () => { if (!this.run) this.render(); };
    stage.append(this.marker);
    this.lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.lines.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.lines.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:28';
    stage.append(this.lines);
    this.tools = new StageTools({
      renderer, char,
      send: msg => window.parent.postMessage(msg, location.origin),
      repose: () => { if (!this.run) this.render(); },
      suspended: () => this.pick !== null || this.placing || this.run !== null,
      carries: (part, subject) => {
        if (part === subject) return true;
        for (let b = this.partBones[part]?.bone, n = 0; b && n < 64; b = this.bones[b]?.parent, n++) if (b === subject) return true; // n: a loop in a bad rig ends
        return false;
      },
    });
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
    const scene = rest || this.exp ? null : this.scene;
    const state: DisplayState = {
      bg: scene?.bg ?? null, music: null, musicLoop: false,
      sprites: [...scene?.sprites ?? [], { ...newSprite(this.char), pose: this.pose, overrides: this.overrides, ...at }],
      ...(this.exp ? { behaviors: false as const } : {}), // an export is the animation alone: no blinking, no talking, no idle loop
    };
    const seq = ++this.showSeq;
    await this.renderer.prepare(state);
    if (seq !== this.showSeq) { // a newer show() took over while the art loaded
      if (announce) window.parent.postMessage({ type: 'studioReady' }, location.origin);
      return;
    }
    this.renderer.sync(state);
    if (this.size.width) this.renderer.studioPivots(this.char, this.pivots, this.bones, this.partBones); // the editor's working copy, not the file's
    this.render();
    this.tools.settle(); // a view fitted to the character fits its art once it is there, and then stays put
    if (announce) window.parent.postMessage({ type: 'studioPartBoxes', boxes: this.renderer.studioPartBoxes(this.char) }, location.origin); // the editor centres a new pivot by them
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
    followPointer(stage, m => at(m, 'move'), m => at(m, 'end'));
  }

  private onDrag(e: PointerEvent) {
    if (this.pick) { this.dragPivot(e); return; }
    if (!this.placing) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    followPointer(stage, m => {
      const r = stage.getBoundingClientRect();
      this.place = { ...this.place, x: this.place.x + (m.clientX - lx) / r.width, y: this.place.y + (m.clientY - ly) / r.height };
      lx = m.clientX; ly = m.clientY;
      window.parent.postMessage({ type: 'studioPlaced', x: this.place.x, y: this.place.y }, location.origin);
      this.redraw();
    });
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
      for (const [k, v] of Object.entries({ x1, y1, x2, y2, stroke: '#ffd23b', 'stroke-width': 3, 'stroke-dasharray': '6 5', 'stroke-opacity': 0.8, 'vector-effect': 'non-scaling-stroke' })) line.setAttribute(k, String(v));
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
      d.style.cssText = 'position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border:2px solid #ffd23b;border-radius:50%;box-shadow:0 0 0 1px #000;pointer-events:none;z-index:29;transform:scale(var(--cross-scale,1))';
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
    this.render();
  }

  /** The press itself placed the pivot (dragPivot); the click after it must not reach the stage's own handlers. */
  private onClick(e: MouseEvent) {
    if (this.pick) e.stopPropagation();
  }

  /** What the shake is driving now (a sine of time), as a parameter value or a bone offset; null when it is not on. */
  private driven(now: number): number | null {
    return this.drive ? this.drive.amp * Math.sin(((now - this.driveStart) / 1000) * this.drive.hz * Math.PI * 2) : null;
  }
  private poseAt(name: string, t: number, part: string | null, physicsDt: number | null = null) {
    this.last = { name, t, part };
    this.render(physicsDt);
  }
  /** Draw the pose now. Picking a pivot and Model mode (marks) show the model as its parameters and physics make it, with no animation; otherwise the last animation pose. */
  private render(physicsDt: number | null = null) {
    if (this.exp) return; // the export poses the stage itself
    const model = this.pick !== null || this.marks;
    if (!model && !this.last) return;
    let panel = this.panel, extra = this.tools.extraMap();
    const v = this.driven(performance.now());
    if (v !== null && this.drive) {
      if (this.drive.param) panel = { values: { ...panel.values, [this.drive.param]: v }, hold: [...panel.hold, this.drive.param] };
      else if (this.drive.bone) {
        extra = new Map(extra);
        extra.set(this.drive.bone, { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0, ...extra.get(this.drive.bone), [this.drive.channel]: (extra.get(this.drive.bone)?.[this.drive.channel] ?? 0) + v });
      }
    }
    const at = model ? null : this.last!;
    this.renderer.studioPose(this.char, this.anims, at ? at.name : null, at ? Math.min(1, Math.max(0, at.t)) : 0, at ? at.part : null, panel, extra, this.hasChains ? physicsDt : null);
    this.tools.draw();
  }

  private async handle(m: Msg | null) {
    switch (m?.type) {
      case 'studioShow': return this.onShow(m);
      case 'studioPlace': return this.onPlace(m);
      case 'studioScene': return this.onScene(m);
      case 'studioAnims': return this.onAnims(m);
      case 'studioAuto': return this.onAuto(m);
      case 'studioSeek': return this.onSeek(m);
      case 'studioPlay': return this.onPlay(m);
      case 'studioPivots': return this.onPivots(m);
      case 'studioMarks': return this.onMarks(m);
      case 'studioPick': return this.onPick(m);
      case 'studioParams': return this.onParams(m);
      case 'studioPhysics': return this.onPhysics(m);
      case 'studioPause': return this.onPause(m);
      case 'studioGizmo': return this.onGizmo(m);
      case 'studioRig': return this.onRig(m);
      case 'studioExtra': return this.onExtra(m);
      case 'studioView': return this.onView(m);
      case 'studioScrolls': return this.tools.setScrollsPage(m.on === true);
      case 'studioEscape': return this.tools.escape();
      case 'studioDeformers': return this.onDeformers(m);
      case 'studioWarp': return this.onWarp(m);
      case 'studioMeshPreview': return this.tools.setMeshPreview(str(m.part) && Array.isArray(m.verts) && Array.isArray(m.tris) ? { part: str(m.part)!, verts: (m.verts as unknown[]).map(Number), tris: (m.tris as unknown[]).map(Number) } : null);
      case 'studioWeights': return this.onWeights(m);
      case 'studioMasks': return this.onMasks(m);
      case 'studioMask': return this.onMask(m);
      case 'studioHidden': return this.onHidden(m);
      case 'studioFocus': return this.onFocus(m);
      case 'studioAlpha': return this.onAlpha(m);
      case 'studioExportBegin': return this.exportBegin(m);
      case 'studioExportFrame': return this.exportFrame(m);
      case 'studioExportEnd': return this.exportEnd(m);
    }
  }

  private async onShow(m: Msg): Promise<void> {
    this.pose = str(m.pose);
    const o = m.overrides && typeof m.overrides === 'object' ? Object.entries(m.overrides) : [];
    this.overrides = Object.fromEntries(o.filter((p): p is [string, string] => typeof p[1] === 'string'));
    await this.show(false);
  }

  private onPlace(m: Msg) {
    this.placing = m.on === true;
    this.place = { x: num(m.x, 0.5), y: num(m.y, 0), scale: Math.max(0.05, num(m.scale, 1)), flip: m.flip === true, anchor: Array.isArray(m.anchor) && m.anchor.length === 2 ? [num(m.anchor[0], 0.5), num(m.anchor[1], 1)] : [0.5, 1] };
    stage.style.cursor = this.placing ? 'move' : '';
    this.redraw();
  }

  private async onScene(m: Msg): Promise<void> {
    this.sceneLine = typeof m.file === 'string' && typeof m.line === 'number' ? { file: m.file, line: m.line } : null;
    await this.loadScene();
    this.redraw();
  }

  private onAnims(m: Msg) {
    if (m.anims && typeof m.anims === 'object') this.anims = m.anims as Record<string, AnimDef>;
    this.pushAuto();
    if (!this.run) this.render();
  }

  private onAuto(m: Msg) {
    this.reactions = Array.isArray(m.reactions) ? m.reactions as ReactionDef[] : [];
    this.poses = m.poses && typeof m.poses === 'object' ? m.poses as Record<string, Record<string, number>> : {};
    this.vars = m.vars && typeof m.vars === 'object' ? m.vars as Record<string, Value> : {};
    this.pushAuto();
    if (!this.run) this.render();
  }

  /** Hand the renderer the working copy of what runs by itself (see StudioPixiRenderer.studioAuto). */
  private pushAuto() { this.renderer.studioAuto(this.char, this.anims, this.reactions, this.poses, this.vars); }

  private onSeek(m: Msg) {
    const name = str(m.name);
    this.run = null;
    this.showFocus();
    if (name) this.poseAt(name, num(m.t, 0), str(m.part));
  }

  private onPlay(m: Msg) {
    const name = str(m.name);
    if (!name) return;
    this.physicsAt = performance.now();
    this.run = { name, dur: Math.max(0.05, num(m.dur, 1)), loop: m.loop === true, part: str(m.part), start: performance.now() };
    cancelAnimationFrame(this.tickId); // a Play over a Play, or right after a Pause, must not leave two frame chains
    this.tickId = requestAnimationFrame(this.tick);
    this.showFocus();
  }

  private onPivots(m: Msg) {
    const o = m.pivots && typeof m.pivots === 'object' ? Object.entries(m.pivots) : [];
    this.pivots = Object.fromEntries(o.filter((p): p is [string, [number, number]] => Array.isArray(p[1]) && p[1].length === 2 && p[1].every(Number.isFinite)));
    const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, d]) => d && typeof d === 'object' && !Array.isArray(d))) : {});
    this.bones = rec(m.bones) as Record<string, BoneDef>;
    this.partBones = rec(m.parts);
    this.size = { width: num(m.width, 0), height: num(m.height, 0) };
    this.renderer.studioPivots(this.char, this.pivots, this.bones, this.partBones);
    this.showPick();
  }

  private onMarks(m: Msg) {
    const was = this.marks;
    this.marks = m.on === true;
    if (this.marks !== was) this.tools.fitFor(this.marks); // Model fits the character, Animate the stage
    this.run = null;
    this.showFocus();
    this.showPick();
    this.redraw();
  }

  private onPick(m: Msg) {
    this.pick = str(m.part);
    this.run = null;
    this.showFocus();
    this.showPick();
    this.redraw();
  }

  private onParams(m: Msg) {
    const v = m.values && typeof m.values === 'object' ? Object.entries(m.values) : [];
    this.panel = { values: Object.fromEntries(v.filter((p): p is [string, number] => typeof p[1] === 'number' && Number.isFinite(p[1]))), hold: Array.isArray(m.hold) ? m.hold.filter((x): x is string => typeof x === 'string') : [] };
    if (!this.run) this.render();
  }

  private onPhysics(m: Msg) {
    const chains = m.chains && typeof m.chains === 'object' && !Array.isArray(m.chains) ? m.chains as never : {};
    this.chains = chains;
    this.renderer.studioPhysics(this.char, chains);
    this.hasChains = Object.keys(chains).length > 0;
    const d = m.drive as Partial<Drive> | null;
    const was = this.drive;
    this.drive = d && typeof d === 'object' && (typeof d.param === 'string' || typeof d.bone === 'string') ? { param: d.param, bone: d.bone, channel: (d.channel ?? 'rot') as Drive['channel'], amp: num(d.amp, 1), hz: Math.max(0.1, num(d.hz, 1)) } : null;
    if (this.drive) { if (!was) this.driveStart = performance.now(); this.physicsAt = performance.now(); this.swing(); }
    else if (was) this.settleUntil = performance.now() + 2500;
    if (!this.drive && !was && !this.run) this.render();
  }

  private onPause(m: Msg) {
    this.run = null;
    this.showFocus();
  }

  private onGizmo(m: Msg) {
    const tool = m.tool === 'move' || m.tool === 'rotate' || m.tool === 'scale' ? m.tool : null;
    const stage = m.stage === 'move' || m.stage === 'rotate' || m.stage === 'scale' || m.stage === 'pivot' || m.stage === 'warp' || m.stage === 'weights' || m.stage === 'mask' ? m.stage : null;
    this.tools.configure({ tool, name: str(m.name), space: m.space === 'world' ? 'world' : 'local', mode: stage ? stageMode(stage) : null, lock: m.lock === true });
  }

  private onRig(m: Msg) {
    this.renderer.studioRig(this.char, Array.isArray(m.parameters) ? m.parameters.filter((d): d is ParamDef => !!d && typeof d === 'object') : [], Array.isArray(m.keyforms) ? m.keyforms.filter((d): d is KeyformDef => !!d && typeof d === 'object') : []);
    if (!this.run) this.render();
  }

  private onExtra(m: Msg) {
    const e = m.extra && typeof m.extra === 'object' ? Object.entries(m.extra as Record<string, Offset>) : [];
    this.tools.setExtra(Object.fromEntries(e.filter(([, o]) => o && typeof o === 'object')));
  }

  private onView(m: Msg) {
    this.tools.fit(m.whole === true);
  }

  private onDeformers(m: Msg) {
    this.renderer.studioDeformers(this.char, Array.isArray(m.deformers) ? m.deformers.filter((d): d is DeformerDef => !!d && typeof d === 'object') : []);
    if (!this.run) this.render();
  }

  private onWarp(m: Msg) {
    const id = str(m.id);
    const points = Array.isArray(m.points) ? m.points.filter((p): p is number => Number.isInteger(p)) : [];
    const radius = typeof m.radius === 'number' && m.radius > 0 ? m.radius : 0, curve = m.curve === 'linear' || m.curve === 'constant' ? m.curve : 'smooth';
    const topo = typeof m.topo === 'string' ? m.topo : null, anchor = typeof m.anchor === 'number' && Number.isInteger(m.anchor) ? m.anchor : null;
    this.tools.setWarp(id ? { id, points, falloff: { radius, curve }, topo, anchor } : null);
  }

  private onWeights(m: Msg) {
    const id = str(m.id);
    const heat = Array.isArray(m.heat) ? m.heat.map(x => (typeof x === 'number' ? x : 0)) : [];
    const children = Array.isArray(m.children) ? m.children.filter((c): c is string => typeof c === 'string') : [];
    const tip: [number, number] | null = Array.isArray(m.tip) && m.tip.length === 2 && m.tip.every(x => typeof x === 'number') ? [m.tip[0], m.tip[1]] : null;
    this.tools.setWeights(id ? { id, bone: str(m.bone) || null, heat, children, tip, picked: typeof m.picked === 'number' && Number.isInteger(m.picked) ? m.picked : null, brush: typeof m.brush === 'number' && m.brush > 0 ? m.brush : 0, selected: Array.isArray(m.selected) ? m.selected.filter((v): v is number => Number.isInteger(v)) : [], mode: m.mode === 'select' || m.mode === 'add' || m.mode === 'subtract' || m.mode === 'replace' || m.mode === 'smooth' ? m.mode : 'pick' } : null);
  }

  private onMasks(m: Msg) {
    const shapes: Record<string, ShapeDef> = {}, clips: Record<string, string> = {};
    if (m.shapes && typeof m.shapes === 'object') for (const [k, v] of Object.entries(m.shapes as Record<string, ShapeDef>)) if (v && typeof v === 'object' && Array.isArray(v.polygon)) shapes[k] = v;
    if (m.clips && typeof m.clips === 'object') for (const [k, v] of Object.entries(m.clips as Record<string, unknown>)) if (typeof v === 'string') clips[k] = v;
    this.renderer.studioMasks(this.char, shapes, clips);
    if (!this.run) this.render();
  }

  private onMask(m: Msg) {
    const shape = str(m.shape), part = str(m.part);
    this.tools.setMask(shape || part || m.tool === true ? { shape, part, tool: m.tool === true, point: typeof m.point === 'number' && Number.isInteger(m.point) ? m.point : null } : null);
  }

  private onHidden(m: Msg) {
    this.hiddenParts = Array.isArray(m.parts) ? m.parts.filter((x): x is string => typeof x === 'string') : [];
    if (!this.exp) this.renderer.studioHidden(this.char, this.hiddenParts);
  }

  /** The editor asks for the alpha channel of a part's image (the mesh generator's input): answered with the pixels, or `w` 0 when they cannot be read. */
  private onAlpha(m: Msg) {
    const part = str(m.part), a = part ? this.renderer.studioPartAlpha(this.char, part) : null;
    this.reply({ type: 'studioAlphaData', id: m.id, part, w: a?.w ?? 0, h: a?.h ?? 0, alpha: a?.alpha ?? null }, a ? [a.alpha.buffer] : []);
  }

  /** The chosen part stands out by dimming the rest, but not while an animation plays: it is judged whole (ES-13). */
  private showFocus() {
    if (!this.exp) this.renderer.studioFocus(this.char, this.run ? null : this.focusPart, this.run ? [] : this.focusExtra);
  }

  private onFocus(m: Msg) {
    this.focusPart = str(m.part);
    this.focusExtra = Array.isArray(m.extra) ? m.extra.filter((x): x is string => typeof x === 'string') : [];
    this.showFocus();
    this.tools.setChosen(this.focusPart); // the stage outlines it and says whether it is the part or its bone
  }

  // ---- movie export ----
  private reply(msg: object, transfer: Transferable[] = []) { window.parent.postMessage(msg, location.origin, transfer); }
  private async yieldNow() { await new Promise<void>(r => setTimeout(r)); } // the editor shares this thread: let it breathe during a long loop

  /** Pose frame `n` of the export: the animation at that frame's time, the chains stepped one frame on from where they were. Nothing here reads a clock. */
  private exportPose(n: number) {
    const x = this.exp!;
    this.renderer.studioPose(this.char, this.anims, x.name, frameProgress(x.plan, n), null, { values: this.panel.values, hold: [] }, null, this.hasChains ? frameStep(x.plan) : null);
  }
  /** The chains at rest, then the lead-in frames posed (unseen). */
  private exportRewind() {
    const x = this.exp!;
    this.renderer.studioPhysics(this.char, this.chains as never);
    for (let n = -x.plan.lead; n < 0; n++) this.exportPose(n);
  }

  private async exportBegin(m: Msg) {
    const id = num(m.id, 0), name = str(m.name);
    const fail = (error: string) => this.reply({ type: 'studioExportError', id, error });
    if (this.exp) return fail('Another export is still running.');
    if (this.pick || this.marks) return fail('Animations are exported from Animate mode.');
    const anim = name ? resolveAnim(name, this.anims) : null;
    if (!name || !anim) return fail(`There is no animation named "${name}".`);
    const plan = planMovie({ dur: anim.dur, fps: num(m.fps, 30), loop: m.loop === true, loops: num(m.loops, 1), leadIn: num(m.leadIn, 0) });
    const width = Math.round(num(m.width, 0)), height = Math.round(num(m.height, 0)), problem = movieProblem(plan, width, height);
    if (problem) return fail(problem);
    this.run = null;
    this.drive = null;
    this.settleUntil = 0;
    const x = this.exp = { id, name, plan, width, height, frame: fitFrame({ x: 0, y: 0, w: W, h: H }, width, height, 0), background: exportBackground(m.background), next: 0 };
    try {
      await this.show(false); // the character alone, as placed
      if (this.exp !== x) return; // cancelled meanwhile: exportEnd has answered
      this.renderer.studioFocus(this.char, null);
      this.renderer.studioHidden(this.char, []);
      if (m.framing === 'character') {
        // The box the art covers over the whole animation, so the frame holds still and nothing is cut off.
        this.exportRewind();
        let box: Box | null = null, at = performance.now();
        for (let n = 0; n < plan.frames; n++) {
          this.exportPose(n);
          box = unionBox(box, this.renderer.studioBounds(this.char));
          if (performance.now() - at > 30) {
            await this.yieldNow();
            if (this.exp !== x) return;
            at = performance.now();
          }
        }
        if (box) x.frame = fitFrame(box, width, height);
      }
      this.exportRewind();
      this.reply({ type: 'studioExportReady', id, frames: plan.frames, width, height });
    } catch (e) {
      await this.exportEnd({ id });
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  private async exportFrame(m: Msg) {
    const x = this.exp, id = num(m.id, 0), n = num(m.n, -1);
    const fail = (error: string) => this.reply({ type: 'studioExportError', id, error });
    if (!x || x.id !== id) return fail('That export is not running.');
    if (n !== x.next || n >= x.plan.frames) return fail(`Frame ${n} was asked for out of order (next is ${x.next}).`);
    try {
      this.exportPose(n);
      const canvas = this.renderer.studioCapture(x.frame, x.width, x.height, x.background);
      const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/png'));
      if (!blob) throw new Error('The browser could not encode a PNG.');
      const bytes = await blob.arrayBuffer();
      x.next = n + 1;
      this.reply({ type: 'studioExportData', id, n, bytes }, [bytes]);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  private async exportEnd(m: Msg) {
    const id = num(m.id, 0);
    if (!this.exp || this.exp.id !== id) { this.reply({ type: 'studioExportDone', id }); return; }
    this.exp = null;
    this.renderer.studioCaptureEnd();
    this.renderer.studioPhysics(this.char, this.chains as never); // the chains rest again, as Play expects
    this.renderer.studioFocus(this.char, this.focusPart, this.focusExtra);
    this.renderer.studioHidden(this.char, this.hiddenParts);
    await this.show(false);
    this.reply({ type: 'studioExportDone', id });
  }

  /** While the shake runs (and a moment after), step the chains each frame and pose again. */
  private swinging = false;
  private swing() { if (!this.swinging) { this.swinging = true; requestAnimationFrame(this.swingTick); } }
  private swingTick = (now: number) => {
    if ((!this.last && !this.marks && !this.pick) || (!this.drive && now > this.settleUntil)) { this.swinging = false; return; }
    const dt = (now - this.physicsAt) / 1000;
    this.physicsAt = now;
    if (!this.run) this.render(dt);
    requestAnimationFrame(this.swingTick);
  };
  private tick = (now: number) => {
    const r = this.run;
    if (!r) return;
    const k = (now - r.start) / 1000 / r.dur;
    const done = !r.loop && k >= 1;
    const t = done ? 1 : r.loop ? k % 1 : k;
    const dt = (now - this.physicsAt) / 1000;
    this.physicsAt = now;
    this.poseAt(r.name, t, r.part, dt);
    if (done) { this.run = null; this.showFocus(); }
    window.parent.postMessage({ type: 'studioTime', t, playing: !done }, location.origin);
    if (!done) this.tickId = requestAnimationFrame(this.tick);
  };
  private tickId = 0;
}
