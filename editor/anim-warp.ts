// The animation studio's Warp section (Model mode): the mesh warp of the chosen part, or the group warp over several parts that
// it is in (rig.json `deformers`). It adds, resizes
// and removes the warp, picks the parameter whose keyform is edited (its slider is the one in Parameters), turns a lattice
// point dragged on the stage into a key of that keyform, and offers reset, mirror, smooth and the shape presets. The maths is
// in engine/src/warp-edit.ts; the stage draws the lattice and reports drags (preview/studio-gizmo.ts). The studio keeps the
// working copy; this works through `WarpHost`.

import {
  addMeshEdge, addMeshVertex, deleteMeshVertex, flipMeshEdge, hasKeyforms, moveMeshVertex, removeMeshEdge, setMeshGeometry, mirrorMeshWarp, smoothMeshWarp, transformMeshPoints, addDeformer, addGroupDeformer, averageDisplacement, generateMesh, MESH_DETAIL_STEPS, MESH_MAX_VERTS, meshReplaces, meshUsable, setPartMesh, cleanSelection, combineSelection, deformerById, deformerGrid, deformerOf, deformerPoints, deformersOfPart, deleteWarpKey, DEFORMER_MAX_GRID, invertSelection, mirrorWarp,
  moveWarpPoints, removeDeformerById, replaceDeformer, resizeWarp, setMembers, setWarpOwn, smoothWarp, softWeights, transformWarpPoints, warpAllPoints, warpColumn, warpKeyAt,
  warpKeyValues, warpPreset, warpRow, WARP_CURVES, WARP_DEFAULT_FALLOFF, WARP_PRESETS,
  type DeformerDef, type GeneratedMesh, type MeshEditResult, type MeshGeo, type MeshDetail, type ParamDef, type PartBox, type WarpCurve, type WarpFalloff, type WarpPreset,
} from '../engine/src/index.js';
import { el } from './anim-dom.js';
import { confirmAsk } from './ask.js';

/** A drag in progress: `put` shows the deformers it makes, `end` makes it one undo step. */
export interface WarpDrag { put(deformers: DeformerDef[]): void; end(): void }

export interface WarpHost {
  /** The chosen row of the tree. */
  part(): string | null;
  /** The warp is keyed to the parameter active in the Parameters section (null while none or a pad is). */
  activeParam(): string | null;
  /** Is the name a part (a bone has no image to warp)? */
  isPart(name: string): boolean;
  /** Is the name a bone? */
  isBone(name: string): boolean;
  /** Is the name a mask shape (an imageless part: it has no warp of its own, but a group warp may bend it)? */
  isShape(name: string): boolean;
  /** The mask shapes of the character. */
  shapes(): string[];
  /** The parts and shapes ticked in the tree (the chosen one and the extra ones), in tree order. */
  selectedParts(): string[];
  /** Clipped parts that a group warp bends while their shape is not bent with them (engine mask-edit.ts clipGroupIssues). */
  clipIssues(): { part: string; shape: string; group: string }[];
  /** Add a shape to the members of a group warp, as one undo step. */
  fixClip(issue: { part: string; shape: string; group: string }): void;
  /** The parts and shapes on a bone and the bones below it. */
  bonePartsOf(bone: string): string[];
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
  /** The name of an animation with a frame track on slot `part`, if any (a warped part cannot swap frames). */
  framedIn(part: string): string | null;
  note(text: string): void;
}

/** The tools of the Topology mode of a free mesh. */
export type TopoTool = 'add' | 'delete' | 'move' | 'flip' | 'addEdge' | 'removeEdge';
const TOPO_TOOLS: { id: TopoTool; label: string; hint: string }[] = [
  { id: 'add', label: 'Add vertex', hint: 'Click inside the mesh to add a vertex; near an edge it splits the edge.' },
  { id: 'delete', label: 'Delete vertex', hint: 'Click a vertex to delete it; the hole it leaves is filled with new triangles.' },
  { id: 'move', label: 'Move vertex', hint: 'Drag a vertex to move its rest position (where the art sits before any keyform bends it).' },
  { id: 'flip', label: 'Flip edge', hint: 'Click an edge between two triangles to swap it for the other diagonal of their quad.' },
  { id: 'addEdge', label: 'Add edge', hint: 'Click two vertices that share a neighbour: the edge between them closes a new triangle across the outline.' },
  { id: 'removeEdge', label: 'Remove edge', hint: 'Click an edge on the outline to remove its triangle.' },
];
const meshGeo = (d: DeformerDef): MeshGeo => ({ verts: d.mesh!.verts, tris: d.mesh!.tris });

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

  constructor(private root: HTMLElement, private host: WarpHost) {
    this.root.innerHTML = `
      <p class="as-pivot-hint aw-none"></p>
      <div class="aw-target"><span class="as-pivot-name">Target</span>
        <label><select class="aw-targetpick" aria-label="Which warp to edit"></select></label>
        <span class="as-pivot-hint aw-targethint"></span></div>
      <div class="aw-add"><span class="as-pivot-name">Warp</span><button type="button" class="aw-addbtn"></button>
        <span class="as-pivot-hint">A lattice over the part's image. Dragging its points in a parameter's keyform bends the part as the parameter moves.</span></div>
      <div class="aw-groupadd"><span class="as-pivot-name">Group</span><button type="button" class="aw-groupbtn"></button>
        <span class="as-pivot-hint">One lattice over several parts, like a parent deformer: it bends them together, after each one's own warp.</span></div>
      <div class="aw-members"><span class="as-pivot-name">Members</span>
        <span class="aw-memberlist" role="group" aria-label="Parts of the group warp"></span>
        <button type="button" class="aw-usesel" title="Make the parts ticked in the tree the members">Use selected parts</button>
        <span class="as-pivot-hint aw-memberhint"></span>
        <span class="aw-clipissues"></span></div>
      <div class="aw-meshgen"><span class="as-pivot-name">Mesh</span>
        <label>Detail <select class="aw-detail" aria-label="How finely the mesh follows the art"></select></label>
        <label>margin <input type="number" class="aw-margin" min="0" step="1" placeholder="auto" aria-label="How far the mesh reaches past the opaque pixels, in image pixels"></label>
        <span class="aw-vcount" role="status"></span>
        <button type="button" class="aw-genbtn"></button>
        <span class="as-pivot-hint aw-genhint"></span></div>
      <div class="aw-topo"><span class="as-pivot-name">Topology</span>
        <button type="button" class="aw-topoon" aria-pressed="false" title="Add, delete and move vertices and edges. These change what the keyforms mean, so they drop them (after asking)">Edit topology</button>
        <span class="aw-topotools" role="group" aria-label="Topology tool"></span>
        <span class="as-pivot-hint aw-topohint"></span></div>
      <div class="aw-grid"><span class="as-pivot-name aw-gridname">Lattice</span>
        <span class="aw-dims"><label>columns <input type="number" class="aw-cols" min="1" max="${DEFORMER_MAX_GRID}" step="1"></label>
        <label>rows <input type="number" class="aw-rows" min="1" max="${DEFORMER_MAX_GRID}" step="1"></label></span>
        <span class="aw-meshsum"></span>
        <button type="button" class="aw-remove">Remove warp</button></div>
      <div class="aw-form"><span class="as-pivot-name">Keyform</span>
        <span class="aw-active"></span>
        <button type="button" class="aw-delkey" title="Remove the key at this value">Delete key</button>
        <span class="aw-keys" role="group" aria-label="Keys of this parameter"></span>
        <span class="as-pivot-hint aw-keyhint"></span></div>
      <div class="aw-sel"><span class="as-pivot-name">Select</span>
        <button type="button" class="aw-all" title="Choose every point (Ctrl+A on the stage)">All</button>
        <button type="button" class="aw-clear" title="Choose none (Esc on the stage)">None</button>
        <button type="button" class="aw-invert" title="Choose the points that are not chosen">Invert</button>
        <label><select class="aw-rowpick" aria-label="Choose a row of points"></select></label>
        <label><select class="aw-colpick" aria-label="Choose a column of points"></select></label>
        <label class="aw-softl" title="A drag of the selection also pulls the points near it, less the farther they are"><input type="checkbox" class="aw-soft"> Soft</label>
        <label>reach <input type="number" class="aw-radius" min="0.5" max="${DEFORMER_MAX_GRID}" step="0.5" aria-label="How many lattice cells a soft selection reaches"></label>
        <label><select class="aw-curve" aria-label="How a soft selection fades"></select></label>
        <span class="as-pivot-hint aw-selhint">Drag a rectangle on the stage, Shift-click points, or choose rows and columns here.</span></div>
      <div class="aw-pt"><span class="as-pivot-name">Point</span>
        <label><select class="aw-pick" aria-label="Lattice point"></select></label>
        <label>dx <input type="number" class="aw-dx" step="0.005" aria-label="Sideways move of the point in this keyform"></label>
        <label>dy <input type="number" class="aw-dy" step="0.005" aria-label="Vertical move of the point in this keyform"></label>
        <button type="button" class="aw-reset" title="Take the chosen point back to rest in this keyform">Reset point</button>
        <span class="as-pivot-hint aw-pthint"></span></div>
      <div class="aw-tools"><span class="as-pivot-name">Tools</span>
        <button type="button" class="aw-mirror-lr" title="Copy the left half of this keyform to the right, mirrored">Mirror left to right</button>
        <button type="button" class="aw-mirror-rl" title="Copy the right half of this keyform to the left, mirrored">Mirror right to left</button>
        <button type="button" class="aw-mirror-sel" title="Copy the chosen points across the middle of the lattice onto their partners">Mirror selection</button>
        <button type="button" class="aw-smooth" title="Even out the points of this keyform; press again for more">Smooth</button></div>
      <div class="aw-xf"><span class="as-pivot-name">Transform</span>
        <label>scale <input type="number" class="aw-scale" min="0.1" max="10" step="0.05" value="1.1" aria-label="Scale factor"></label>
        <button type="button" class="aw-scale-go" title="Scale the chosen points by this factor">Scale</button>
        <label>turn <input type="number" class="aw-rot" min="-360" max="360" step="5" value="10" aria-label="Rotation in degrees, clockwise"></label>
        <button type="button" class="aw-rot-go" title="Rotate the chosen points by this many degrees, clockwise">Rotate</button>
        <label><select class="aw-about" aria-label="Scale and rotate about"><option value="selection">about the selection</option><option value="lattice">about the lattice centre</option></select></label></div>
      <div class="aw-presets"><span class="as-pivot-name">Preset</span>
        <label>Shape <select class="aw-preset" aria-label="Shape"></select></label>
        <label>amount <input type="number" class="aw-amount" min="0" step="0.01"></label>
        <button type="button" class="aw-write" title="Write the shape as the keys of the chosen parameter, replacing the ones it has">Write keys</button>
        <span class="as-pivot-hint aw-presethint"></span></div>`;
    this.q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.q<HTMLSelectElement>('.aw-preset').append(...WARP_PRESETS.map(p => el('option', { value: p.id, textContent: p.label })));
    this.setAmount();
    this.q<HTMLSelectElement>('.aw-preset').addEventListener('change', () => { this.setAmount(); this.show(); });
    this.q('.aw-addbtn').addEventListener('click', () => this.add());
    this.q<HTMLSelectElement>('.aw-detail').append(...MESH_DETAIL_STEPS.map(d => el('option', { value: d.id, textContent: d.label })));
    this.q<HTMLSelectElement>('.aw-detail').value = this.detail;
    this.q<HTMLSelectElement>('.aw-detail').addEventListener('change', e => { this.detail = (e.target as HTMLSelectElement).value as MeshDetail; this.show(); });
    this.q<HTMLInputElement>('.aw-margin').addEventListener('change', () => this.show());
    this.q('.aw-genbtn').addEventListener('click', () => void this.generate());
    this.q('.aw-topotools').append(...TOPO_TOOLS.map(t => {
      const b = el('button', { type: 'button', className: 'aw-tt', textContent: t.label, title: t.hint });
      b.dataset.tool = t.id;
      b.addEventListener('click', () => { this.topoPick = t.id; this.anchor = null; this.show(); this.host.selected(); });
      return b;
    }));
    this.q('.aw-topoon').addEventListener('click', () => { this.topo = !this.topo; this.anchor = null; this.selection = []; this.show(); this.host.selected(); });
    this.q('.aw-remove').addEventListener('click', () => { const d = this.def(); if (d) { this.selection = []; this.choice = null; this.host.set(removeDeformerById(this.host.deformers(), d.id)); } });
    this.q<HTMLSelectElement>('.aw-targetpick').addEventListener('change', e => { this.choice = (e.target as HTMLSelectElement).value; this.selection = []; this.show(); this.host.selected(); });
    this.q('.aw-groupbtn').addEventListener('click', () => this.addGroup());
    this.q('.aw-usesel').addEventListener('click', () => this.setMembersTo(this.host.selectedParts()));
    this.q<HTMLSelectElement>('.aw-curve').append(...WARP_CURVES.map(c => el('option', { value: c, textContent: c })));
    this.q<HTMLSelectElement>('.aw-curve').value = this.falloff.curve;
    this.q<HTMLInputElement>('.aw-radius').value = String(this.falloff.radius);
    this.q('.aw-all').addEventListener('click', () => { const d = this.def(); if (d) this.choose(warpAllPoints(d), 'set'); });
    this.q('.aw-clear').addEventListener('click', () => this.choose([], 'set'));
    this.q('.aw-invert').addEventListener('click', () => { const d = this.def(); if (d) this.choose(invertSelection(d, this.selection), 'set'); });
    this.q<HTMLSelectElement>('.aw-rowpick').addEventListener('change', e => { const s = e.target as HTMLSelectElement, d = this.def(); if (d && s.value !== '') this.choose(warpRow(d, Number(s.value)), 'set'); s.value = ''; });
    this.q<HTMLSelectElement>('.aw-colpick').addEventListener('change', e => { const s = e.target as HTMLSelectElement, d = this.def(); if (d && s.value !== '') this.choose(warpColumn(d, Number(s.value)), 'set'); s.value = ''; });
    this.q<HTMLInputElement>('.aw-soft').addEventListener('change', e => { this.soft = (e.target as HTMLInputElement).checked; this.show(); this.host.selected(); });
    this.q<HTMLInputElement>('.aw-radius').addEventListener('change', e => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v) && v > 0) this.falloff.radius = v; this.show(); this.host.selected(); });
    this.q<HTMLSelectElement>('.aw-curve').addEventListener('change', e => { this.falloff.curve = (e.target as HTMLSelectElement).value as WarpCurve; this.host.selected(); });
    this.q('.aw-scale-go').addEventListener('click', () => this.transform('scale'));
    this.q('.aw-rot-go').addEventListener('click', () => this.transform('rotate'));
    for (const cls of ['.aw-cols', '.aw-rows']) this.q<HTMLInputElement>(cls).addEventListener('change', () => this.resize());
    this.q('.aw-delkey').addEventListener('click', () => this.change(def => deleteWarpKey(def, this.active()!, this.value()), 'There is no key at this value.'));
    this.q<HTMLSelectElement>('.aw-pick').addEventListener('change', e => { const v = (e.target as HTMLSelectElement).value; this.selection = v === '' ? [] : [Number(v)]; for (const cls of ['.aw-dx', '.aw-dy']) this.q<HTMLInputElement>(cls).blur(); this.show(); this.host.selected(); });
    for (const cls of ['.aw-dx', '.aw-dy']) this.q<HTMLInputElement>(cls).addEventListener('change', () => this.typed());
    this.q('.aw-reset').addEventListener('click', () => { if (this.selection.length) this.change(def => setWarpOwn(def, this.active()!, this.value(), this.selection.map(p => [p, [0, 0]] as const)), 'The chosen points are at rest in this keyform already.'); });
    this.q('.aw-mirror-lr').addEventListener('click', () => this.mirror('left'));
    this.q('.aw-mirror-rl').addEventListener('click', () => this.mirror('right'));
    this.q('.aw-mirror-sel').addEventListener('click', () => this.mirror('left', this.selection));
    this.q('.aw-smooth').addEventListener('click', () => this.change(def => (def.mesh ? smoothMeshWarp : smoothWarp)(def, this.active()!, this.value(), 0.5, this.selection.length ? this.selection : undefined), 'Nothing to smooth: the points are even.'));
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
  private part(): string | null { const p = this.host.part(); return p !== null && this.host.isPart(p) ? p : null; }
  /** The chosen row, if it is a mask shape. */
  private shape(): string | null { const p = this.host.part(); return p !== null && this.host.isShape(p) ? p : null; }
  /** The chosen row's bone, if it is one. */
  private bone(): string | null { const p = this.host.part(); return p !== null && this.host.isBone(p) ? p : null; }
  /** The warps the chosen row can edit: a part's own and the group it is in; a bone's are the groups that cover every part on it. */
  private candidates(): DeformerDef[] {
    const ds = this.host.deformers(), part = this.part(), bone = this.bone(), shape = this.shape();
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

  /** One line for the section header: the chosen part's lattice, else how many parts have a warp. */
  summary(): string {
    const d = this.def(), all = this.host.deformers().length;
    if (d?.mesh) return `mesh ${deformerPoints(d)}`;
    if (d) { const [c, r] = deformerGrid(d); return `${Array.isArray(d.members) ? 'group ' : ''}${c}×${r}`; }
    return all ? `${all} warp${all === 1 ? '' : 's'}` : 'none';
  }

  /** The member checkboxes of a group warp: tick a part to add it (it leaves any other group), untick to take it out. */
  private showMembers(def: DeformerDef) {
    const list = this.root.querySelector<HTMLElement>('.aw-memberlist')!, members = def.members ?? [], parts = this.host.parts(), shapes = this.host.shapes();
    const sig = `${def.id}|${members.join(',')}|${parts.join(',')}|${shapes.join(',')}`;
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.replaceChildren(...[...parts, ...shapes].map(p => {
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
    this.root.querySelector<HTMLElement>('.aw-memberhint')!.textContent = `${members.length} member${members.length === 1 ? '' : 's'}; the first (${members[0]}) is the one a drag is measured in. A part or shape is in one group at most: ticking one that is in another group moves it.`;
    const issues = this.host.clipIssues().filter(i => i.group === def.id), box = this.root.querySelector<HTMLElement>('.aw-clipissues')!;
    box.replaceChildren(...issues.map(i => {
      const b = el('button', { type: 'button', className: 'aw-fixclip', textContent: `Add ${i.shape} to ${i.group}`, title: `${i.part} is bent by ${i.group} but the shape that clips it is not: the art would move and its clip stay` });
      b.addEventListener('click', () => this.host.fixClip(i));
      return el('span', { className: 'as-pivot-hint aw-clipissue' }, `${i.part} is clipped to ${i.shape}, which is not in this group. `, b);
    }));
  }

  // ---- the free mesh ----
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
    const clash = this.host.framedIn(part);
    if (clash) { this.host.note(`${part} has a frame track in ${clash}; a warped part cannot swap frames. Remove the track first.`); return; }
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
  private add() {
    const part = this.part();
    if (!part || deformerOf(this.host.deformers(), part)) return;
    const clash = this.host.framedIn(part);
    if (clash) { this.host.note(`${part} has a frame track in ${clash}; a warped part cannot swap frames. Remove the track first.`); return; }
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
    const sel = this.host.selectedParts();
    return sel.length > 1 ? { members: sel, name: sel[0] } : null;
  }
  private addGroup() {
    const seed = this.groupSeed();
    if (!seed) return;
    const clash = seed.members.map(m => ({ m, a: this.host.framedIn(m) })).find(x => x.a);
    if (clash) { this.host.note(`${clash.m} has a frame track in ${clash.a}; a warped part cannot swap frames. Remove the track first.`); return; }
    const next = addGroupDeformer(this.host.deformers(), seed.members, undefined, seed.name);
    this.selection = [];
    this.choice = next.at(-1)!.id;
    this.host.set(next);
    this.host.useTool();
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
      this.change(d => mirrorWarp(d, param, this.value(), from, only), only ? 'The partners of the chosen points already mirror them.' : from === 'left' ? 'The right half already mirrors the left.' : 'The left half already mirrors the right.');
      return;
    }
    const px = this.pixels.get(def.id);
    if (!px) { this.host.note('The stage has not measured this part yet; choose the Warp tool and try again in a moment.'); return; }
    const r = mirrorMeshWarp(def, param, this.value(), from, px, only);
    const lost = r.unpaired.length ? ` ${r.unpaired.length} vertices have no partner across the middle and were left alone (${r.unpaired.slice(0, 8).join(', ')}${r.unpaired.length > 8 ? ', …' : ''}).` : '';
    if (r.def === def) { this.host.note('The partners already mirror them.' + lost); return; }
    this.host.set(replaceDeformer(this.host.deformers(), r.def));
    if (lost) this.host.note(lost.trim());
  }
  /** Run `fn` on the chosen part's deformer as one undo step; `same` is the note when it changes nothing. */
  private change(fn: (def: DeformerDef) => DeformerDef, same: string) {
    const def = this.def(), param = this.active();
    if (!def || !param) return;
    const next = fn(def);
    if (next === def) { this.host.note(same); return; }
    this.host.set(replaceDeformer(this.host.deformers(), next));
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
      this.dragging = { base: def, param, value: this.value(), weights: softWeights(def, this.selection, this.falloffNow()), drag: this.host.drag() };
      this.show();
      return;
    }
    const d = this.dragging;
    if (!d) return;
    d.drag.put(replaceDeformer(this.host.deformers(), moveWarpPoints(d.base, d.param, d.value, d.weights, delta)));
    if (phase === 'end') { this.dragging = null; d.drag.end(); }
  }

  // ---- topology of a free mesh ----
  /** The topology tool on the stage, null outside the mode (or for a part that has no free mesh). */
  topoTool(): TopoTool | null { return this.topo && this.def()?.mesh ? this.topoPick : null; }
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
    const shape = this.shape();
    const none = !chosen ? 'Choose a part in the tree to give it a warp, or to edit the one it has.'
      : shape && !def ? `${shape} is a mask shape: it has no warp of its own. A group warp bends it when it is one of its members (tick it there), or follow a part with the Mask section.`
      : shape ? ''
      : bone && !def && !seed ? `${bone} has no parts on it to warp.`
        : bone && !def ? `${bone} is a bone. A warp belongs to a part: choose one of the parts on it, or add a group warp over all of them.`
          : !part && !bone ? '' : !params.length ? 'This rig has no parameters. A warp bends with a parameter: add "parameters" to its rig.json.' : '';
    q<HTMLElement>('.aw-none').textContent = none;
    q<HTMLElement>('.aw-none').hidden = !none;
    const add = q<HTMLElement>('.aw-add');
    add.hidden = !part || !!own;
    q<HTMLButtonElement>('.aw-addbtn').disabled = !params.length;
    q<HTMLElement>('.aw-addbtn').textContent = part ? `Add warp to ${part}` : 'Add warp';
    const gb = q<HTMLButtonElement>('.aw-groupbtn');
    q<HTMLElement>('.aw-groupadd').hidden = !seed;
    gb.disabled = !params.length;
    gb.textContent = bone ? `Add group warp from ${bone}` : `Add group warp from ${seed?.members.length ?? 0} selected parts`;
    // A row with a warp of its own and/or a group warp offers the choice between them.
    const cands = this.candidates(), targetPick = q<HTMLSelectElement>('.aw-targetpick');
    q<HTMLElement>('.aw-target').hidden = !(cands.length > 1 || (cands.length === 1 && Array.isArray(cands[0].members)));
    const count = (d: DeformerDef) => { const shapes = (d.members ?? []).filter(m => this.host.isShape(m)).length, parts = (d.members ?? []).length - shapes; return `${parts} part${parts === 1 ? '' : 's'}${shapes ? `, ${shapes} shape${shapes === 1 ? '' : 's'}` : ''}`; };
    const labels = cands.map(d => (Array.isArray(d.members) ? `group ${d.id} (${count(d)})` : `own warp ${d.id}`));
    if (targetPick.dataset.opts !== labels.join('|') + '#' + cands.map(d => d.id).join('|')) {
      targetPick.dataset.opts = labels.join('|') + '#' + cands.map(d => d.id).join('|');
      targetPick.replaceChildren(...cands.map((d, i) => el('option', { value: d.id, textContent: labels[i] })));
    }
    if (def) targetPick.value = def.id;
    q<HTMLElement>('.aw-targethint').textContent = isGroup && part ? `${part} is bent by this group's lattice after its own warp.` : isGroup && shape ? `${shape} is a mask shape: this group's lattice bends it, as it bends the parts it clips.` : '';
    const mem = q<HTMLElement>('.aw-members');
    mem.hidden = !isGroup;
    q<HTMLElement>('.aw-remove').textContent = isGroup ? 'Remove group warp' : 'Remove warp';
    if (isGroup) this.showMembers(def!);
    // The Mesh row: a part can be given a free mesh, or have its own lattice replaced or its mesh regenerated.
    const meshed = !!def?.mesh, gen = q<HTMLElement>('.aw-meshgen');
    gen.hidden = !part;
    if (part) {
      const mesh = this.generated(part), n = mesh ? mesh.verts.length / 2 : null;
      if (!this.alphas.has(part)) void this.fetchAlpha(part);
      q<HTMLSelectElement>('.aw-detail').value = this.detail;
      q<HTMLElement>('.aw-vcount').textContent = n === null ? (this.noAlpha.has(part) ? 'image unreadable' : 'reading the image…') : `${n} vertices (at most ${MESH_MAX_VERTS})`;
      const btn = q<HTMLButtonElement>('.aw-genbtn'), replacing = !!own && !own.mesh;
      btn.textContent = own?.mesh ? 'Regenerate mesh' : replacing ? 'Replace lattice with mesh' : 'Generate mesh';
      btn.disabled = !params.length || (mesh !== null && !meshUsable(mesh));
      q<HTMLElement>('.aw-genhint').textContent = own?.mesh ? 'Regenerating changes the vertices, so the mesh\'s keyforms are dropped (after asking).' : replacing ? 'Replaces the lattice and drops its keyforms (after asking).' : 'A triangle mesh that follows the part\'s outline, for a shape a lattice cannot bend.';
    }
    for (const cls of ['.aw-grid', '.aw-form', '.aw-sel', '.aw-tools', '.aw-xf', '.aw-presets']) q<HTMLElement>(cls).hidden = !def;
    // A free mesh has no lattice to resize: its summary shows in place of the grid size; the rest edits its vertices as it edits lattice points.
    q<HTMLElement>('.aw-gridname').textContent = meshed ? 'Mesh' : 'Lattice';
    q<HTMLElement>('.aw-dims').hidden = meshed;
    q<HTMLElement>('.aw-meshsum').hidden = !meshed;
    if (meshed) {
      const m = def!.mesh!;
      q<HTMLElement>('.aw-meshsum').textContent = `${deformerPoints(def!)} vertices, ${m.tris.length / 3} triangles, detail ${MESH_DETAIL_STEPS.find(d => d.id === m.detail)?.label.toLowerCase() ?? 'custom'}.`;
    }
    for (const cls of ['.aw-rowpick', '.aw-colpick']) q<HTMLElement>(cls).parentElement!.hidden = meshed;
    // Topology mode (a free mesh only): its tools replace the keyform controls while it is on.
    if (!meshed) { this.topo = false; this.anchor = null; }
    q<HTMLElement>('.aw-topo').hidden = !meshed;
    q<HTMLButtonElement>('.aw-topoon').setAttribute('aria-pressed', String(this.topo));
    q<HTMLElement>('.aw-topotools').hidden = !this.topo;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.aw-tt')) b.setAttribute('aria-pressed', String(b.dataset.tool === this.topoPick));
    q<HTMLElement>('.aw-topohint').textContent = this.topo ? TOPO_TOOLS.find(t => t.id === this.topoPick)!.hint + (def && hasKeyforms(def) ? ' Edits drop the keyforms (after asking; undo restores them). Esc cancels.' : ' Esc cancels.') : 'Edit the mesh\'s vertices and edges. This changes what the keyforms mean, so it drops them (after asking).';
    if (this.topo) for (const cls of ['.aw-form', '.aw-sel', '.aw-pt', '.aw-tools', '.aw-xf', '.aw-presets']) q<HTMLElement>(cls).hidden = true;
    q<HTMLElement>('.aw-about option[value=lattice]').textContent = meshed ? 'about the part centre' : 'about the lattice centre';
    if (!def) return;
    const note = q<HTMLElement>('.aw-active');

    note.textContent = this.param ? `Keyed to ${this.param}, the active parameter: move its slider in Parameters.` : 'Pick a slider in Parameters (click its name): the warp is keyed to the active parameter.';
    const [cols, rows] = meshed ? [0, 0] : deformerGrid(def);
    if (!meshed) for (const [cls, v] of [['.aw-cols', cols], ['.aw-rows', rows]] as const) { const i = q<HTMLInputElement>(cls); if (document.activeElement !== i) i.value = String(v); }
    const p = this.active(), sel = this.selection, many = sel.length > 1;
    const fill = (cls: string, label: string, n: number, name: string) => {
      const s = q<HTMLSelectElement>(cls);
      if (s.options.length !== n + 1 || s.dataset.n !== String(n)) { s.dataset.n = String(n); s.replaceChildren(el('option', { value: '', textContent: label }), ...Array.from({ length: n }, (_, i) => el('option', { value: String(i), textContent: `${name} ${i}` }))); }
    };
    if (!meshed) { fill('.aw-rowpick', 'row…', rows + 1, 'row'); fill('.aw-colpick', 'column…', cols + 1, 'column'); }
    q<HTMLInputElement>('.aw-soft').checked = this.soft;
    q<HTMLInputElement>('.aw-radius').disabled = q<HTMLSelectElement>('.aw-curve').disabled = !this.soft;
    if (document.activeElement !== q('.aw-radius')) q<HTMLInputElement>('.aw-radius').value = String(this.falloff.radius);
    q<HTMLElement>('.aw-selhint').textContent = sel.length ? `${sel.length} point${sel.length === 1 ? '' : 's'} chosen${this.soft ? `, soft over ${this.falloff.radius} ${meshed ? 'edges' : 'cells'}` : ''}. Drag one to move them all; Shift-click adds or removes a ${meshed ? 'vertex' : 'point'}.`
      : meshed ? 'Drag a rectangle on the stage, Shift-click vertices, or use All and Invert here.' : 'Drag a rectangle on the stage, Shift-click points, or choose rows and columns here.';
    q<HTMLButtonElement>('.aw-clear').disabled = !sel.length;
    for (const cls of ['.aw-delkey', '.aw-mirror-lr', '.aw-mirror-rl', '.aw-smooth', '.aw-preset', '.aw-amount', '.aw-write']) q<HTMLInputElement>(cls).disabled = !p;
    for (const cls of ['.aw-mirror-sel', '.aw-scale-go', '.aw-rot-go', '.aw-scale', '.aw-rot', '.aw-about']) q<HTMLInputElement>(cls).disabled = !p || !sel.length;
    q<HTMLElement>('.aw-smooth').textContent = sel.length ? 'Smooth selection' : 'Smooth';
    q<HTMLElement>('.aw-reset').textContent = many ? 'Reset points' : 'Reset point';
    const keys = q<HTMLElement>('.aw-keys');
    if (!p) { keys.replaceChildren(); q<HTMLElement>('.aw-keyhint').textContent = ''; q<HTMLElement>('.aw-pthint').textContent = ''; return; }
    const v = this.value(), at = warpKeyAt(def, p, v);
    keys.replaceChildren(...warpKeyValues(def, p.id).map(k => {
      const b = el('button', { type: 'button', className: 'aw-key', textContent: shown(k), title: `Go to the key at ${shown(k)}` });
      b.setAttribute('aria-pressed', String(k === at));
      b.addEventListener('click', () => this.host.setValue(p.id, k));
      return b;
    }));
    q<HTMLButtonElement>('.aw-delkey').disabled = at === null;
    q<HTMLElement>('.aw-keyhint').textContent = at !== null ? `On the key at ${shown(at)}: a dragged point changes it.`
      : warpKeyValues(def, p.id).length ? `No key at ${shown(v)}: dragging a point adds one there, keeping the curve as it is.` : `${p.id} has no keys on this warp yet: dragging a point makes the first, with rest at ${shown(p.default)}.`;
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
    q<HTMLButtonElement>('.aw-reset').disabled = !sel.length;
    q<HTMLElement>('.aw-pthint').textContent = !sel.length ? 'Click a point on the stage (Warp tool, D), or choose one here.'
      : n !== null ? `${meshed ? 'Vertex' : 'Point'} ${where(n)}: how far this keyform moves it, in stage units.`
        : `${sel.length} points chosen: the fields show their average; typing moves each of them by the difference.`;
    q<HTMLElement>('.aw-presethint').textContent = WARP_PRESETS.find(x => x.id === q<HTMLSelectElement>('.aw-preset').value)?.hint ?? '';
  }
}
