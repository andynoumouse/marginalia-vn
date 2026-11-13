// The animation studio's Warp tool (Model mode): the mesh warp of the chosen part, or the group warp over several parts that it is in
// (rig.json `deformers`). It fills the Deform sub-block of Properties (the Target ▾ in its line; the members, the Mesh row, the lattice
// size; its line's verbs Add warp, Add group warp and Remove warp call `add`, `addGroup` and `removeTarget`), turns a lattice point
// dragged on the stage into a key of the active parameter's keyform (its slider is the one in Parameters), and fills the Warp panel of
// the tool options bar: Edit topology, the point selection, soft reach, mirror, smooth, scale, rotate and the shape presets
// (studio-inspector.ts `warpBar`), and the Point row in Keyforms (the chosen points' move; Keyforms itself has the warp's key strip, copy
// and paste, and Reset, editor/anim-bind.ts). The maths is in engine/src/warp-edit.ts; the stage draws the lattice and reports drags
// (preview/studio-gizmo.ts). The studio keeps the working copy; this works through `WarpHost`.

import {
  isSkinned, groupBones, addMeshEdge, addMeshVertex, deleteMeshVertex, flipMeshEdge, hasKeyforms, moveMeshVertex, removeMeshEdge, setMeshGeometry, mirrorMeshWarp, smoothMeshWarp, transformMeshPoints, addDeformer, addGroupDeformer, averageDisplacement, generateMesh, MESH_DETAIL_STEPS, MESH_MAX_VERTS, meshReplaces, meshUsable, setPartMesh, cleanSelection, combineSelection, deformerById, deformerGrid, warpKeyAt, deformerOf, deformerPoints, deformersOfPart, DEFORMER_MAX_GRID, invertSelection, mirrorWarp,
  moveWarpPoints, removeDeformerById, replaceDeformer, resizeWarp, setMembers, setWarpOwn, smoothWarp, softWeights, transformWarpPoints, warpAllPoints, warpColumn,
  warpKeyValues, warpPreset, warpRow, warpBar, WARP_CURVES, WARP_DEFAULT_FALLOFF, WARP_PRESETS,
  type DeformerDef, type DeformState, type GeneratedMesh, type MeshEditResult, type MeshGeo, type MeshDetail, type ParamDef, type PartBox, type WarpCurve, type WarpFalloff, type WarpPreset,
} from '../engine/src/index.js';
import { el, layoutRows } from './anim-dom.js';
import { confirmAsk } from './ask.js';
import { iconButton, type IconName } from './studio-icons.js';
import { Popover } from './studio-popover.js';

/** A drag in progress: `put` shows the deformers it makes, `end` makes it one undo step. */
export interface WarpDrag { put(deformers: DeformerDef[]): void; end(): void }

export interface WarpHost {
  /** The chosen row of the tree. */
  part(): string | null;
  /** Show the mesh Generate would make on the stage (vertices in the part's image pixels), or nothing (SD-14). */
  previewMesh(p: { part: string; verts: number[]; tris: number[] } | null): void;
  /** The warp is keyed to the parameter active in the Parameters section (null while none or a pad is). */
  activeParam(): string | null;
  /** Is the name a part (a bone has no image to warp)? */
  isPart(name: string): boolean;
  /** Is the name a bone? */
  isBone(name: string): boolean;
  /** The bones that move this skinned mesh and are posed by the parameters now (none for a lattice or a mesh at rest): see posedInfluences. */
  posedInfluences(def: DeformerDef): string[];
  /** Is the name a mask shape (an imageless part: it has no warp of its own, but a group warp may bend it)? */
  isShape(name: string): boolean;
  /** The mask shapes of the character. */
  shapes(): string[];
  /** The parts and shapes ticked in the tree (the chosen one and the extra ones), in tree order. */
  selectedParts(): string[];
  /** A Ctrl-click set of parts (the chosen one first), null for none: Deform shows the group warp they all share, or adds one over them. */
  setParts(): string[] | null;
  /** Clipped parts that a group warp bends while their shape is not bent with them (engine mask-edit.ts clipGroupIssues). */
  clipIssues(): { part: string; shape: string; group: string }[];
  /** Add a shape to the members of a group warp, as one undo step. */
  fixClip(issue: { part: string; shape: string; group: string }): void;
  /** The parts and shapes on a bone and the bones below it. */
  bonePartsOf(bone: string): string[];
  /** The bone a part or a mask shape sits on. */
  boneOf(part: string): string | undefined;
  /** Every part of the character. */
  parts(): string[];
  deformers(): DeformerDef[];
  params(): ParamDef[];
  /** The parameter values the stage shows now. */
  values(): Record<string, number>;
  /** Move a parameter's slider (the one in the Parameters section). */
  setValue(id: string, value: number): void;
  /** Replace the deformers as one undo step. */
  set(next: DeformerDef[]): void;
  /** Begin a drag. */
  drag(): WarpDrag;
  /** The Warp tool was asked for (Add warp turns it on), or its lattice should show another point. */
  useTool(): void;
  selected(): void;
  /** The alpha channel of the part's image from the stage (one byte per pixel, `w` x `h`), null when the stage cannot give it. */
  partAlpha(part: string): Promise<{ w: number; h: number; alpha: Uint8Array } | null>;
  note(text: string): void;
}

/** The tools of the Topology mode of a free mesh. */
export type TopoTool = 'add' | 'delete' | 'move' | 'flip' | 'addEdge' | 'removeEdge';
const TOPO_TOOLS: { id: TopoTool; icon: IconName; label: string; hint: string }[] = [
  { id: 'add', icon: 'vertex-add', label: 'Add vertex', hint: 'Click inside the mesh to add a vertex; near an edge it splits the edge.' },
  { id: 'delete', icon: 'vertex-delete', label: 'Delete vertex', hint: 'Click a vertex to delete it; the hole it leaves is filled with new triangles.' },
  { id: 'move', icon: 'vertex-move', label: 'Move vertex', hint: 'Drag a vertex to move its rest position (where the art sits before any keyform bends it).' },
  { id: 'flip', icon: 'edge-flip', label: 'Flip edge', hint: 'Click an edge between two triangles to swap it for the other diagonal of their quad.' },
  { id: 'addEdge', icon: 'edge-add', label: 'Add edge', hint: 'Click two vertices that share a neighbour: the edge between them closes a new triangle across the outline.' },
  { id: 'removeEdge', icon: 'edge-remove', label: 'Remove edge', hint: 'Click an edge on the outline to remove its triangle.' },
];
const meshGeo = (d: DeformerDef): MeshGeo => ({ verts: d.mesh!.verts, tris: d.mesh!.tris });
const TOPO_OFF = 'Edit topology: add, delete and move vertices and edges (the tools take the bar\'s place while it is on). This changes what the keyforms mean, so it drops them (after asking)';

const shown = (v: number) => String(Math.round(v * 100000) / 100000);

export class WarpPanel {
  /** The lattice points chosen on the stage or here (ascending): what Reset, Mirror, Smooth, Scale, Rotate and a drag act on. */
  selection: number[] = [];
  private soft = false;
  private falloff: WarpFalloff = { ...WARP_DEFAULT_FALLOFF };
  private param: string | null = null;
  /** The detail step the Mesh row generates at. */
  private detail: MeshDetail = 'medium';
  /** The alpha of each part's image once the stage has given it; parts it could not read are in `noAlpha`, parts already asked in `askedAlpha`. */
  private alphas = new Map<string, { w: number; h: number; alpha: Uint8Array }>();
  private noAlpha = new Set<string>();
  private askedAlpha = new Set<string>();
  /** The mesh the Mesh row would make now (for the vertex count), with what it was made from. */
  private gen: { key: string; mesh: GeneratedMesh } | null = null;
  /** The mesh's Topology mode is on, with this tool; `anchor` is the first vertex of an Add edge. Keyform editing is off meanwhile. */
  private topo = false;
  private topoPick: TopoTool = 'add';
  private anchor: number | null = null;
  private busy = false;
  private restDrag: { base: DeformerDef; box: PartBox; pixels: [number, number]; last: MeshGeo | null; drag: WarpDrag } | null = null;
  private lastPart: string | null = null;
  private lastKey = '';
  private boxes = new Map<string, PartBox>();
  /** A free mesh's part image size in pixels (the unit of its vertices), by deformer id. */
  private pixels = new Map<string, [number, number]>();
  /** The deformer the panel edits when the chosen row has more than one (its own warp or a group's); null: the default. */
  private choice: string | null = null;
  private dragging: { base: DeformerDef; param: ParamDef; value: number; weights: Map<number, number>; drag: WarpDrag } | null = null;
  private q: <T extends Element>(s: string) => T;
  /** The bar's ▾ panels: soft reach, mirror, scale and rotate values, presets. */
  private pops: Popover[];

  /**
   * `root` is the Deform sub-block's body (members, mesh, lattice), `pick` the place in its line where the Target ▾ stands, `bar` the
   * Warp panel of the tool options bar (Edit topology, the selection, the operations, the presets; the topology tools while Edit
   * topology is on), `points` the place in Keyforms for the Point row (the chosen points' move in the keyform at the slider's value;
   * Keyforms has the key strip and the Reset that takes them back to rest).
   */
  constructor(private root: HTMLElement, pick: HTMLElement, private bar: HTMLElement, private points: HTMLElement, private host: WarpHost) {
    pick.insertAdjacentHTML('beforeend', '<label class="as-lone aw-target"><select class="aw-targetpick" aria-label="Which warp to edit" title="Which warp Deform, the bar and the stage edit: the part\'s own, or the group warp it is in"></select></label>');
    this.root.innerHTML = `
      <p class="as-pivot-hint aw-none"></p>
      <p class="as-pivot-hint aw-targethint"></p>
      <div class="aw-members"><span class="as-pivot-name">Members</span>
        <span class="aw-memberlist" role="group" aria-label="Parts of the group warp"></span>
        <label class="as-lone"><select class="aw-addmember" aria-label="Add a part or shape to the group warp"></select></label>
        <button type="button" class="aw-usesel" title="Make the parts ticked in the tree the members">Use selected parts</button>
        <span class="as-pivot-hint aw-memberhint" hidden></span></div>
      <div class="aw-clipissues"></div>
      <div class="aw-meshgen"><span class="as-pivot-name">Mesh</span>
        <label>Detail <select class="aw-detail" aria-label="How finely the mesh follows the art"></select></label>
        <label title="How far the mesh reaches past the opaque pixels, in image pixels (at least 2). The mesh stays inside the image, so a margin wider than the space around the art changes nothing.">margin <input type="number" class="aw-margin" min="2" step="1" placeholder="auto" aria-label="How far the mesh reaches past the opaque pixels, in image pixels, at least 2; it stays inside the image"></label>
        <span class="aw-vcount" role="status"></span>
        <button type="button" class="aw-genbtn"></button>
        <span class="as-pivot-hint aw-genhint"></span></div>
      <div class="aw-grid"><span class="as-pivot-name aw-gridname">Lattice</span>
        <span class="aw-dims as-cells"><label>columns <input type="number" class="aw-cols" min="1" max="${DEFORMER_MAX_GRID}" step="1"></label>
        <label>rows <input type="number" class="aw-rows" min="1" max="${DEFORMER_MAX_GRID}" step="1"></label></span>
        <span class="aw-meshsum"></span></div>
`;
    layoutRows(this.root);
    this.points.innerHTML = `
      <div class="aw-pt"><span class="as-pivot-name">Point</span>
        <label class="as-lone"><select class="aw-pick" aria-label="Lattice point"></select></label>
        <label>dx <input type="number" class="aw-dx" step="0.005" aria-label="Sideways move of the point in this keyform"></label>
        <label>dy <input type="number" class="aw-dy" step="0.005" aria-label="Vertical move of the point in this keyform"></label>
        <span class="as-pivot-hint aw-pthint"></span></div>`;
    layoutRows(this.points);
    const btn = (ic: IconName, label: string, cls: string, title: string, pressed?: boolean) => iconButton({ icon: ic, label, className: cls, title, pressed });
    this.bar.innerHTML = `
      <span class="atb-grp aw-topogrp">${btn('topology', 'Edit topology', 'aw-topoon', TOPO_OFF, false)}</span>
      <span class="atb-grp aw-sel" role="group" aria-label="Lattice points chosen">
        ${btn('select-all', 'Choose all points', 'aw-all', 'All: choose every point (Ctrl+A on the stage)')}
        ${btn('select-none', 'Choose none', 'aw-clear', 'None: choose no point (Esc on the stage)')}
        ${btn('invert', 'Invert the choice', 'aw-invert', 'Invert: choose the points that are not chosen')}
        <select class="aw-rowpick" aria-label="Choose a row of points" title="Choose a row of points"></select>
        <select class="aw-colpick" aria-label="Choose a column of points" title="Choose a column of points"></select>
        <span class="aw-selhint" role="status"></span>
        ${btn('soft', 'Soft selection', 'aw-soft', 'Soft: a drag of the chosen points also pulls the points near them, less the farther they are', false)}
        <span class="atb-pop">${btn('value', 'Soft reach…', 'aw-softopts', 'Reach and fall-off of the soft selection')}
          <span class="atb-panel aw-softpanel" role="group" aria-label="Soft selection">
            <label>reach <input type="number" class="aw-radius" min="0.5" max="${DEFORMER_MAX_GRID}" step="0.5" aria-label="How many lattice cells a soft selection reaches"></label>
            <label>fall-off <select class="aw-curve" aria-label="How a soft selection fades"></select></label></span></span></span>
      <span class="atb-grp aw-tools" role="group" aria-label="Operations on the keyform">
        <span class="atb-pop">${btn('mirror', 'Mirror…', 'aw-mirrorbtn', 'Mirror…: copy one half of this keyform onto the other, or the chosen points onto their partners')}
          <span class="atb-panel aw-mirrorpanel" role="group" aria-label="Mirror the keyform">
            <button type="button" class="aw-mirror-lr" title="Copy the left half of this keyform to the right, mirrored">Left to right</button>
            <button type="button" class="aw-mirror-rl" title="Copy the right half of this keyform to the left, mirrored">Right to left</button>
            <button type="button" class="aw-mirror-sel" title="Copy the chosen points across the middle of the lattice onto their partners">Chosen points</button></span></span>
        ${btn('smooth', 'Smooth', 'aw-smooth', 'Smooth: even out the points of this keyform (the chosen ones, if any); press again for more')}
        ${btn('scale', 'Scale the chosen points', 'aw-scale-go', 'Scale the chosen points by the factor set under ▾')}
        ${btn('rotate', 'Rotate the chosen points', 'aw-rot-go', 'Rotate the chosen points by the angle set under ▾')}
        <span class="atb-pop">${btn('value', 'Scale and rotate values…', 'aw-xfbtn', 'The factor and the angle that Scale and Rotate apply, and what they turn about')}
          <span class="atb-panel aw-xf" role="group" aria-label="Scale and rotate">
            <label>scale <input type="number" class="aw-scale" min="0.1" max="10" step="0.05" value="1.1" aria-label="Scale factor"></label>
            <label>turn <input type="number" class="aw-rot" min="-360" max="360" step="5" value="10" aria-label="Rotation in degrees, clockwise"></label>
            <select class="aw-about" aria-label="Scale and rotate about"><option value="selection">about the selection</option><option value="lattice">about the lattice centre</option></select></span></span>
        <span class="atb-pop">${btn('preset', 'Presets…', 'aw-presetbtn', 'Presets…: write a ready-made shape as the keys of the active parameter')}
          <span class="atb-panel aw-presets" role="group" aria-label="Preset shapes">
            <label>Shape <select class="aw-preset" aria-label="Shape"></select></label>
            <label>amount <input type="number" class="aw-amount" min="0" step="0.01"></label>
            <button type="button" class="aw-write" title="Write the shape as the keys of the chosen parameter, replacing the ones it has">Write keys</button>
            <span class="as-pivot-hint aw-presethint"></span></span></span></span>
      <span class="atb-grp aw-topotools" role="group" aria-label="Topology tool"></span>`;
    this.pops = [['.aw-softopts', '.aw-softpanel'], ['.aw-mirrorbtn', '.aw-mirrorpanel'], ['.aw-xfbtn', '.aw-xf'], ['.aw-presetbtn', '.aw-presets']]
      .map(([b, panel]) => new Popover(this.bar.querySelector<HTMLButtonElement>(b)!, this.bar.querySelector<HTMLElement>(panel)!));
    this.q = <T extends Element>(s: string) => (this.root.querySelector<T>(s) ?? this.bar.querySelector<T>(s) ?? this.points.querySelector<T>(s) ?? pick.querySelector<T>(s))!;
    this.q<HTMLSelectElement>('.aw-preset').append(...WARP_PRESETS.map(p => el('option', { value: p.id, textContent: p.label })));
    this.setAmount();
    this.q<HTMLSelectElement>('.aw-preset').addEventListener('change', () => { this.setAmount(); this.show(); });
    this.q<HTMLSelectElement>('.aw-detail').append(...MESH_DETAIL_STEPS.map(d => el('option', { value: d.id, textContent: d.label })));
    this.q<HTMLSelectElement>('.aw-detail').value = this.detail;
    this.q<HTMLSelectElement>('.aw-detail').addEventListener('change', e => { this.detail = (e.target as HTMLSelectElement).value as MeshDetail; this.show(); });
    this.q<HTMLInputElement>('.aw-margin').addEventListener('change', () => this.show());
    this.q<HTMLInputElement>('.aw-margin').addEventListener('input', () => this.show()); // the preview follows the typing
    // While the pointer or the focus is on the Mesh row, the stage shows the mesh Generate would make (SD-14).
    const gen = this.q<HTMLElement>('.aw-meshgen');
    const preview = (on: boolean) => { this.previewing = on; this.sendPreview(); };
    gen.addEventListener('pointerenter', () => preview(true));
    gen.addEventListener('pointerleave', () => preview(gen.contains(document.activeElement)));
    gen.addEventListener('focusin', () => preview(true));
    gen.addEventListener('focusout', e => preview(gen.contains(e.relatedTarget as Node | null) || gen.matches(':hover')));
    this.q('.aw-genbtn').addEventListener('click', () => void this.generate());
    const tools = this.q('.aw-topotools');
    tools.innerHTML = TOPO_TOOLS.map(t => iconButton({ icon: t.icon, label: t.label, title: `${t.label}: ${t.hint}`, className: 'aw-tt', data: { tool: t.id }, pressed: false })).join('');
    for (const b of tools.querySelectorAll<HTMLButtonElement>('.aw-tt')) b.addEventListener('click', () => { this.topoPick = b.dataset.tool as TopoTool; this.anchor = null; this.show(); this.host.selected(); });
    this.q('.aw-topoon').addEventListener('click', () => { this.topo = !this.topo; this.anchor = null; this.selection = []; this.show(); this.host.selected(); });
    this.q<HTMLSelectElement>('.aw-targetpick').addEventListener('change', e => { this.choice = (e.target as HTMLSelectElement).value; this.selection = []; this.show(); this.host.selected(); });
    this.q('.aw-usesel').addEventListener('click', () => this.setMembersTo(this.host.selectedParts()));
    this.q<HTMLSelectElement>('.aw-addmember').addEventListener('change', e => { const s = e.target as HTMLSelectElement, v = s.value; s.value = ''; if (v) this.setMembersTo([...(this.def()?.members ?? []), v]); });
    this.q<HTMLSelectElement>('.aw-curve').append(...WARP_CURVES.map(c => el('option', { value: c, textContent: c })));
    this.q<HTMLSelectElement>('.aw-curve').value = this.falloff.curve;
    this.q<HTMLInputElement>('.aw-radius').value = String(this.falloff.radius);
    this.q('.aw-all').addEventListener('click', () => { const d = this.def(); if (d) this.choose(warpAllPoints(d), 'set'); });
    this.q('.aw-clear').addEventListener('click', () => this.choose([], 'set'));
    this.q('.aw-invert').addEventListener('click', () => { const d = this.def(); if (d) this.choose(invertSelection(d, this.selection), 'set'); });
    this.q<HTMLSelectElement>('.aw-rowpick').addEventListener('change', e => { const s = e.target as HTMLSelectElement, d = this.def(); if (d && s.value !== '') this.choose(warpRow(d, Number(s.value)), 'set'); s.value = ''; });
    this.q<HTMLSelectElement>('.aw-colpick').addEventListener('change', e => { const s = e.target as HTMLSelectElement, d = this.def(); if (d && s.value !== '') this.choose(warpColumn(d, Number(s.value)), 'set'); s.value = ''; });
    this.q('.aw-soft').addEventListener('click', () => { this.soft = !this.soft; this.show(); this.host.selected(); });
    this.q<HTMLInputElement>('.aw-radius').addEventListener('change', e => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v) && v > 0) this.falloff.radius = v; this.show(); this.host.selected(); });
    this.q<HTMLSelectElement>('.aw-curve').addEventListener('change', e => { this.falloff.curve = (e.target as HTMLSelectElement).value as WarpCurve; this.host.selected(); });
    this.q('.aw-scale-go').addEventListener('click', () => this.transform('scale'));
    this.q('.aw-rot-go').addEventListener('click', () => this.transform('rotate'));
    for (const cls of ['.aw-cols', '.aw-rows']) this.q<HTMLInputElement>(cls).addEventListener('change', () => this.resize());
    this.q<HTMLSelectElement>('.aw-pick').addEventListener('change', e => { const v = (e.target as HTMLSelectElement).value; this.selection = v === '' ? [] : [Number(v)]; for (const cls of ['.aw-dx', '.aw-dy']) this.q<HTMLInputElement>(cls).blur(); this.show(); this.host.selected(); });
    for (const cls of ['.aw-dx', '.aw-dy']) this.q<HTMLInputElement>(cls).addEventListener('change', () => this.typed());
    this.q('.aw-mirror-lr').addEventListener('click', () => this.mirror('left'));
    this.q('.aw-mirror-rl').addEventListener('click', () => this.mirror('right'));
    this.q('.aw-mirror-sel').addEventListener('click', () => this.mirror('left', this.selection));
    this.q('.aw-smooth').addEventListener('click', () => this.change(def => (def.mesh ? smoothMeshWarp : smoothWarp)(def, this.active()!, this.value(), 0.5, this.selection.length ? this.selection : undefined), 'Nothing to smooth: the points are even.',
      `Smoothed ${this.selection.length ? 'the chosen points' : 'the points'} of this keyform; press again for more. Ctrl+Z undoes it.`)); // MD-10: it said nothing
    this.q('.aw-write').addEventListener('click', () => this.write());
  }

  /** A new opening of the studio. */
  reset() {
    this.selection = [];
    this.param = null;
    this.lastPart = null;
    this.choice = null;
    this.dragging = null;
    this.boxes.clear();
    this.topo = false;
    this.anchor = null;
    this.restDrag = null;
    this.pixels.clear();
    this.alphas.clear();
    this.noAlpha.clear();
    this.askedAlpha.clear();
    this.gen = null;
  }

  // ---- what is chosen ----
  /** The chosen part, if it is one and not the first of a Ctrl-click set (a set edits only the group warp its parts share). */
  private part(): string | null { const p = this.host.part(); return p !== null && this.host.isPart(p) && !this.host.setParts() ? p : null; }
  /** The chosen row, if it is a mask shape. */
  private shape(): string | null { const p = this.host.part(); return p !== null && this.host.isShape(p) ? p : null; }
  /** The chosen row's bone, if it is one. */
  private bone(): string | null { const p = this.host.part(); return p !== null && this.host.isBone(p) ? p : null; }
  /** The warps the chosen row can edit: a part's own and the group it is in; a bone's are the groups that cover every part on it. */
  private candidates(): DeformerDef[] {
    const ds = this.host.deformers(), part = this.part(), bone = this.bone(), shape = this.shape(), set = this.host.setParts();
    if (set) return ds.filter(d => Array.isArray(d.members) && set.every(p => d.members!.includes(p))); // the group they all share
    if (part) return deformersOfPart(ds, part);
    if (shape) return ds.filter(d => Array.isArray(d.members) && d.members.includes(shape)); // a shape has no warp of its own
    if (!bone) return [];
    const on = this.host.bonePartsOf(bone);
    return on.length ? ds.filter(d => Array.isArray(d.members) && on.every(p => d.members!.includes(p))) : [];
  }
  /** The id of the warp being edited: the choice when it still applies, else the part's own warp, else its group. */
  target(): string | null { const c = this.candidates(); return (c.find(d => d.id === this.choice) ?? c[0])?.id ?? null; }
  private def(): DeformerDef | undefined { const id = this.target(); return id ? deformerById(this.host.deformers(), id) : undefined; }
  private active(): ParamDef | null { return this.host.params().find(p => p.id === this.param) ?? null; }
  private value(): number { const p = this.active(); return p ? (this.host.values()[p.id] ?? p.default) : 0; }

  /** The stage knows the size of a part's image once its art has loaded. */
  box(id: string, w: number, h: number, pw?: number, ph?: number) {
    this.boxes.set(id, { w, h });
    if (pw && ph) this.pixels.set(id, [pw, ph]);
  }

  /** What Deform's line says (studio-inspector.ts `propBlocks`): the warp edited, what else the row could edit, and what it could add; undefined for no part, bone or shape. */
  deformState(): DeformState | undefined {
    const part = this.part(), bone = this.bone(), shape = this.shape();
    if (!part && !bone && !shape && !this.host.setParts()) return undefined;
    const def = this.def(), seed = this.groupSeed(), members = def?.members;
    const kind = !def ? 'none' : Array.isArray(members) ? 'group' : def.mesh ? 'mesh' : 'lattice';
    const shapes = (members ?? []).filter(m => this.host.isShape(m)).length;
    return {
      kind,
      ...(def && !def.mesh ? { grid: deformerGrid(def) } : {}),
      ...(def?.mesh ? { vertices: deformerPoints(def) } : {}),
      ...(def && Array.isArray(members) ? { group: { id: def.id, parts: members.length - shapes, shapes } } : {}),
      candidates: this.candidates().length,
      own: !!part && !!deformerOf(this.host.deformers(), part),
      seed: !seed ? null : bone ? { bone } : { parts: seed.members.length },
      params: this.host.params().length > 0,
    };
  }
  /** Deform's Remove warp (or Remove group warp): the warp edited goes, as one undo step. */
  removeTarget() {
    const d = this.def();
    if (!d) return;
    this.selection = [];
    this.choice = null;
    this.host.set(removeDeformerById(this.host.deformers(), d.id));
  }

  /** The clip-group issues of the chosen row and of the group edited, each with its fix: shown once, here (Clip's line has a ⚠). */
  private showIssues(def: DeformerDef | undefined) {
    const chosen = this.host.part(), box = this.root.querySelector<HTMLElement>('.aw-clipissues')!;
    const issues = this.host.clipIssues().filter(i => i.part === chosen || i.shape === chosen || i.group === def?.id);
    box.replaceChildren(...issues.map(i => {
      const b = el('button', { type: 'button', className: 'aw-fixclip', textContent: `Add ${i.shape} to ${i.group}`, title: `${i.part} is bent by ${i.group} but the shape that clips it is not: the art would move and its clip stay` });
      b.addEventListener('click', () => this.host.fixClip(i));
      return el('p', { className: 'as-pivot-hint aw-clipissue' }, `⚠ ${i.part} is clipped to ${i.shape}, which is not in ${i.group === def?.id ? 'this group' : `the group warp ${i.group}`}. `, b);
    }));
    box.hidden = !issues.length;
  }

  /**
   * The members of a group warp, a ticked checkbox each (untick to take it out), then Add ▾ listing the rest (one chosen joins; it leaves any
   * other group). Only the members are listed, so the row stays short on a character with many parts.
   */
  private showMembers(def: DeformerDef) {
    const list = this.root.querySelector<HTMLElement>('.aw-memberlist')!, members = def.members ?? [], parts = this.host.parts(), shapes = this.host.shapes();
    const sig = `${def.id}|${members.join(',')}|${parts.join(',')}|${shapes.join(',')}`;
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      const add = this.root.querySelector<HTMLSelectElement>('.aw-addmember')!, rest = (names: string[]) => names.filter(n => !members.includes(n));
      const group = (label: string, names: string[]) => { const g = document.createElement('optgroup'); g.label = label; g.append(...names.map(n => el('option', { value: n, textContent: n }))); return g; };
      add.replaceChildren(el('option', { value: '', textContent: 'Add…' }), ...(rest(parts).length ? [group('Parts', rest(parts))] : []), ...(rest(shapes).length ? [group('Shapes', rest(shapes))] : []));
      add.disabled = !rest([...parts, ...shapes]).length;
      add.title = add.disabled ? 'Every part and shape is a member already' : 'Add a part or a mask shape to this group (one in another group moves here)';
      list.replaceChildren(...[...parts, ...shapes].filter(p => members.includes(p)).map(p => {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'aw-member';
        box.value = p;
        box.checked = members.includes(p);
        box.addEventListener('change', () => {
          const cur = this.def()?.members ?? [];
          this.setMembersTo(box.checked ? [...cur, p] : cur.filter(m => m !== p));
        });
        return el('label', { className: 'aw-memberrow', title: shapes.includes(p) ? `${p} is a mask shape` : '' }, box, shapes.includes(p) ? ` ${p} (shape)` : ` ${p}`);
      }));
    }
    const sel = this.host.selectedParts();
    this.root.querySelector<HTMLButtonElement>('.aw-usesel')!.disabled = !sel.length;
    const hint = `${members.length} member${members.length === 1 ? '' : 's'}; the first (${members[0]}) is the one a drag is measured in. Untick one to take it out; Add… joins another (a part or shape is in one group at most, so one in another group moves here).`;
    this.root.querySelector<HTMLElement>('.aw-memberhint')!.textContent = hint;
    this.root.querySelector<HTMLElement>('.aw-members')!.title = hint; // the hint is the row's tooltip
  }

  // ---- the free mesh ----
  private previewing = false;
  private previewSent = '';
  /** The mesh preview to the stage: the generated mesh of the chosen part while the Mesh row is pointed at or focused, else none. */
  private sendPreview() {
    const part = this.previewing ? this.part() : null, mesh = part ? this.generated(part) : null;
    const key = part && mesh ? `${part}|${this.gen?.key}` : '';
    if (key === this.previewSent) return;
    this.previewSent = key;
    this.host.previewMesh(part && mesh ? { part, verts: mesh.verts, tris: mesh.tris } : null);
  }
  /** The margin typed (pixels), undefined for the generator's own. */
  private margin(): number | undefined {
    const v = this.q<HTMLInputElement>('.aw-margin').value.trim();
    return v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
  }
  /** The mesh `part`'s image makes at the chosen detail and margin; null until the stage has given the alpha. Kept while the inputs stay. */
  private generated(part: string): GeneratedMesh | null {
    const a = this.alphas.get(part);
    if (!a) return null;
    const margin = this.margin(), key = `${part}|${this.detail}|${margin ?? ''}`;
    if (this.gen?.key !== key) this.gen = { key, mesh: generateMesh(a.alpha, a.w, a.h, { detail: this.detail, margin }) };
    return this.gen.mesh;
  }
  /** Asks the stage for `part`'s alpha once (again when `again`); redraws when it arrives. */
  private async fetchAlpha(part: string, again = false): Promise<boolean> {
    if (this.alphas.has(part)) return true;
    if (!again && this.askedAlpha.has(part)) return false;
    this.askedAlpha.add(part);
    this.noAlpha.delete(part);
    // The stage may not have drawn the part yet (it opens at the same time): ask again for a few seconds.
    for (let i = 0; i < 12 && !this.alphas.has(part); i++) {
      const a = await this.host.partAlpha(part);
      if (a && a.w >= 1 && a.h >= 1 && a.alpha.length >= a.w * a.h) this.alphas.set(part, a);
      else await new Promise(r => setTimeout(r, 400));
    }
    if (!this.alphas.has(part)) this.noAlpha.add(part);
    this.show();
    return this.alphas.has(part);
  }
  /** Generate (or Regenerate) the part's free mesh: a lattice is replaced, and a mesh's keyforms dropped, after asking; one undo step. */
  private async generate() {
    const part = this.part();
    if (!part) return;
    if (!(await this.fetchAlpha(part, true))) { this.host.note(`The stage could not read the image of ${part}.`); return; }
    const mesh = this.generated(part), detail = this.detail;
    if (!mesh || !meshUsable(mesh)) { this.host.note(`${part} has no opaque pixels to make a mesh of.`); return; }
    const was = meshReplaces(this.host.deformers(), part);
    if (was === 'lattice' && !(await confirmAsk(`${part} has a lattice warp. A part has one warp, so the mesh replaces it and the lattice's keyforms are dropped.`, 'Replace with mesh'))) return;
    if (was === 'keyforms' && !(await confirmAsk(`Regenerating the mesh of ${part} changes its vertices, so the per-vertex keyforms are dropped.`, 'Regenerate'))) return;
    const next = setPartMesh(this.host.deformers(), part, mesh, detail);
    this.selection = [];
    this.choice = deformerOf(next, part)?.id ?? null;
    this.host.set(next);
    this.host.useTool();
  }

  // ---- changes ----
  /** Deform's Add warp: a lattice over the chosen part, and the Warp tool on to shape it. */
  add() {
    const part = this.part();
    if (!part || deformerOf(this.host.deformers(), part)) return;
    this.selection = [];
    const next = addDeformer(this.host.deformers(), part);
    this.choice = deformerOf(next, part)?.id ?? null;
    this.host.set(next);
    this.host.useTool();
  }
  /** What "Add group warp" would cover: the parts on the chosen bone, else the parts ticked in the tree (two or more). */
  private groupSeed(): { members: string[]; name: string } | null {
    const bone = this.bone();
    if (bone) { const on = this.host.bonePartsOf(bone); return on.length ? { members: on, name: bone } : null; }
    // The chosen part first: it names the group and is the member a drag is measured in, not whichever comes first in draw order (MD-9).
    const members = this.host.setParts() ?? this.host.selectedParts(); // the Ctrl-click set lists the chosen part first
    return members.length > 1 ? { members: [...members], name: members[0] } : null;
  }
  /** Deform's Add group warp: one lattice over the parts on the chosen bone, or over the parts ticked in the tree. */
  addGroup() {
    const seed = this.groupSeed();
    if (!seed) return;
    const next = addGroupDeformer(this.host.deformers(), seed.members, undefined, seed.name);
    this.selection = [];
    this.choice = next.at(-1)!.id;
    this.host.set(next);
    this.host.useTool();
    // Say at once what the rig check would say later: members on bones that turn apart skew the group's lattice.
    const bone = this.bone(), on = groupBones(seed.members, m => this.host.boneOf(m), m => { const d = deformerOf(next, m); return !!d?.mesh && isSkinned(d.mesh); });
    const apart = on.length > 1 ? ` They sit on different bones (${on.map(b => b || 'none').join(', ')}): when one turns relative to another the warp skews, and the rig check warns about it.${bone ? ` Untick the parts below ${bone} in Members to keep the group on ${bone} alone.` : ''}` : '';
    this.host.note(`Made group warp ${this.choice} over ${seed.members.length} members.${apart}`);
  }
  /** Replace the members of the chosen group warp (parts in another group move here). */
  private setMembersTo(members: string[]) {
    const d = this.def();
    if (!d || !Array.isArray(d.members)) return;
    const next = setMembers(this.host.deformers(), d.id, members);
    if (next.find(x => x.id === d.id)?.members?.join() === d.members.join()) { this.host.note(members.length ? 'Those are the members already.' : 'A group warp needs at least one member: use Remove warp to take it away.'); return; }
    this.host.set(next);
  }
  private resize() {
    const def = this.def();
    if (!def) return;
    const next = resizeWarp(def, [Number(this.q<HTMLInputElement>('.aw-cols').value), Number(this.q<HTMLInputElement>('.aw-rows').value)]);
    if (next === def) { this.show(); return; }
    this.selection = cleanSelection(this.selection, deformerPoints(next));
    this.host.set(replaceDeformer(this.host.deformers(), next));
  }
  /** The reach of a soft selection: none (a hard one) while Soft is off. */
  falloffNow(): WarpFalloff { return this.soft ? { ...this.falloff } : { radius: 0, curve: this.falloff.curve }; }
  /** The stage or a button changed the selection: `points` replace it, join it or flip in it. */
  choose(points: readonly number[], mode: 'set' | 'add' | 'toggle') {
    if (this.topo && this.def()?.mesh) return;
    const def = this.def();
    this.selection = cleanSelection(combineSelection(this.selection, points, mode), def ? deformerPoints(def) : 0);
    this.show();
    this.host.selected();
  }
  /** Scale or rotate the chosen points about their middle or the lattice's. */
  private transform(kind: 'scale' | 'rotate') {
    const id = this.target(), box = id ? this.boxes.get(id) : undefined;
    if (!this.selection.length) return;
    if (!box) { this.host.note('The stage has not measured this part yet; choose the Warp tool and try again in a moment.'); return; }
    const about = this.q<HTMLSelectElement>('.aw-about').value === 'lattice' ? 'lattice' : 'selection';
    const f = Number(this.q<HTMLInputElement>('.aw-scale').value), deg = Number(this.q<HTMLInputElement>('.aw-rot').value);
    if (kind === 'scale' ? !(f > 0) : !Number.isFinite(deg)) return;
    const by = kind === 'scale' ? { scale: f, about } as const : { rotate: deg, about } as const, px = id ? this.pixels.get(id) : undefined;
    this.change(def => (def.mesh ? (px ? transformMeshPoints(def, this.active()!, this.value(), this.selection, px, box, by) : def) : transformWarpPoints(def, this.active()!, this.value(), this.selection, box, by)), 'That leaves the chosen points where they are.');
  }
  /** Mirror the keyform across the part's vertical middle (a mesh: matching vertices by rest position, and saying which have no partner). */
  private mirror(from: 'left' | 'right', only?: readonly number[]) {
    const def = this.def(), param = this.active();
    if (!def || !param) return;
    if (!def.mesh) {
      this.change(d => mirrorWarp(d, param, this.value(), from, only), only ? 'The partners of the chosen points already mirror them.' : from === 'left' ? 'The right half already mirrors the left.' : 'The left half already mirrors the right.',
        only ? `Mirrored ${only.length} chosen points onto their partners.` : `Mirrored the ${from} half of the lattice onto the ${from === 'left' ? 'right' : 'left'}.`);
      return;
    }
    const px = this.pixels.get(def.id);
    if (!px) { this.host.note('The stage has not measured this part yet; choose the Warp tool and try again in a moment.'); return; }
    const r = mirrorMeshWarp(def, param, this.value(), from, px, only);
    const lost = r.unpaired.length ? ` ${r.unpaired.length} vertices have no partner across the middle and were left alone (${r.unpaired.slice(0, 8).join(', ')}${r.unpaired.length > 8 ? ', …' : ''}).` : '';
    if (r.def === def) { this.host.note('The partners already mirror them.' + lost); return; }
    this.host.set(replaceDeformer(this.host.deformers(), r.def));
    this.host.note(`Mirrored ${only ? 'the chosen vertices onto their partners' : `the ${from} half of the mesh onto the ${from === 'left' ? 'right' : 'left'}`}.${lost}`);
  }
  /** Run `fn` on the chosen part's deformer as one undo step; `same` is the note when it changes nothing, `done` when it does. */
  private change(fn: (def: DeformerDef) => DeformerDef, same: string, done?: string) {
    const def = this.def(), param = this.active();
    if (!def || !param) return;
    const next = fn(def);
    if (next === def) { this.host.note(same); return; }
    this.host.set(replaceDeformer(this.host.deformers(), next));
    if (done) this.host.note(done);
  }
  /** Keyforms' Reset: the chosen points go back to rest in the keyform at the slider's value (one undo step). */
  resetChosen() {
    if (this.selection.length) this.change(def => setWarpOwn(def, this.active()!, this.value(), this.selection.map(p => [p, [0, 0]] as const)), 'The chosen points are at rest in this keyform already.');
  }
  /** The point's displacement was typed: sets what this keyform moves it by. */
  private typed() {
    const dx = this.q<HTMLInputElement>('.aw-dx'), dy = this.q<HTMLInputElement>('.aw-dy'), x = Number(dx.value), y = Number(dy.value);
    if (!this.selection.length || dx.value.trim() === '' || dy.value.trim() === '' || !Number.isFinite(x) || !Number.isFinite(y)) { this.show(); return; }
    // The fields show the average of the chosen points: typing moves each of them by the difference.
    this.change(def => {
      const avg = averageDisplacement(def, this.active()!, this.value(), this.selection)!;
      return moveWarpPoints(def, this.active()!, this.value(), new Map(this.selection.map(p => [p, 1] as const)), [x - avg[0], y - avg[1]]);
    }, 'That is what the point has already.');
  }
  private write() {
    const def = this.def(), param = this.active();
    if (!def || !param) return;
    const box = this.boxes.get(def.id);
    if (!box || (def.mesh && !this.pixels.get(def.id))) { this.host.note('The stage has not measured this part yet; choose the Warp tool and try again in a moment.'); return; }
    const kind = this.q<HTMLSelectElement>('.aw-preset').value as WarpPreset, amount = Number(this.q<HTMLInputElement>('.aw-amount').value);
    this.host.set(replaceDeformer(this.host.deformers(), warpPreset(def, param, kind, box, { ...(Number.isFinite(amount) && amount >= 0 ? { amount } : {}), ...(this.pixels.get(def.id) ? { pixels: this.pixels.get(def.id) } : {}) })));
    this.host.note(`${WARP_PRESETS.find(p => p.id === kind)!.label} written as the keys of ${param.id} (${warpKeyValues(this.def() ?? def, param.id).join(', ')}).`);
    // Done: the panel closes (it would cover Keyforms' key strip, where the new keys are), and the focus goes back to its ▾.
    this.pops[3].close();
    this.pops[3].button.focus({ preventScroll: true });
  }
  private setAmount() {
    const p = WARP_PRESETS.find(x => x.id === this.q<HTMLSelectElement>('.aw-preset').value);
    if (p) this.q<HTMLInputElement>('.aw-amount').value = String(p.amount);
  }

  // ---- drags from the stage ----
  /** A point of the lattice of deformer `id` was pressed (`start`), moved by `delta` since (`move`) or released (`end`). */
  dragged(phase: 'start' | 'move' | 'end', id: string, point: number, delta: [number, number]) {
    if (this.topo && deformerById(this.host.deformers(), id)?.mesh) { this.movedRest(phase, id, point, delta); return; }
    if (phase === 'start') {
      this.dragging = null;
      // Pressing a chosen point drags the whole selection; pressing any other point chooses it alone.
      if (!this.selection.includes(point)) this.selection = [point];
      this.host.selected();
      const def = deformerById(this.host.deformers(), id), param = this.active();
      if (!def) return;
      if (!param) { this.host.note('Pick a slider in the Parameters section first (click its name): the warp is keyed to the active parameter.'); this.show(); return; }
      // A skinned mesh's keyform is a shape before the skin, and a drag is measured on screen: with an influencing bone posed they disagree, so it waits for the rest pose.
      const posed = def.mesh && isSkinned(def.mesh) ? this.host.posedInfluences(def) : [];
      if (posed.length) { this.host.note(`This mesh is skinned and ${posed.join(', ')} ${posed.length === 1 ? 'is' : 'are'} posed by a parameter: a keyform is shaped with its bones at rest. Put the sliders that move ${posed.length === 1 ? 'it' : 'them'} back to their defaults (the Parameters section shows what is off), then drag.`); this.show(); return; }
      this.dragging = { base: def, param, value: this.value(), weights: softWeights(def, this.selection, this.falloffNow()), drag: this.host.drag() };
      this.show();
      return;
    }
    const d = this.dragging;
    if (!d) return;
    const next = moveWarpPoints(d.base, d.param, d.value, d.weights, delta);
    d.drag.put(replaceDeformer(this.host.deformers(), next));
    if (phase === 'end') {
      this.dragging = null;
      d.drag.end();
      // A drag between keys makes a key there: say so, as the gizmo's line does for a pose (SD-7).
      // A first key says it started the keyform (MD-5), and a key on one axis of a pad the warp is keyed to warns that it adds on top of that grid (MD-1).
      if (next !== d.base && warpKeyAt(d.base, d.param, d.value) === null) {
        const at = Math.round(d.value * 1000) / 1000, first = !d.base.keyforms?.some(k => k.param === d.param.id);
        const grid = d.base.keyforms?.find(k => k.params?.includes(d.param.id))?.params;
        this.host.note((first ? `Keyed ${d.base.id} to ${d.param.id}: a key at ${at}, with rest at ${d.param.default}.` : `Added a key of ${d.param.id} at ${at} to ${d.base.id}: the drag was between keys.`)
          + (grid ? ` It adds on top of the grid ${d.base.id} has on ${grid.join(' and ')}.` : '') + ' Ctrl+Z takes it back.');
      }
    }
  }

  // ---- topology of a free mesh ----
  /** The topology tool on the stage, null outside the mode (or for a part that has no free mesh). */
  topoTool(): TopoTool | null { return this.topo && this.def()?.mesh ? this.topoPick : null; }
  /** In Edit topology, what the topology tool in use does, for the status line (MD-13: it kept the Warp hint); null otherwise. */
  topoHint(): string | null { const t = TOPO_TOOLS.find(x => x.id === this.topoTool()); return t ? `Edit topology · ${t.label}: ${t.hint}` : null; }
  /** The vertex an Add edge started from, if any. */
  topoAnchor(): number | null { return this.topoTool() === 'addEdge' ? this.anchor : null; }

  /** The stage reports a click of the topology tool. */
  topology(e: { op: string; vertex?: number; a?: number; b?: number; at?: [number, number] }) {
    const def = this.def();
    if (!this.topo || !def?.mesh || this.busy) return;
    if (e.op === 'cancel') {
      if (this.anchor !== null) this.anchor = null; else this.topo = false;
      this.show();
      this.host.selected();
      return;
    }
    const { a, b, vertex, at } = e;
    let make: ((m: MeshGeo) => MeshEditResult) | null = null;
    if (e.op === 'add') { if (!at) { this.host.note('Click inside the mesh to add a vertex.'); return; } make = m => addMeshVertex(m, at[0], at[1]); }
    else if (e.op === 'delete' && vertex !== undefined) make = m => deleteMeshVertex(m, vertex);
    else if (e.op === 'flip' && a !== undefined && b !== undefined) make = m => flipMeshEdge(m, a, b);
    else if (e.op === 'removeEdge' && a !== undefined && b !== undefined) make = m => removeMeshEdge(m, a, b);
    else if (e.op === 'addEdge' && vertex !== undefined) {
      if (this.anchor === null) { this.anchor = vertex; this.host.note(`Vertex ${vertex} chosen: click a second vertex to join it (Esc cancels).`); this.host.selected(); return; }
      const from = this.anchor;
      this.anchor = null;
      make = m => (from === vertex ? { error: 'Choose a second, different vertex.' } : addMeshEdge(m, from, vertex));
    }
    if (make) void this.editTopology(make);
  }
  /** Applies a topology edit to the chosen mesh: refused with the reason in the note, or (after asking, when keyforms would go) written as one undo step that drops the keyforms. */
  private async editTopology(make: (m: MeshGeo) => MeshEditResult) {
    const def = this.def();
    if (!def?.mesh) return;
    let r = make(meshGeo(def));
    if ('error' in r) { this.host.note(r.error); this.host.selected(); return; }
    if (hasKeyforms(def)) {
      this.busy = true;
      const ok = await confirmAsk(`This edit changes the mesh's vertices or edges, so the per-vertex keyforms of ${def.id} (${def.keyforms.length} parameter${def.keyforms.length === 1 ? '' : 's'}) are dropped. Undo brings them back.`, 'Edit mesh');
      this.busy = false;
      if (!ok) { this.host.selected(); return; }
    }
    const now = this.def();
    if (!now?.mesh || now.id !== def.id) return;
    r = make(meshGeo(now));
    if ('error' in r) { this.host.note(r.error); return; }
    this.selection = [];
    this.host.set(replaceDeformer(this.host.deformers(), setMeshGeometry(now, r.mesh)));
  }
  /** A drag of a vertex in the Move tool: the stage shows the rest position moving; the release is one undo step (after asking, when keyforms would go). */
  private movedRest(phase: 'start' | 'move' | 'end', id: string, point: number, delta: [number, number]) {
    if (phase === 'start') {
      this.restDrag = null;
      const base = deformerById(this.host.deformers(), id), box = this.boxes.get(id), pixels = this.pixels.get(id);
      if (!base?.mesh || this.busy) return;
      if (!box || !pixels) { this.host.note('The stage has not measured this part yet; try again in a moment.'); return; }
      this.restDrag = { base, box, pixels, last: null, drag: this.host.drag() };
      return;
    }
    const d = this.restDrag;
    if (!d) return;
    const m = d.base.mesh!, r = moveMeshVertex(meshGeo(d.base), point, m.verts[point * 2] + delta[0] * (d.pixels[0] / d.box.w), m.verts[point * 2 + 1] + delta[1] * (d.pixels[1] / d.box.h));
    if ('mesh' in r) {
      d.last = r.mesh;
      d.drag.put(replaceDeformer(this.host.deformers(), { ...d.base, mesh: { ...m, verts: r.mesh.verts } })); // the keyforms stay while it is only shown
    } else this.host.note(r.error);
    if (phase !== 'end') return;
    this.restDrag = null;
    const { base, last } = d;
    if (!last) { d.drag.end(); return; }
    if (!hasKeyforms(base)) { d.drag.put(replaceDeformer(this.host.deformers(), setMeshGeometry(base, last))); d.drag.end(); return; }
    d.drag.put(replaceDeformer(this.host.deformers(), base)); // back to what it was; the edit is made below if it is confirmed
    d.drag.end();
    this.busy = true;
    void confirmAsk(`Moving this vertex changes the mesh, so the per-vertex keyforms of ${base.id} (${base.keyforms.length} parameter${base.keyforms.length === 1 ? '' : 's'}) are dropped. Undo brings them back.`, 'Move vertex').then(ok => {
      this.busy = false;
      const now = this.def();
      if (ok && now?.id === base.id) this.host.set(replaceDeformer(this.host.deformers(), setMeshGeometry(now, last)));
      else this.host.selected();
    });
  }

  // ---- showing ----
  /** Redraw from the working copy: the chosen part, its warp, the parameter and its value. */
  show() {
    const part = this.part(), bone = this.bone(), def = this.def(), params = this.host.params(), q = this.q, ds = this.host.deformers();
    const chosen = this.host.part(), key = `${chosen}|${def?.id ?? ''}`;
    if (chosen !== this.lastPart) { this.choice = null; this.param = null; this.topo = false; this.anchor = null; }
    if (chosen !== this.lastPart || key !== this.lastKey) this.selection = [];
    this.lastPart = chosen;
    this.lastKey = key;
    if (def) this.selection = cleanSelection(this.selection, deformerPoints(def));
    this.param = this.host.activeParam();
    const seed = this.groupSeed(), isGroup = !!def && Array.isArray(def.members), own = part ? deformerOf(ds, part) : undefined;
    const shape = this.shape(), set = this.host.setParts();
    const none = !chosen ? 'Choose a part (on the stage or in the Parts tree) to give it a warp, or to edit the one it has.'
      : set && !def ? `The ${set.length} parts share no group warp: Add group warp makes one lattice over them (a part's own warp is edited with that part chosen alone).`
      : set ? ''
      : shape && !def ? `${shape} is a mask shape: it has no warp of its own. A group warp bends it when it is one of its members (tick it there), or make it follow a part (Properties, Clip: follows).`
      : shape ? ''
      : bone && !def && !seed ? `${bone} has no parts on it to warp.`
        : bone && !def ? `${bone} is a bone. A warp belongs to a part: choose one of the parts on it, or add a group warp over all of them.`
          : !part && !bone ? '' : !params.length ? 'This rig has no parameters yet. A lattice warp bends only with one (+ in the Parameters section makes one); a mesh also bends with bones, weighted with the Weights tool (B), so Generate mesh works now.' : '';
    q<HTMLElement>('.aw-none').textContent = none;
    q<HTMLElement>('.aw-none').hidden = !none;
    // Add warp, Add group warp and Remove warp are Deform's line verbs (propBlocks); a lattice needs a parameter, a mesh (the Mesh row) does not.
    // A row with a warp of its own and/or a group warp offers the choice between them: the Target ▾ in Deform's line (propBlocks says when).
    const cands = this.candidates(), targetPick = q<HTMLSelectElement>('.aw-targetpick');
    const count = (d: DeformerDef) => { const shapes = (d.members ?? []).filter(m => this.host.isShape(m)).length, parts = (d.members ?? []).length - shapes; return `${parts} part${parts === 1 ? '' : 's'}${shapes ? `, ${shapes} shape${shapes === 1 ? '' : 's'}` : ''}`; };
    const labels = cands.map(d => (Array.isArray(d.members) ? `group ${d.id} (${count(d)})` : `own warp ${d.id}`));
    if (targetPick.dataset.opts !== labels.join('|') + '#' + cands.map(d => d.id).join('|')) {
      targetPick.dataset.opts = labels.join('|') + '#' + cands.map(d => d.id).join('|');
      targetPick.replaceChildren(...cands.map((d, i) => el('option', { value: d.id, textContent: labels[i] })));
    }
    if (def) targetPick.value = def.id;
    q<HTMLElement>('.aw-targethint').textContent = isGroup && set ? `The ${set.length} parts are all members of this group.` : isGroup && part ? (deformerOf(this.host.deformers(), part) ? `${part} is bent by this group's lattice after its own warp.` : `${part} is bent by this group's lattice; it has no warp of its own (Add warp makes one, bent first).`) : isGroup && shape ? `${shape} is a mask shape: this group's lattice bends it, as it bends the parts it clips.` : '';
    const mem = q<HTMLElement>('.aw-members');
    mem.hidden = !isGroup;
    if (isGroup) this.showMembers(def!);
    this.showIssues(def);
    // The Mesh row: a part can be given a free mesh, or have its own lattice replaced or its mesh regenerated.
    const meshed = !!def?.mesh, gen = q<HTMLElement>('.aw-meshgen');
    gen.hidden = !part;
    if (part) {
      const mesh = this.generated(part), n = mesh ? mesh.verts.length / 2 : null;
      if (!this.alphas.has(part)) void this.fetchAlpha(part);
      q<HTMLSelectElement>('.aw-detail').value = this.detail;
      q<HTMLElement>('.aw-vcount').textContent = n === null ? (this.noAlpha.has(part) ? 'image unreadable' : 'reading the image…') : `${n} vertices (at most ${MESH_MAX_VERTS})`;
      q<HTMLElement>('.aw-vcount').title = 'Point at this row to see the mesh on the stage';
      const btn = q<HTMLButtonElement>('.aw-genbtn'), replacing = !!own && !own.mesh;
      btn.textContent = own?.mesh ? 'Regenerate mesh' : replacing ? 'Replace lattice with mesh' : 'Generate mesh';
      btn.disabled = mesh !== null && !meshUsable(mesh);
      q<HTMLElement>('.aw-genhint').textContent = own?.mesh ? 'Regenerating changes the vertices, so the mesh\'s keyforms are dropped (after asking).' : replacing ? 'Replaces the lattice and drops its keyforms (after asking).' : 'A triangle mesh that follows the part\'s outline, for a shape a lattice cannot bend, or to bend the part with bones (the Weights tool, B).';
    }
    this.sendPreview(); // a new detail, margin or part redraws the preview
    q<HTMLElement>('.aw-grid').hidden = !def;
    // A free mesh has no lattice to resize: its summary shows in place of the grid size; the rest edits its vertices as it edits lattice points.
    q<HTMLElement>('.aw-gridname').textContent = meshed ? 'Mesh' : 'Lattice';
    q<HTMLElement>('.aw-dims').hidden = meshed;
    q<HTMLElement>('.aw-meshsum').hidden = !meshed;
    if (meshed) {
      const m = def!.mesh!;
      q<HTMLElement>('.aw-meshsum').textContent = `${deformerPoints(def!)} vertices, ${m.tris.length / 3} triangles, detail ${MESH_DETAIL_STEPS.find(d => d.id === m.detail)?.label.toLowerCase() ?? 'custom'}.`;
    }
    // Topology mode (a free mesh only): its tools replace the keyform controls while it is on.
    if (!meshed) { this.topo = false; this.anchor = null; }
    // The bar (engine studio-inspector.ts warpBar): the selection, the operations, or the topology tools.
    const view = warpBar({ hasWarp: !!def, mesh: meshed, topo: this.topo, keyed: !!this.active(), selected: this.selection.length, soft: this.soft });
    q<HTMLElement>('.aw-sel').hidden = !view.selection;
    q<HTMLElement>('.aw-tools').hidden = !view.operations;
    for (const cls of ['.aw-rowpick', '.aw-colpick']) q<HTMLElement>(cls).hidden = !view.rows;
    q<HTMLButtonElement>('.aw-softopts').disabled = !view.reach;
    if (!view.selection || !view.reach) this.pops[0].close();
    if (!view.operations) for (const pop of this.pops.slice(1)) pop.close();
    // Edit topology, first in the bar for a free mesh: a mode of the tool, so its tooltip says what the topology tool chosen does.
    const topoOn = q<HTMLButtonElement>('.aw-topoon');
    q<HTMLElement>('.aw-topogrp').hidden = !view.topoToggle;
    topoOn.setAttribute('aria-pressed', String(this.topo));
    topoOn.title = this.topo ? `Edit topology is on: ${TOPO_TOOLS.find(t => t.id === this.topoPick)!.label}. ${TOPO_TOOLS.find(t => t.id === this.topoPick)!.hint}${def && hasKeyforms(def) ? ' Edits drop the keyforms (after asking; undo restores them).' : ''} Esc or a press here ends it.` : TOPO_OFF;
    q<HTMLElement>('.aw-topotools').hidden = !view.topology;
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('.aw-tt')) b.setAttribute('aria-pressed', String(b.dataset.tool === this.topoPick));
    // The Point row in Keyforms: the chosen points' move in the keyform at the slider's value (not while the topology tools are on).
    q<HTMLElement>('.aw-pt').hidden = !def || this.topo || !this.active();
    q<HTMLElement>('.aw-about option[value=lattice]').textContent = meshed ? 'about the part centre' : 'about the lattice centre';
    if (!def) return;
    const [cols, rows] = meshed ? [0, 0] : deformerGrid(def);
    if (!meshed) for (const [cls, v] of [['.aw-cols', cols], ['.aw-rows', rows]] as const) { const i = q<HTMLInputElement>(cls); if (document.activeElement !== i) i.value = String(v); }
    const p = this.active(), sel = this.selection;
    const fill = (cls: string, label: string, n: number, name: string) => {
      const s = q<HTMLSelectElement>(cls);
      if (s.options.length !== n + 1 || s.dataset.n !== String(n)) { s.dataset.n = String(n); s.replaceChildren(el('option', { value: '', textContent: label }), ...Array.from({ length: n }, (_, i) => el('option', { value: String(i), textContent: `${name} ${i}` }))); }
    };
    if (!meshed) { fill('.aw-rowpick', 'row…', rows + 1, 'row'); fill('.aw-colpick', 'column…', cols + 1, 'column'); }
    q<HTMLElement>('.aw-soft').setAttribute('aria-pressed', String(this.soft));
    if (document.activeElement !== q('.aw-radius')) q<HTMLInputElement>('.aw-radius').value = String(this.falloff.radius);
    q<HTMLElement>('.aw-selhint').textContent = sel.length ? `${sel.length} chosen` : '';
    q<HTMLElement>('.aw-selhint').title = sel.length ? `${sel.length} ${meshed ? 'vertices' : 'points'} chosen${this.soft ? `, soft over ${this.falloff.radius} ${meshed ? 'edges' : 'cells'}` : ''}. Drag one to move them all; Shift-click adds or removes one.` : '';
    q<HTMLButtonElement>('.aw-clear').disabled = !view.none;
    for (const cls of ['.aw-mirrorbtn', '.aw-mirror-lr', '.aw-mirror-rl', '.aw-smooth', '.aw-presetbtn', '.aw-preset', '.aw-amount', '.aw-write']) q<HTMLInputElement>(cls).disabled = !view.keyed;
    for (const cls of ['.aw-mirror-sel', '.aw-scale-go', '.aw-rot-go']) q<HTMLInputElement>(cls).disabled = !view.onSelection;
    if (!view.keyed) for (const pop of [this.pops[1], this.pops[3]]) pop.close();
    q<HTMLElement>('.aw-smooth').title = sel.length ? 'Smooth: even out the chosen points of this keyform; press again for more' : 'Smooth: even out the points of this keyform (the chosen ones, if any); press again for more';
    q<HTMLElement>('.aw-scale-go').title = `Scale the chosen points by ${q<HTMLInputElement>('.aw-scale').value} (the factor is under ▾)`;
    q<HTMLElement>('.aw-rot-go').title = `Rotate the chosen points by ${q<HTMLInputElement>('.aw-rot').value} degrees (the angle is under ▾)`;
    if (!p) { q<HTMLElement>('.aw-pthint').textContent = ''; return; }
    const v = this.value();
    const n = sel.length === 1 ? sel[0] : null, avg = averageDisplacement(def, p, v, sel), pick = q<HTMLSelectElement>('.aw-pick');
    const where = (i: number) => (meshed ? `vertex ${i}` : `${i} (column ${i % (cols + 1)}, row ${Math.floor(i / (cols + 1))})`);
    if (pick.options.length !== deformerPoints(def) + 1 || pick.dataset.cols !== (meshed ? 'mesh' : String(cols))) {
      pick.dataset.cols = meshed ? 'mesh' : String(cols);
      pick.replaceChildren(el('option', { value: '', textContent: '(none chosen)' }), ...Array.from({ length: deformerPoints(def) }, (_, i) => el('option', { value: String(i), textContent: where(i) })));
    }
    pick.value = n === null ? '' : String(n); // several chosen: none shows
    for (const [cls, k] of [['.aw-dx', 0], ['.aw-dy', 1]] as const) {
      const i = q<HTMLInputElement>(cls);
      i.disabled = avg === null;
      if (document.activeElement !== i) i.value = avg === null ? '' : shown(avg[k]);
    }
    q<HTMLElement>('.aw-pthint').textContent = !sel.length ? 'Click a point on the stage (Warp tool, D), or choose one here.'
      : n !== null ? `${meshed ? 'Vertex' : 'Point'} ${where(n)}: how far this keyform moves it, in stage units.`
        : `${sel.length} points chosen: the fields show their average; typing moves each of them by the difference.`;
    q<HTMLElement>('.aw-pt').title = q<HTMLElement>('.aw-pthint').textContent ?? ''; // the hint is the row's tooltip (its span is hidden in Keyforms)
    q<HTMLElement>('.aw-presethint').textContent = WARP_PRESETS.find(x => x.id === q<HTMLSelectElement>('.aw-preset').value)?.hint ?? '';
  }
}
