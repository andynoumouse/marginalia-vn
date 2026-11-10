// Animation studio: a modal over the editor that plays and edits a character's animations (its rig.json `animations`;
// the presets can be copied into editable ones) on a stage of their own, with a timeline of every channel. The stage is
// the preview page in studio mode (preview/studio.ts), embedded in an iframe and driven by postMessage. Edits go to a
// working copy; Apply hands it to the editor, which writes it to the rig.json tab in one undo step.

import { StageBridge, type StageEvent } from './anim-stage.js';
import { KeyEditor } from './anim-keys.js';
import { ParamPanel, type FormField } from './anim-params.js';
import { PosePanel } from './anim-poses.js';
import { PhysicsPanel, type Shake } from './anim-physics.js';
import { WarpPanel } from './anim-warp.js';
import { WeightsPanel } from './anim-weights.js';
import { MaskPanel } from './anim-mask.js';
import { PropBlocksPanel } from './anim-props.js';
import { removeBone, renameBone } from '../engine/src/bone-edit.js';
import { BindPanel, type BindRow, type BindVerb, type BindView, type PickItem } from './anim-bind.js';
import { ParamProps, type ParamPropsView } from './anim-param-props.js';
import { TrackEditor } from './anim-ptracks.js';
import { FrameEditor } from './anim-frames.js';
import { UndoStack } from './anim-history.js';
import { PivotPanel } from './anim-pivot.js';
import { GizmoBar } from './anim-gizmo.js';
import { studioHtml } from './studio-template.js';
import { PlacePanel } from './anim-place.js';
import { ExportDialog } from './anim-export.js';
import { ContextMenu } from './context-menu.js';
import { mountDock, type Dock } from './dock-ui.js';
import { RigTree } from './anim-tree.js';
import { ReactionPanel } from './anim-reactions.js';
import { el, layoutRows, pickEase, showEase } from './anim-dom.js';
import { choiceAsk } from './ask.js';
import { FocusKeeper, isField } from './anim-focus.js';
import { drawnRows, drawTimeline, xOf } from './anim-timeline.js';
import { followPointer } from './pointer.js';
import { wrapTab } from './modal.js';
import {
   ANCHORS, asKeys, evalAll, posedInfluences, removeBoneWeights, changedParams, deformerById, deformerOf, groupOf, membersFromBone, clipGroupIssues, addToGroup, readLayout, studioDockSpec, studioPresent, readDock, writeDock, defaultDock, isDefaultDock, dockMoveNote, type DockLayout, type DeformerDef, type ShapeDef, type ShapeSet, 
  addPad, addParam, affectedBy, afterChoosePart, breadcrumb, focusHeader, focusKind, absentByFocus, propBlocks, setView, type SetState, type SetView, subOpenKey, type PropBlockId, type PropBlocksView, type PropVerbId, type StageTool, pasteForm, type FormOpId, pointKeyStrip, addWarpKey, deleteWarpKey, ownDisplacement, pasteWarpForm, replaceDeformer, deformerPoints, warpKeyAt, WARP_KEY_SNAP, poseTarget, cycleHit, cycleLabel, goUp as focusUp, type CycleState, chooseOnStage, keepsSubject, stageMode, dialogEscape, undoInField, toolBar, modeLabel, gizmoLine, gizmoLock, keepNote, type NoteSeen, type GizmoLineState, meshPartOnBone, weightsHint, pickTargets, bindDeformer, bindMask, bindPose, boneSubtree, boundParts, copyKeys, controlOf, DEFAULT_PAD_SIZE, deleteParam, deletePad, dragForms, driverOf, isBound, keyTicks, KEY_SNAP, removeKey, unbindDeformer, unbindMask, unbindPose, warpTicks,
  type BindDoc, type BindDriver, type BindKind, type KeyTick, type PadSize, type FullForm, easeAt, extendGrid, formAt, isKeyed, setKeyEase, isPadSpot, moveControl, moveControlTo, addCategory, renameCategory, deleteCategory, moveCategory, padCorners, snapSpot, spotForm, spotLabel, updatePad, updateParam, writeForm,
  type KeyformDef, type KeySpot, type Offset, type ParamDoc, type ParamEdit, sectionOpen, withSection, rigStrip, rigStripOf, rigTabClick, withRigStrip, type RigTab, withSize, withCollapsed, dragColumn, clampLeft, clampRight, clampSplit, LEFT_WIDTH, RIGHT_WIDTH, SPLIT, type StudioSide, type StudioFold, type StudioSizes, type StudioLayout, type StudioMode, frameBlocks, frameTracks, trackOfSlot, DEFAULT_FPS, deleteParamKey, keyParams, paramKeys, sampleTrack, savePose, deletePose, trackIds, type PadDef, type ParamDef, type PoseDef, type RigPhysicsChain, type Positions, type Anchors, ANIMS, animParts, bakePreset, deleteAnim,  duplicateAnim, EASE_NAMES, KEY_CHANNELS, keysOf, newAnim, partsUnder, soloHidden, toggleHidden, renameAnim,
   setBonePivot, setDur, secondsOf, progressOf, timeLabel, retimeAnim, hasKeyTimes, describeChange, type ChangeLabel, setPivot, setPivots, uniqueName, parseCondition, setAuto, autoFields, autoFromFields, type ReactionDef, type Value, type AnimDef, type Anims, type Bones, type Looks, type KeyChannel,  type PartBones, type Pivots, type RigOutline, type StudioDoc,
} from '../engine/src/index.js';
const HISTORY = 100;
/** The tool options bar's width, in pixels, from which its widest panel (Weights in Select mode) fits on one line. */
const BAR_ONE_LINE = 780;
/** A length in seconds as the studio writes it: `1.1 s`. */
const fmt3 = (s: number) => `${+s.toFixed(3)} s`;

interface Entry { name: string; preset: boolean; def: AnimDef; dur: number }

/** The animation each character was last on (per browser; nothing when storage is blocked). */
function lastAnim(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(LAST_ANIM_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function rememberAnim(char: string, name: string) {
  try { localStorage.setItem(LAST_ANIM_KEY, JSON.stringify({ ...lastAnim(), [char]: name })); } catch { /* not kept past this page */ }
}
/**
 * What the studio opens on (SA-15, ES-14): the animation asked for (F12 on a line), else the one this character was last on, else its first
 * own animation that does not start by itself (a 0.12 s automatic blink is a poor first sight), else the first in the picker.
 */
function openingEntry(entries: readonly Entry[], asked: string | undefined, last: string | undefined): Entry | null {
  const named = (n: string | undefined) => (n === undefined ? undefined : entries.find(e => e.name === n));
  return named(asked) ?? named(last) ?? entries.find(e => !e.preset && !e.def.auto) ?? entries.find(e => !e.preset) ?? entries[0] ?? null;
}
/** What the studio edits (engine/src/studio-doc.ts): the character's `parameters`, `pads` and `keyforms`, its `animations` (with their `auto`), `pivots`, `bones` and `parts`, `reactions`, its mesh warps (`deformers`), its mask `shapes` and the `clips` of its parts to them. */
export type Snap = StudioDoc;

/** A host with no game and no editor behind it (the standalone page, editor/studio-page.ts): the studio is the whole page and Apply saves a file. */
export interface StudioStandalone {
  /** The stage page and the project it draws: `assets` carry the URL to load each file from, `rigs` the manifests (what /api/project holds in the editor). */
  stage: { url: string; project: () => StageProject };
  /** The Apply button's name and what a finished or failed Apply says. */
  save: { label: string; done: string; failed: string };
  /** Open another character; the studio then has no Close, and Esc does not leave it. */
  open: () => void;
  /** Sections this host has no use for (the script's `Place in scene`). */
  without?: string[];
}
/** What the stage page asks its host for in place of /api/project. */
export interface StageProject { assets: { file: string; v: number; url?: string }[]; rigs: Record<string, unknown>; game: Record<string, unknown> }

export interface StudioHost {
  returnFocus?: () => void;
  /** The game's named stage positions (game.json `positions` and the built-in ones), so the Place row writes `at farleft` where one fits. */
  positions?: Positions;
  /** The game's named anchors (game.json `anchors` and the built-in ones). */
  anchors?: Anchors;
  /** The character's parts (slots and plain layers; the rig.json bones come from the working copy) and the PSD canvas size, for the part list and for placing pivots. */
  parts: string[];
  /** Look names for `show` (rig.json looks, PSD variant names and tags), for dressing the character on the stage. */
  looks: string[];
  slots: Record<string, string[]>;
  width: number;
  height: number;
  /** Where a part's image box sits on the canvas, in pixels; absent when the rig cannot tell. */
  origin?: (part: string) => [number, number] | null;
  /** The parts drawn for a pose and slot variants (what the stage shows); absent when the rig cannot tell. */
  shown?: (pose: string | null, overrides: Record<string, string>) => string[];
  /** What the character is made of, dressed with a pose and slot variants, for the Parts tree. */
  outline?: (pose: string | null, overrides: Record<string, string>, looks: Looks) => RigOutline;
  /** The URL of one of the character's images (a path from sprite.json), for thumbnails. */
  image?: (file: string) => string | undefined;
  /** Write both to the character's rig.json; false when that failed (the studio then keeps its changes pending). */
  apply: (change: Snap) => boolean | Promise<boolean>;
  /** Set by a host that runs the studio without a game project. */
  standalone?: StudioStandalone;
  /** The script line the studio was opened from: the stage shows that scene's background and other characters. */
  scene?: { file: string; line: number };
  /** Set when the studio was opened from a script line: plays the game from that line once the rig.json is saved. */
  tryInScene?: () => void;
  /** Set when a script tab was in front: puts a line under the cursor line there and says where it went (for the note). */
  insertLine?: (line: string) => string;
}

export type Mode = StudioMode;
const LAYOUT_KEY = 'vn.editor.studioLayout';
const LAST_ANIM_KEY = 'vn.editor.studioLastAnim'; // the animation each character was last on, for the next opening
/** Where the author put the sections (engine/src/dock.ts); kept apart from LAYOUT_KEY, whose open/closed state and sizes it does not touch. */
/** The width of a folded side column. */
const RAIL_PX = 24;
const DOCK_KEY ='vn.editor.studioDock';

export class AnimStudio {
  private root: HTMLDivElement;
  private card: HTMLElement;
  private focus: FocusKeeper;                 // gives the focus back to a control a redraw replaced, and remembers what each field held
  private title: HTMLElement;
  private stageHost: HTMLElement;
  private picker: HTMLSelectElement;
  private menu: ContextMenu | null = null; // made on first use: the page then has a second .ctxmenu only once the picker menu was opened
  private tl: SVGSVGElement;
  private playBtn: HTMLButtonElement;
  private loopBox: HTMLInputElement;
  private slider: HTMLInputElement;
  private time: HTMLElement;
  private layout: StudioLayout = readLayout(null);
  private props!: PropBlocksPanel;                        // Model mode: the Properties sub-blocks (Transform, Clip, Variants)
  private subAuto = new Set<PropBlockId>();               // sub-blocks the tool in use opened by itself: they fold again when it is left
  private subTaken = new Set<PropBlockId>();              // sub-blocks the author folded or opened while this tool is on: left as they are
  private subTool: StageTool | null = null;              // the tool those two sets are about: choosing the same tool again (Add warp, Generate mesh) changes nothing
  private dock!: Dock;
  /** How many columns the left area has now: two while the second one holds a section. */
  private cols = 1;
  /** The author's section layout; a narrow window shows the first one meanwhile (the sections stack in one column). */
  private dockStored: DockLayout = defaultDock(studioDockSpec());
  private durInput: HTMLInputElement;
  private note: HTMLElement;
  /** The tool options bar under the tool row: the mode label and one panel per tool (docs/design/studio-inspector.md). */
  private bar!: HTMLElement;
  private tools: StudioTools;
  private keySel: HTMLSelectElement;
  private fields: Record<'t' | KeyChannel, HTMLInputElement>;
  private easeSel: HTMLSelectElement;
  private delKey: HTMLButtonElement;
  private addCh: HTMLSelectElement;
  private addBtn: HTMLButtonElement;
  private stage: StageBridge;
  private exportBtn: HTMLButtonElement;
  private exporter: ExportDialog;
  private params: ParamPanel;
  private posePanel?: PosePanel;
  private physicsPanel: PhysicsPanel;
  private warpPanel: WarpPanel;
  private weightsPanel: WeightsPanel;
  private alphaSeq = 0;
  private alphaWaits = new Map<number, (r: { w: number; h: number; alpha: Uint8Array } | null) => void>();
  private maskPanel: MaskPanel;
  private ptracks: TrackEditor;
  private frames: FrameEditor;
  private parameters: ParamDef[] = [];       // rig.json `parameters`, `pads` and `keyforms`: Model mode authors them
  private pads: PadDef[] = [];
  private categories: string[] = [];          // rig.json `categories`: the Parameters section's groups, in order
  private keyforms: KeyformDef[] = [];
  /** The run of stage clicks on one spot that is walking through overlapping parts (Model). */
  private cycle: CycleState | null = null;
  /** The verb waiting for its target (Model): "Bind parts…" takes clicks on parts, "Bind to parameter…" a click on a parameter's name. Esc and Done end it. */
  private rigSent = '';                       // what the stage was last told of them
  private builtParams = '';                   // the parameters and pads the Parameters section was built for
  private revision = 0;                       // counts changes of the working copy, so a note about the last one can go stale
  private noteSeen: NoteSeen = { ctx: '', text: '' }; // the status note at the last showStatus, and what it was about
  private activeControl: string | null = null; // the active parameter, the one a gizmo drag writes the keyform of: a parameter id or `pad:<id>`; null until the author picks one
  private bindSize: PadSize = DEFAULT_PAD_SIZE;   // the grid a part gets when it is bound to a pad (Model mode)
  /** Model mode: what Copy form keeps for Paste form (the studio's own clipboard): a pose, or a warp keyform's shape (every point's move). */
  private formClip: { kind: 'pose'; form: FullForm; label: string } | { kind: 'warp'; disp: number[]; label: string } | null = null;
  private paramProps!: ParamProps;                 // Model mode: the Parameter section, a parameter alone in focus
  private shownKind = '';                          // the focus kind the right column's sections were last shown for
  private binder: BindPanel;
  private poses: Record<string, PoseDef> = {};   // rig.json `poses`
  private physics: Record<string, RigPhysicsChain> = {}; // rig.json `physics`
  private deformers: DeformerDef[] = [];      // rig.json `deformers`
  private deformersSent = '';                 // what the stage was last told, so an edit elsewhere does not repeat it
  private warpSent = '';
  private weightsSent = '';
  private shapes: Record<string, ShapeDef> = {}; // rig.json shape parts: the mask shapes (imageless parts with a polygon)
  private clips: Record<string, string> = {};    // the `clip` link of each clipped part: a shape or another part
  private masksSent = '';
  private maskSent = '';
  private host: StudioHost = { parts: [], looks: [], slots: {}, width: 0, height: 0, apply: () => false };
  private char = '';
  private anims: Anims = {};
  private pivots: Pivots = {};
  private bones: Bones = {};             // rig.json `bones`, and `parts` (which bone each part sits on)
  private partBones: PartBones = {};
  private looks: Looks = {};              // rig.json `looks`
  private reactions: ReactionDef[] = [];  // rig.json `reactions`
  private testVars: Record<string, Value> = {}; // the Test variables of Model mode: studio-only, not in the undo history, never saved
  private reactionPanel: ReactionPanel;
  private automatic: { row: HTMLElement; min: HTMLInputElement; max: HTMLInputElement; when: HTMLInputElement };
  private pose: string | null = null;     // how the stage dresses the character (not saved anywhere)
  private overrides: Record<string, string> = {};
  private picking = false;                // the stage waits for a click that places the pivot of `part`
  private pivotPanel: PivotPanel;
  private tree: RigTree;
  private hidden: string[] = [];        // parts and bones hidden on the stage, for this session (never saved, kept across animations and modes)
  private hiddenSent = '';
  private focusSent: string | null | undefined; // the part the stage was last told to bring forward
  private placer: PlacePanel;
  private gizmo: GizmoBar;
  private dragFrom: Snap | null = null;   // the working copy before a pivot drag on the stage began
  private baseline = '';
  private history = new UndoStack<Snap, ChangeLabel>(HISTORY);
  private entries: Entry[] = [];
  private cur: Entry | null = null;
  private part: string | null = null;
  private extras = new Set<string>();         // Model mode: parts added to `part` with Ctrl-click; a pick binds them and a drag poses them all by the same delta
  private keys: KeyEditor;
  private ranges: Record<KeyChannel, number> = { x: 1, y: 1, scale: 1, rot: 1, opacity: 1 };
  private t = 0;
  private playing = false;
  private playLines: SVGLineElement[] = [];
  private ruler!: SVGSVGElement;
  private presetNote = false;  // the note says what a preset is
  private closeWarned = false; // Close was pressed with unapplied changes; the next press discards them

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'animStudio';
    this.root.hidden = true;
    this.root.innerHTML = studioHtml();
    layoutRows(this.root);
    host.append(this.root);
    const q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.card = q('.as-card');
    this.focus = new FocusKeeper(this.root, this.card);
    this.title = q('header strong');
    this.stageHost = q('.as-stage');
    this.stage = new StageBridge(this.stageHost, e => this.onStage(e));
    this.picker = q('.as-anim');
    this.tl = q('.as-timeline');
    this.ruler = q('.as-ruler');
    this.playBtn = q('.as-play');
    this.loopBox = q('.as-loop');
    this.slider = q('.as-slider');
    this.time = q('.as-time');
    this.durInput = q('.as-dur');
    this.note = q('.as-note');
    // The status line is one line: what it says in full is its tooltip.
    new MutationObserver(() => { this.note.title = this.note.textContent || this.note.dataset.hint || ''; this.checkNote(); })
      .observe(this.note, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-hint'] });
    this.keySel = q('.as-key');
    this.easeSel = q('.as-ease');
    this.delKey = q('.as-delkey');
    this.addCh = q('.as-addch');
    this.addBtn = q('.as-addkey');
    this.exportBtn = q('[data-t="export"]');
    this.tools = Object.fromEntries(['undo', 'redo', 'apply', 'scene', 'open', 'resetdock'].map(n => [n, q<HTMLButtonElement>(`[data-t="${n}"]`)])) as StudioTools;
    this.fields = Object.fromEntries(['t', ...KEY_CHANNELS].map(n => [n, q<HTMLInputElement>(`[data-f="${n}"]`)])) as Record<'t' | KeyChannel, HTMLInputElement>;
    this.bar = q('.as-toolbar');
    // One line when the widest panel fits (Weights in Select mode), else two, by the bar's width and never by the tool, so a W / B switch never moves the stage.
    new ResizeObserver(() => { const rows = this.bar.clientWidth < BAR_ONE_LINE ? '2' : '1'; if (this.bar.dataset.rows !== rows) this.bar.dataset.rows = rows; }).observe(this.bar);
    this.pivotPanel = new PivotPanel(q('.as-pivot'), q('.atb[data-bar="pivot"]'), {
      state: () => ({ part: this.part !== null && Object.hasOwn(this.shapes, this.part) ? null : this.part, at: this.selPivot(), isBone: this.selIsBone(this.part), picking: this.picking, pivots: this.pivots, parts: this.host.parts, set: this.setFields() }),
      setPivot: at => this.edit(() => this.setSelPivot(at)),
      clear: () => { this.setPicking(false); this.edit(() => this.setSelPivot(null)); },
      share: (part, at) => {
        this.edit(() => { this.pivots = setPivots(this.pivots, [part], at); });
        this.note.textContent = at ? `${part} turns about the same pivot as ${this.part} now. Ctrl+Z undoes it.` : `${part} has no pivot of its own now: it turns about the middle of its image.`;
      },
    });
    this.props = new PropBlocksPanel(q('.as-subs'), {
      view: () => this.propsView(),
      isOpen: id => this.isSectionOpen(subOpenKey(id)),
      toggle: id => { this.subAuto.delete(id); this.subTaken.add(id); this.setSubOpen(id, !this.isSectionOpen(subOpenKey(id))); this.props.show(); },
      verb: id => this.propVerb(id),
    });
    this.tree = new RigTree({ tree: q('.as-tree'), detail: q('.as-detail'), looks: q('.as-looks'), transform: q('.as-tf'), variants: q('.as-vars') }, {
      state: () => ({ char: this.char, mode: this.mode, pose: this.pose, overrides: this.overrides, looks: this.looks, bones: this.bones, partBones: this.partBones, shapes: this.shapes, clips: this.clips, part: this.part, anim: this.cur ? { name: this.cur.name, def: this.cur.def } : null, bind: this.treeBind(), hidden: this.hidden, extras: [...this.extras], set: this.setFields() }),
      outline: (pose, overrides, looks) => this.host.outline?.(pose, overrides, looks),
      image: file => this.host.image?.(file),
      change: patch => this.edit(() => {
        // A bone that leaves the rig gives the weights of the skinned meshes on it to its parent, in the same undo step.
        if (patch.bones) for (const gone of Object.keys(this.bones).filter(b => !Object.hasOwn(patch.bones!, b))) {
          const up = this.bones[gone].parent;
          this.deformers = removeBoneWeights(this.deformers, gone, typeof up === 'string' && up !== gone && Object.hasOwn(this.bones, up) ? up : null);
        }
        if (patch.bones) this.bones = patch.bones;
        if (patch.parts) this.partBones = patch.parts;
        if (patch.looks) this.looks = patch.looks;
        if (patch.part !== undefined) this.part = patch.part;
      }),
      renameBone: (from, to) => {
        const r = renameBone({ bones: this.bones, parts: this.partBones, shapes: this.shapes, keyforms: this.keyforms, anims: this.anims, deformers: this.deformers, physics: this.physics }, from, to, this.host.parts);
        if ('error' in r) { this.note.textContent = r.error; return; }
        if (this.gizmo.hasPending) this.gizmo.clearPending(); // an unkeyed drag under the old name would key a bone that is gone
        this.edit(() => {
          const d = r.doc;
          this.bones = d.bones; this.partBones = d.parts; this.shapes = d.shapes; this.keyforms = d.keyforms; this.anims = d.anims; this.deformers = d.deformers; this.physics = d.physics;
          // The studio's own state follows too: the chosen row, the extra rows and the hidden ones.
          if (this.part === from) this.part = r.name;
          this.extras = new Set([...this.extras].map(p => (p === from ? r.name : p)));
          this.hidden = this.hidden.map(h => (h === from ? r.name : h));
        });
        this.note.textContent = r.note;
      },
      choosePart: (part, add, subtree) => {
        if (add) this.toggleExtra(part); else this.choosePart(part);
      },
      toggleHidden: (name, solo) => {
        const members = (n: string) => (Object.hasOwn(this.bones, n) && !this.host.parts.includes(n) ? partsUnder(this.bones, Object.fromEntries(Object.entries(this.partBones).map(([p, d]) => [p, d?.bone])), n) : [n]);
        this.hidden = solo ? soloHidden(this.hidden, this.host.parts, members(name)) : toggleHidden(this.hidden, name);
        this.tree.show();
        this.sendHidden();
      },
      showAll: () => { this.hidden = []; this.tree.show(); this.sendHidden(); },
      toggleVariant: (slot, variant) => {
        // A variant sets the slot on the stage; clicking the one set here again goes back to what the look picks.
        const { [slot]: was, ...rest } = this.overrides;
        this.overrides = was === variant ? rest : { ...rest, [slot]: variant };
        this.dressStage();
        this.refreshView();
      },
      pickLook: pose => {
        this.pose = pose;
        this.overrides = {};
        this.dressStage();
        this.refreshView();
        this.placer.show();
      },
      selIsBone: name => this.selIsBone(name),
      note: text => { this.note.textContent = text; },
    });
    this.gizmo = new GizmoBar(this.root, {
      mode: () => this.mode,
      part: () => this.part,
      t: () => this.t,
      anim: () => (this.cur ? { name: this.cur.name, def: this.cur.def, preset: this.cur.preset, dur: this.cur.dur } : null),
      post: msg => this.post(msg),
      note: text => { this.note.textContent = text; },
      edit: fn => this.edit(fn),
      setAnim: (name, def) => { this.anims[name] = def; },
      subject: () => this.gizmoSubject(),
      locked: () => gizmoLock(this.gizmoState()) !== null,
      toolChanged: () => {
        if (this.mode === 'model') this.setPicking(this.gizmo.tool === 'pivot');
        // B with a bone chosen: the tool wants a part with a mesh, so the first one on the bone is chosen, and the line says which.
        if (this.gizmo.tool === 'weights' && this.modeling && this.selIsBone(this.part)) {
          const bone = this.part, part = meshPartOnBone(bone, this.host.parts, p => this.partBones[p]?.bone, p => !!deformerOf(this.deformers, p)?.mesh);
          if (part !== null) { this.choosePart(part); this.note.textContent = `${part} is chosen for the Weights tool: the first part on ${bone} with a mesh.`; }
        }
        // A tool opens the Properties sub-blocks it has a next step in (showProps); leaving it folds the ones it opened (not the ones the author
        // opened or folded meanwhile), so the column does not pile up.
        if (this.gizmo.tool !== this.subTool) { this.subTool = this.gizmo.tool; this.foldAutoSubs(); }
        // A bar control with the focus goes with the old tool's panel: the focus goes to the pressed tool button, not to the page.
        const inBar = this.bar.contains(document.activeElement);
        this.showStatus();
        this.warpPanel.show();
        this.weightsPanel.show();
        this.maskPanel.show();
        this.postWarp();
        this.postWeights();
        this.postMask();
        if (this.modeling) { this.tree.show(); this.binder.show(); this.showProps(); }
        if (inBar && !this.bar.querySelector('.atb:not([hidden]) :focus')) this.root.querySelector<HTMLElement>(`.as-gizmo [data-gz="${this.gizmo.tool}"]`)?.focus({ preventScroll: true });
      },
      autoChanged: () => this.showStatus(), // the bar and the hint say whether a drag keys
      keyformDrag: (name, _tool, delta) => this.keyformDrag(name, delta),
      undo: () => this.undo(),
      redo: () => this.redo(),
      weights: () => this.weightsPanel.poseGizmo(),
      posed: () => this.weightsPanel.show(),
    });
    this.automatic = { row: q('.as-automatic'), min: q('.as-every-min'), max: q('.as-every-max'), when: q('.as-while') };
    this.placer = new PlacePanel(this.root, {
      studio: () => this.host,
      dress: () => ({ char: this.char, pose: this.pose, overrides: this.overrides }),
      post: msg => this.post(msg),
      note: text => { this.note.textContent = text; },
      stopPicking: () => { if (this.picking) this.setPicking(false); },
    });
    const setAutomatic = () => {
      const c = this.cur, a = this.automatic;
      if (!c || c.preset) return;
      const num = (v: string) => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null; };
      const lo = num(a.min.value), hi = num(a.max.value);
      if (lo !== null && hi !== null && hi < lo) { this.showAuto(); this.note.textContent = 'Automatic "every" needs the first number to be the smaller.'; return; }
      const text = a.when.value.trim();
      if (text && !parseCondition(text)) { this.showAuto(); this.note.textContent = `"${text}" is not a valid condition (an expression such as speaking or mood > 2).`; return; }
      this.edit(() => { this.anims[c.name] = setAuto(c.def, autoFromFields(lo, hi, text)); });
    };
    for (const box of [this.automatic.min, this.automatic.max, this.automatic.when]) box.addEventListener('change', setAutomatic);
    this.reactionPanel = new ReactionPanel(q('.ar'), {
      reactions: () => this.reactions,
      poses: () => Object.keys(this.poses),
      editable: () => this.editable(),
      note: text => { this.note.textContent = text; },
      setReactions: list => this.edit(() => { this.reactions = list; }),
      vars: () => this.testVars,
      setVars: vars => { this.testVars = vars; this.reactionPanel.sync(); this.postAuto(); },
    });
    this.easeSel.append(el('option', { value: '', textContent: `(default: inout)` }), ...EASE_NAMES.map(n => el('option', { value: n, textContent: n })));
    this.addCh.append(...KEY_CHANNELS.map(c => el('option', { value: c, textContent: c })));

    this.root.addEventListener('mousedown', e => { if (e.target === this.root && !this.host.standalone) this.close(); });
    q('.close').addEventListener('click', () => this.close());
    this.tools.open.addEventListener('click', () => this.host.standalone?.open());
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.as-modes button')) b.addEventListener('click', () => this.setMode(b.dataset.mode as Mode));
    for (const head of this.root.querySelectorAll<HTMLButtonElement>('.as-sect-head')) head.addEventListener('click', () => this.toggleSection(head.closest<HTMLElement>('.as-sect')!.dataset.sect!));
    for (const grip of this.root.querySelectorAll<HTMLElement>('.as-grip')) this.gripEvents(grip);
    this.wireRig();
    for (const rail of this.root.querySelectorAll<HTMLElement>('.as-rail')) rail.addEventListener('click', () => this.setCollapsed(rail.dataset.rail as StudioSide, false));
    this.root.querySelector('.as-tlfold')!.addEventListener('click', () => this.setCollapsed('timeline', !this.layout.collapsed?.timeline));
    this.picker.addEventListener('change', () => this.select(this.entries.find(e => e.name === this.picker.value) ?? null));
    q<HTMLButtonElement>('.as-more').addEventListener('click', e => this.animationMenu(e));
    this.params = new ParamPanel(q('.ap'), {
      defs: () => this.parameters,
      pads: () => this.pads,
      anim: () => (this.mode === 'animate' ? this.cur?.def ?? null : null), // Model mode shows the model, not an animation
      editable: () => this.editable(),
      keying: () => this.mode === 'animate',
      authoring: () => this.modeling,
      synced: () => { this.binder.show(); this.posePanel?.sync(); },
      keyedControl: () => this.keyedControl(),
      chooseControl: control => this.chooseControl(control),
      ticks: id => this.ticksOf(id),
      corners: (x, y) => this.cornersOf(x, y),
      isKeyed: spot => { const p = this.keyedSpotIs(spot) ? this.gizmoSubject() : this.part; return p ? isKeyed(this.keyforms, this.parameters, p, spot) : null; },
      keyFromControl: (control, spot) => this.keyFromControl(control, spot),
      addGridLine: (params, axis, value) => this.addGridLine(params, axis, value),
      categories: () => this.categories,
      addCategory: () => this.editParams(addCategory(this.paramDoc())),
      renameCategory: (from, to) => this.editParams(renameCategory(this.paramDoc(), from, to)),
      deleteCategory: name => { this.editParams(deleteCategory(this.paramDoc(), name)); },
      moveCategory: (name, before) => { this.editParams(moveCategory(this.paramDoc(), name, before)); },
      moveControlTo: (control, category, before) => { this.editParams(moveControlTo(this.paramDoc(), control, category, before)); },
      addParam: category => this.editParams(addParam(this.paramDoc(), category)),
      addPad: (category, spec) => this.editParams(addPad(this.paramDoc(), category, spec)),
      deleteParam: id => { this.editParams(deleteParam(this.paramDoc(), id)); },
      deletePad: id => { this.editParams(deletePad(this.paramDoc(), id)); },
      created: () => { this.openSection('param'); this.paramProps.show(); this.paramProps.focusName(); },
      time: () => this.t,
      poses: () => this.poses,
      moved: () => { this.sendParams(); this.showRestNote(); this.warpPanel.show(); },
      key: values => {
        const c = this.cur;
        if (!c || c.preset) { this.note.textContent = 'A preset cannot be keyed. Press "Edit copy" first.'; return; }
        this.edit(() => { this.anims[c.name] = keyParams(c.def, values, this.t); });
      },
      note: text => { this.note.textContent = text; },
    });
    this.posePanel = new PosePanel(q('.apo'), this.params, {
      defs: () => this.parameters,
      poses: () => this.poses,
      editable: () => this.editable(),
      keying: () => this.mode === 'animate',
      note: text => { this.note.textContent = text; },
      savePose: (name, values) => this.savePoseNamed(name, values),
      deletePose: name => {
        this.edit(() => { this.poses = deletePose(this.poses, name); });
        return `Deleted pose "${name}".`;
      },
    });
    q<HTMLButtonElement>('.ap-add').addEventListener('click', e => (this.menu ??= new ContextMenu(this.root)).open(e, e.currentTarget as HTMLElement, [
      { label: 'New parameter', title: 'Add a parameter (a slider)', run: () => this.params.add('param') },
      { label: 'New pad', title: 'Add a pad: two parameters on one 2D control', run: () => this.params.add('pad') },
      null,
      { label: 'New category', title: 'Add an empty category to drag parameters into', run: () => { this.openSection('params'); this.params.addCategory(); } },
    ]));
    this.paramProps = new ParamProps(q('.apm'), {
      view: () => this.paramPropsView(),
      categories: () => this.categories,
      editParam: (id, patch) => this.editParams(updateParam(this.paramDoc(), id, patch), id),
      editPad: (id, patch) => this.editParams(updatePad(this.paramDoc(), id, patch), id, 'pad:'),
      deleteParam: id => { this.editParams(deleteParam(this.paramDoc(), id)); },
      deletePad: id => { this.editParams(deletePad(this.paramDoc(), id)); },
      moveControl: (control, dir) => { this.editParams(moveControl(this.paramDoc(), control, dir)); },
      choose: control => this.chooseControl(control),
    });
    this.binder = new BindPanel(q('.ab'), q('.as-focus'), {
      view: () => this.bindView(),
      focus: (target, kind) => this.focusBound(target, kind),
      unbind: (target, kind) => this.unbindPart(target, kind),
      candidates: verb => this.pickCandidates(verb),
      commit: (verb, ids, subtree) => this.commitPick(verb, ids, subtree),
      setSize: size => { this.bindSize = size; this.binder.show(); },
      jump: at => { const d = this.driver(); if (d && 'param' in d) this.params.setValue(d.param, at); },
      keyHere: () => this.toggleKey(this.keyedSpot()),
      setField: (field, value) => this.setField(field, value),
      formOp: id => this.formOp(id),
      setEase: ease => this.setEase(ease),
      activate: control => this.chooseControl(control),
      goUp: to => this.goUp(to),
      copyKeys: (from, control, how) => this.copyKeysFrom(from, control, how),
    });
    this.warpPanel = new WarpPanel(q('.aw'), this.props.pickSlot('deform'), q('.atb[data-bar="warp"]'), q('.ab-points'), {
      part: () => this.part,
      previewMesh: p => this.post({ type: 'studioMeshPreview', part: p?.part ?? null, verts: p?.verts ?? [], tris: p?.tris ?? [] }),
      activeParam: () => { const d = this.driver(); return d && 'param' in d ? d.param : null; },
      isPart: name => this.host.parts.includes(name),
      isBone: name => this.selIsBone(name),
      posedInfluences: def => (def.mesh ? posedInfluences(def.mesh, this.bones, evalAll(this.keyforms, this.params.values())) : []),
      parts: () => this.host.parts,
      isShape: name => Object.hasOwn(this.shapes, name),
      shapes: () => Object.keys(this.shapes),
      selectedParts: () => { const on = new Set([this.part, ...this.extras]); return [...this.host.parts, ...Object.keys(this.shapes)].filter(p => on.has(p)); },
      setParts: () => this.setParts(),
      clipIssues: () => clipGroupIssues(this.shapeSet()),
      fixClip: issue => this.edit(() => { this.deformers = addToGroup(this.deformers, issue.group, issue.shape); }),
      bonePartsOf: bone => membersFromBone(this.bones, this.partBones, bone, this.shapes),
      boneOf: part => this.partBones[part]?.bone ?? this.shapes[part]?.bone,
      deformers: () => this.deformers,
      params: () => this.parameters,
      values: () => this.params.values(),
      setValue: (id, v) => this.params.setValue(id, v),
      set: next => this.edit(() => { this.deformers = next; }),
      drag: () => {
        // The stage shows each step as it goes; the release makes the whole drag one undo step.
        const before = this.snap();
        return {
          put: next => { this.deformers = next; this.closeWarned = false; this.postDeformers(); this.tools.apply.disabled = !this.dirty; this.warpPanel.show(); this.binder.show(); }, // Keyforms' key strip follows the drag
          end: () => { if (!this.commit(before)) this.refreshView(); },
        };
      },
      useTool: () => this.gizmo.setTool('warp'),
      selected: () => { this.postWarp(); this.binder.show(); this.showProps(); }, // Keyforms' Reset counts the chosen points; Deform's line follows the Target ▾
      partAlpha: part => this.requestAlpha(part),
      framedIn: part => Object.entries(this.anims).find(([, a]) => frameTracks(a?.frames).some(f => f.slot === part))?.[0] ?? null,
      note: text => { this.note.textContent = text; },
    });
    this.weightsPanel = new WeightsPanel(q('.aww'), this.props.pickSlot('skin'), q('.atb[data-bar="weights"]'), {
      part: () => this.part,
      isPart: name => this.host.parts.includes(name),
      deformers: () => this.deformers,
      drag: () => {
        // The stage shows each dab as it goes; the release makes the whole stroke one undo step.
        const before = this.snap();
        return {
          put: next => { this.deformers = next; this.closeWarned = false; this.postDeformers(); this.tools.apply.disabled = !this.dirty; this.weightsPanel.show(); this.postWeights(); },
          end: () => { if (!this.commit(before)) this.refreshView(); },
        };
      },
      bones: () => this.bones,
      boneOf: part => this.partBones[part]?.bone,
      canvas: () => [this.host.width, this.host.height],
      origin: part => this.host.origin?.(part) ?? null,
      set: next => this.edit(() => { this.deformers = next; }),
      useTool: () => this.gizmo.setTool('weights'),
      toolOn: () => this.modeling && this.gizmo.tool === 'weights',
      changed: () => { this.postWeights(); this.gizmo.send(); this.showStatus(); this.showProps(); }, // Skin's line follows a bind, and opens in Read weights
      posed: () => this.gizmo.hasPending,
      resetPose: () => this.gizmo.clearPending(),
      poseChanged: () => { this.gizmo.send(); this.postWeights(); },
      note: text => { this.note.textContent = text; },
    });
    this.maskPanel = new MaskPanel(q('.am'), this.props.pickSlot('clip'), q('.atb[data-bar="mask"]'), {
      part: () => this.part,
      setParts: () => this.setParts(),
      isPart: name => this.host.parts.includes(name),
      isShape: name => Object.hasOwn(this.shapes, name),
      parts: () => this.host.parts,
      bones: () => Object.keys(this.bones),
      boneOf: part => this.partBones[part]?.bone,
      shapes: () => this.shapes,
      clips: () => this.clips,
      deformers: () => this.deformers,
      params: () => this.parameters,
      set: (next, choose) => this.edit(() => {
        this.shapes = next.shapes; this.clips = next.clips; this.deformers = next.deformers;
        if (choose !== undefined) { this.part = choose; this.extras.clear(); }
      }),
      drag: () => {
        // The stage shows each step as it goes; the release makes the whole drag one undo step.
        const before = this.snap();
        return {
          put: next => { this.shapes = next; this.closeWarned = false; this.postMasks(); this.tools.apply.disabled = !this.dirty; this.maskPanel.show(); },
          end: () => { if (!this.commit(before)) this.refreshView(); },
        };
      },
      useTool: () => this.gizmo.setTool('mask'),
      toolOn: () => this.gizmo.tool === 'mask',
      selected: () => this.postMask(),
      note: text => { this.note.textContent = text; },
    });
    this.physicsPanel = new PhysicsPanel(q('.ph'), {
      chains: () => this.physics,
      set: (next, note) => { this.edit(() => { this.physics = next; }); this.note.textContent = note; },
      params: () => this.parameters,
      targets: () => [...(this.host.parts ?? []), ...Object.keys(this.bones)],
      editable: () => true, // the chains belong to the rig, not to the animation on show
      shake: drive => this.shake(drive),
      note: text => { this.note.textContent = text; },
    });
    this.ptracks = new TrackEditor({
      ...this.timelineHost(),
      lanes: () => this.trackLanes().map(({ id, min, max }) => ({ id, min, max })),
    });
    this.frames = new FrameEditor({
      ...this.timelineHost(),
      slots: () => this.host.slots,
      rows: () => this.frameRows().map(r => r.slot),
    });
    const af = (cls: string) => this.root.querySelector<any>('.af-' + cls)!;
    af('fill').addEventListener('click', () => void this.frames.fillFromSlot(af('slot').value, Math.max(1, Number(af('fps').value) || DEFAULT_FPS)));
    af('remove').addEventListener('click', () => this.frames.removeTrack(af('slot').value));
    af('dup').addEventListener('click', () => this.frames.duplicate());
    af('earlier').addEventListener('click', () => this.frames.reorder(-1));
    af('later').addEventListener('click', () => this.frames.reorder(1));
    af('del').addEventListener('click', () => this.frames.deleteSelected());
    af('frame').addEventListener('change', () => this.frames.setFrame(af('frame').value));
    // Times are typed in seconds; the animation keeps them as fractions of its length (time-units.md).
    af('t').addEventListener('change', () => { const v = Number(af('t').value); if (af('t').value !== '' && Number.isFinite(v)) this.frames.setTime(progressOf(v, this.cur?.dur ?? 1)); else this.refreshView(); });
    this.root.querySelector('.ap-ease')!.append(el('option', { value: '', textContent: '(default: inout)' }), ...EASE_NAMES.map(n => el('option', { value: n, textContent: n })));
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-pk]')) input.addEventListener('change', () => {
      const v = Number(input.value);
      if (input.value !== '' && Number.isFinite(v)) this.ptracks.patchSelected(input.dataset.pk === 't' ? { t: progressOf(v, this.cur?.dur ?? 1) } : { v });
      else this.refreshView();
    });
    this.root.querySelector('.ap-ease')!.addEventListener('change', async e => { const ease = await pickEase(e.target as HTMLSelectElement); if (ease !== null) this.ptracks.patchSelected({ ease: ease || undefined }); });
    this.root.querySelector('.ap-delkey')!.addEventListener('click', () => {
      const c = this.cur, sel = this.ptracks.sel;
      if (!c || c.preset || !sel) return;
      this.edit(() => { this.anims[c.name] = deleteParamKey(c.def, sel.id, sel.index); this.ptracks.sel = null; });
    });
    try { this.layout = readLayout(localStorage.getItem(LAYOUT_KEY)); } catch { /* storage blocked: the defaults */ }
    this.applySizes();
    this.mountDock();
    this.setMode('animate');
    // A click on a key opens the section that edits it.
    this.tl.addEventListener('pointerdown', e => { const hit = e.target as Element; if (hit.closest('[data-key]')) this.openSection('sel'); else if (hit.closest('[data-fkey]')) this.openSection('frames'); else if (hit.closest('[data-pkey]')) this.openSection('sel'); });
    this.wireTransport();
    this.exporter = new ExportDialog(this.root, {
      post: msg => this.post(msg),
      anim: () => (this.cur ? { name: this.cur.name, dur: this.cur.dur } : null),
      char: () => this.char,
      hasPhysics: () => Object.keys(this.physics).length > 0,
      begin: () => { if (this.playing) this.pause(); },
      end: () => this.seek(this.t), // the stage shows the playhead again
      note: text => { this.note.textContent = text; },
      returnFocus: () => this.exportBtn.focus(),
    });
    this.exportBtn.addEventListener('click', () => this.exporter.open());
    this.wireKeyControls();

    this.keys = new KeyEditor({
      ...this.timelineHost(),
      part: () => this.part,
      time: () => this.t,
      addChannel: () => this.addCh.value as KeyChannel,
      ranges: () => this.ranges,
    });
    this.root.addEventListener('keydown', e => this.onKeydown(e));
    new ResizeObserver(() => { if (!this.root.hidden) this.drawTimeline(); }).observe(this.tl);
  }

  /** What the timeline's editors (keys, parameter tracks, frames) share of the studio; a drag is one undo step. */
  private timelineHost() {
    return {
      tl: this.tl,
      current: () => this.cur,
      editable: () => this.editable(),
      setAnim: (name: string, def: AnimDef) => { this.anims[name] = def; },
      edit: (fn: () => void) => this.edit(fn),
      dragStep: (name: string, def: AnimDef) => {
        this.anims[name] = def;
        this.rebuild();
        this.cur = this.entries.find(en => en.name === name) ?? this.cur;
        this.post({ type: 'studioAnims', anims: this.anims });
        this.postAuto();
        this.refreshView();
      },
      beginDrag: () => {
        const before = this.snap();
        return () => { if (!this.commit(before)) this.refreshView(); };
      },
      seek: (t: number) => this.seek(t),
      refreshView: () => this.refreshView(),
      note: (text: string) => { this.note.textContent = text; },
    };
  }

  /**
   * A new Length for the animation on show. With keys, the studio asks whether they stretch with it (each keeps its place in the animation,
   * as when a script plays it at another length) or keep their times (the new length adds or trims time at the end). Cancel puts the old
   * Length back. One undo step either way (time-units.md).
   */
  private async changeLength(to: number) {
    const c = this.cur;
    if (!c || c.preset) return;
    const from = c.dur;
    if (!(to > 0)) { this.edit(() => { this.anims[c.name] = setDur(c.def, to); }); return; } // cleared: back to the 1 s default, as before
    if (to === from) return;
    let choice: number | null = 0;
    const kept = retimeAnim(c.def, from, to);
    if (hasKeyTimes(c.def)) {
      const lost = kept.dropped ? `\n\nKeeping their times removes ${kept.dropped} key${kept.dropped === 1 ? '' : 's'} after ${fmt3(to)}.` : '';
      choice = await choiceAsk(`${c.name} goes from ${fmt3(from)} to ${fmt3(to)}. Stretch its keys with it (each stays at the same point of the animation, as a script playing it at another length does), or keep their times (the new length adds or trims time at the end)?${lost}`,
        ['Stretch keys', 'Keep key times']);
    }
    if (choice === null || this.cur?.name !== c.name || this.anims[c.name] !== c.def) { this.refreshView(); return; } // cancelled, or the animation changed meanwhile
    this.edit(() => { this.anims[c.name] = choice === 1 ? kept.def : setDur(c.def, to); });
    this.note.textContent = choice === 1
      ? `${c.name} is ${fmt3(to)} long; its keys kept their times${kept.dropped ? ` (${kept.dropped} past the end removed; Ctrl+Z brings them back)` : ''}.`
      : `${c.name} is ${fmt3(to)} long; its keys stretched with it.`;
  }

  /** Play, scrub, duration, undo, redo, Apply and Try in the scene. */
  private wireTransport() {
    this.playBtn.addEventListener('click', () => this.toggle());
    this.slider.addEventListener('input', () => this.seek(Number(this.slider.value) / 1000));
    this.loopBox.addEventListener('change', () => { if (this.playing) this.play(); });
    this.durInput.addEventListener('change', () => void this.changeLength(Number(this.durInput.value)));
    this.tools.undo.addEventListener('click', () => this.undo());
    this.tools.redo.addEventListener('click', () => this.redo());
    this.tools.apply.addEventListener('click', () => void this.apply());
    this.tools.scene.addEventListener('click', () => this.tryInScene());
  }

  /** The key selector, the key fields, the ease select and the add and delete buttons of the timeline. */
  private wireKeyControls() {
    this.keySel.addEventListener('change', () => { this.keys.sel = this.keySel.value === '' ? null : Number(this.keySel.value); this.refreshView(); });
    for (const [name, input] of Object.entries(this.fields)) input.addEventListener('change', () => this.keys.fieldChanged(name as 't' | KeyChannel, input.value));
    this.easeSel.addEventListener('change', async () => { const ease = await pickEase(this.easeSel); if (ease !== null) this.keys.patchSelected({ ease: ease || undefined }); });
    this.delKey.addEventListener('click', () => this.keys.removeSelected());
    this.addBtn.addEventListener('click', () => this.keys.addAtPlayhead());
  }

  /**
   * Esc puts back a typed edit, then hands a deform tool's Esc to the stage (clear the selection, back to Move), then closes; Tab stays in
   * the dialog; a letter picks a gizmo; Ctrl+Z and Ctrl+Y undo and redo (in a field with a typed edit, the typing); Space plays.
   */
  private onKeydown(e: KeyboardEvent) {
    const field = isField(e.target) ? e.target : null, typing = field !== null, dirty = !!field && this.focus.dirty(field);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const act = dialogEscape(dirty, this.gizmo.tool, this.modeling && this.stage.mounted);
      if (act === 'revert') this.focus.revert(field!);
      else if (act === 'stage') this.post({ type: 'studioEscape' });
      else if (act === 'move') this.gizmo.setTool('move');
      else this.closeByKey();
    }
    else if (e.key === 'Tab') wrapTab(e, this.card);
    else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && '[]{}'.includes(e.key) && e.key.length === 1 && this.brushKey(e.key, e.shiftKey)) e.preventDefault();
    else if (!typing && !(e.target instanceof HTMLSelectElement) && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && this.gizmo.key(e.key.toLowerCase(), false, e.shiftKey)) e.preventDefault();
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      if (undoInField(dirty)) return; // the field's own undo takes back what was typed
      e.preventDefault();
      // A focused field is not redrawn (the panels leave it alone while it has the focus): let go of it for the undo, then take it back.
      field?.blur();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) this.redo(); else this.undo();
      if (field?.isConnected) field.focus({ preventScroll: true }); else this.focus.restore();
    } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.target instanceof SVGElement)) {
      e.preventDefault();
      this.toggle();
    }
  }

  /** `[` and `]` (Shift: the strength) change the Weights brush while that tool is on. */
  private brushKey(key: string, shift: boolean): boolean {
    return this.modeling && this.gizmo.tool === 'weights' && this.weightsPanel.brushKey(key, shift);
  }

  get isOpen() { return !this.root.hidden; }

  /** What the status line says about leaving: the dialog closes with Esc (with a deform tool on, the Esc after the one that goes back to Move), the standalone page's studio is the page and saves with Ctrl+S. */
  private leaveKey(deform = false) { return this.host.standalone ? 'Ctrl+S save' : deform ? 'Esc again closes' : 'Esc close'; }
  /** Esc that nothing else took (in the side columns, or handed back by the stage): the dialog closes, with its guard for edits not applied. */
  private closeByKey() { if (!this.host.standalone) this.close(); }

  private mode: Mode = 'animate';
  /** Model is about what the character is (the stage at rest and at the parameter values, no timeline); Animate is about what it does. */
  private get modeling() { return this.mode !== 'animate'; }

  /**
   * Model: what the character is (parts, bones, pivots, parameters, physics, what it does by itself), at rest and at the
   * parameter values. Animate: what it does, on a timeline. Same stage, working copy, undo and Apply.
   */
  private setMode(mode: Mode) {
    const model = mode === 'model', modeling = mode !== 'animate';
    if (mode !== this.mode) this.activeControl = null; // the active parameter belongs to Model
    const authoring = this.modeling;
    this.mode = mode;
    if (this.modeling !== authoring) this.params.build(); // its empty text and + belong to the mode (SR-14)
    this.gizmo.setMode(mode);
    this.root.dataset.mode = mode;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.as-modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    if (!model) this.physicsPanel.stop();
    this.showStatus();
    this.showSections();
    if (this.stage.mounted) {
      if (modeling) { this.playing = false; this.post({ type: 'studioPause' }); }
      this.post({ type: 'studioMarks', on: modeling });
      // With the Pivot tool a chosen part is picked at once: a click on the stage moves its pivot, no "Pick on stage" first.
      this.setPicking(model && this.gizmo.tool === 'pivot');
      if (!modeling && this.cur) this.seek(this.t);
      this.gizmo.resend();
      this.postWarp();
      this.postMask();
    }
    if (!this.root.hidden) { this.refreshView(); this.drawTimeline(); }
  }

  // ---- where the sections are: the dock (engine/src/dock.ts, editor/dock-ui.ts) ----
  private mountDock() {
    const spec = studioDockSpec();
    try { this.dockStored = readDock(spec, localStorage.getItem(DOCK_KEY)); } catch { /* storage blocked: the first layout */ }
    const zone = (z: string) => this.root.querySelector<HTMLElement>(`.as-dock[data-zone="${z}"]`)!;
    const panels: Record<string, HTMLElement> = {};
    for (const sec of this.root.querySelectorAll<HTMLElement>('.as-sect')) panels[sec.dataset.sect!] = sec;
    this.dock = mountDock({
      spec,
      zones: { left: zone('left'), left2: zone('left2'), right: zone('right') },
      panels,
      handle: (_id, sec) => sec.querySelector('.as-sect-grab'),
      layout: this.narrow() ? defaultDock(spec) : this.dockStored,
      onChange: layout => {
        // Say where the section went (the status line is a live region), as a drag shows it.
        const zones: Record<string, string> = { left: 'the left column', left2: 'a second left column, beside the first (Alt+Right again moves it to the right column, Alt+Left back)', right: 'the right column' };
        const note = dockMoveNote(this.dockStored, layout, id => this.root.querySelector(`.as-sect[data-sect="${id}"] .as-sect-title`)?.textContent ?? id, z => zones[z] ?? z, document.activeElement?.closest<HTMLElement>('.as-sect')?.dataset.sect);
        if (note) this.note.textContent = note;
        this.dockStored = layout;
        try { localStorage.setItem(DOCK_KEY, writeDock(layout)); } catch { /* the layout lasts until the page reloads */ }
      },
      onRender: () => this.afterDock(),
    });
    for (const g of this.root.querySelectorAll<HTMLElement>('.as-sect-grab')) g.hidden = false; // narrow windows hide them in CSS
    this.tools.resetdock.addEventListener('click', () => {
      this.dockStored = defaultDock(spec);
      try { localStorage.removeItem(DOCK_KEY); } catch { /* storage blocked */ }
      this.dock.setLayout(this.dockStored);
    });
    matchMedia('(max-width: 900px)').addEventListener('change', () => this.dock.setLayout(this.narrow() ? defaultDock(spec) : this.dockStored));
  }
  /** After the sections were placed: the split grip sits between Parameters and Parts when those two are neighbours on the left and is gone otherwise; the Reset button shows when the layout is not the first one. */
  private afterDock() {
    const first = this.root.querySelector<HTMLElement>('.as-dock[data-zone="left"]'), second = this.root.querySelector<HTMLElement>('.as-dock[data-zone="left2"]');
    const grip = this.root.querySelector<HTMLElement>('.as-grip-h');
    if (!first || !second || !grip) return;
    const zones = [first, second];
    // The split grip goes in the first left column that has the pair; a column with a panel showing is "has" (the second one is hidden without).
    let pairIn: HTMLElement | null = null;
    for (const z of zones) {
      const shown = [...z.children].filter(c => c.classList.contains('as-sect') && !(c as HTMLElement).hidden) as HTMLElement[];
      const at = shown.findIndex(c => c.dataset.sect === 'params');
      const pair = !pairIn && at >= 0 && ['poses', 'tree'].includes(shown[at + 1]?.dataset.sect ?? '');
      if (pair) { shown[at].after(grip); pairIn = z; z.dataset.split = ''; } else delete z.dataset.split;
      if (shown.length) z.dataset.has = ''; else delete z.dataset.has;
    }
    grip.hidden = !pairIn;
    const cols = second.dataset.has !== undefined && !this.narrow() ? 2 : 1;
    if (cols !== this.cols) { this.cols = cols; this.applySizes(); }
    this.tools.resetdock.hidden = isDefaultDock(studioDockSpec(), this.dock?.layout ?? this.dockStored) || this.narrow();
  }

  // ---- the collapsible sections of the three columns ----
  private narrow() { return matchMedia('(max-width: 900px)').matches; }
  /** Sections with nothing to show in this rig start closed. */
  private emptySections() { return [...(this.parameters.length || this.modeling ? [] : ['params']), ...(Object.values(this.host.slots).some(v => v.length) ? [] : ['frames'])]; }
  private isSectionOpen(id: string) { return sectionOpen(this.layout, this.mode, id, { narrow: this.narrow(), empty: this.emptySections() }); }
  /** Draw the sections this mode has, each open or closed; the others are not drawn. */
  private showSections() {
    const kind = this.focusNow();
    this.shownKind = kind;
    const gone = absentByFocus(this.mode, kind); // a parameter alone: the Parameter section in place of Keyforms and Properties
    const mine = studioPresent(this.mode, this.host.standalone?.without).filter(id => !gone.includes(id));
    this.dock.setPresent(mine);
    for (const sec of this.root.querySelectorAll<HTMLElement>('.as-sect')) {
      const id = sec.dataset.sect!, has = mine.includes(id), open = has && this.isSectionOpen(id);
      sec.querySelector('.as-sect-head')!.setAttribute('aria-expanded', String(open));
      sec.querySelector<HTMLElement>('.as-sect-body')!.hidden = !open;
    }
    this.showRig();
  }
  // ---- the rig strip under the stage: Model mode's Physics and Reactions (engine/src/studio-layout.ts rigStrip) ----
  /** A tab click opens the strip on that tab (the open one folds it); the chevron folds or opens it; the arrow keys, Home and End go along the tabs (open, they switch the tab too). */
  private wireRig() {
    const tabs = [...this.root.querySelectorAll<HTMLButtonElement>('.as-rig-tab')];
    for (const t of tabs) t.addEventListener('click', () => this.setRig(rigTabClick(this.layout, t.dataset.rig as RigTab)));
    this.root.querySelector('.as-rig-fold')!.addEventListener('click', () => { const r = rigStripOf(this.layout); this.setRig(withRigStrip(this.layout, { ...r, open: !r.open })); });
    this.root.querySelector<HTMLElement>('.as-rig-tabs')!.addEventListener('keydown', e => {
      const shown = tabs.filter(t => !t.hidden), n = shown.length, at = shown.indexOf(e.target as HTMLButtonElement);
      const to = at < 0 ? -1 : e.key === 'ArrowRight' ? (at + 1) % n : e.key === 'ArrowLeft' ? (at + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      if (rigStripOf(this.layout).open) this.setRig(withRigStrip(this.layout, { tab: shown[to].dataset.rig as RigTab, open: true }));
      shown[to].focus();
    });
  }
  private setRig(layout: StudioLayout) {
    this.layout = layout;
    this.saveLayout();
    this.showRig();
  }
  /** Draw the strip: shown in Model only, its height by state (folded, its tab row), the tab on show; the Physics shake stops when its tab is not on show. */
  private showRig() {
    const r = rigStrip(this.mode, rigStripOf(this.layout), this.host.standalone?.without);
    const strip = this.root.querySelector<HTMLElement>('.as-rig')!;
    strip.hidden = !r.shown;
    strip.style.height = `${r.height}px`;
    strip.dataset.open = String(r.open);
    for (const t of strip.querySelectorAll<HTMLButtonElement>('.as-rig-tab')) {
      const id = t.dataset.rig as RigTab;
      t.hidden = !r.tabs.includes(id);
      t.setAttribute('aria-selected', String(id === r.tab));
      t.tabIndex = id === r.tab ? 0 : -1;
    }
    for (const p of strip.querySelectorAll<HTMLElement>('.as-rig-panel')) p.hidden = !(r.open && p.dataset.rig === r.tab);
    const fold = strip.querySelector<HTMLButtonElement>('.as-rig-fold')!, name = r.tab === 'reactions' ? 'Reactions' : 'Physics';
    fold.setAttribute('aria-expanded', String(r.open));
    fold.title = r.open ? 'Fold the strip to its tabs' : `Open the strip on ${name}`;
    fold.setAttribute('aria-label', fold.title);
    if (!(r.open && r.tab === 'physics')) this.physicsPanel.stop();
  }
  /** The kind of the focus now (Model mode; 'none' in Animate, which leaves no section out for it). */
  private focusNow() { return focusKind({ control: this.keyedControl(), part: this.modeling ? this.part : null }); }
  /** The sizes the author dragged, as the CSS reads them: the left column's width and the most height the Parameters block takes. */
  private applySizes() {
    const body = this.root.querySelector<HTMLElement>('.as-body')!, fold = this.layout.collapsed ?? {};
    // A folded column is a thin rail; the left area is as wide as its columns (one or two) together.
    body.style.setProperty('--as-left', `${fold.left ? RAIL_PX : (this.layout.size?.left ?? LEFT_WIDTH.default) * this.cols}px`);
    body.style.setProperty('--as-right', `${fold.right ? RAIL_PX : this.layout.size?.right ?? RIGHT_WIDTH.default}px`);
    body.style.setProperty('--as-split', String(this.layout.size?.split ?? SPLIT.default));
    body.dataset.fold = Object.keys(fold).join(' ');
    for (const rail of body.querySelectorAll<HTMLElement>('.as-rail')) rail.hidden = !fold[rail.dataset.rail as StudioSide];
    const tl = body.querySelector<HTMLButtonElement>('.as-tlfold')!;
    tl.setAttribute('aria-expanded', String(!fold.timeline));
    tl.textContent = fold.timeline ? '▸' : '▾';
    tl.title = fold.timeline ? 'Show the timeline' : 'Fold the timeline to this row (the stage takes its room)';
  }
  private saveLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout)); } catch { /* the layout lasts until the page reloads */ }
    this.applySizes();
  }
  private setSize(size: StudioSizes) {
    this.layout = withSize(this.layout, size);
    this.saveLayout();
  }
  /** Fold a side column away to its rail (or the timeline to its transport row), or bring it back. */
  private setCollapsed(side: StudioFold, collapsed: boolean) {
    this.layout = withCollapsed(this.layout, side, collapsed);
    this.saveLayout();
  }
  /** A drag of a side column's edge to `px` (per column): a width, or a fold when the column is dragged almost out of the window. */
  private dragSide(side: StudioSide, px: number) {
    const d = dragColumn(side, px);
    if ('collapsed' in d) this.setCollapsed(side, true);
    else { this.layout = withSize(withCollapsed(this.layout, side, false), { [side]: d.width }); this.saveLayout(); }
  }
  /** A grip: a drag, or the arrow keys, sets the width of a side column (dragged to the window's edge, or Enter, it folds) or the share of the left column's height the Parameters block may take. */
  private gripEvents(grip: HTMLElement) {
    const kind = grip.dataset.grip as StudioSide | 'split';
    const rect = (sel: string) => this.root.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
    const at = (m: PointerEvent) => {
      if (kind === 'split') { const r = grip.parentElement!.getBoundingClientRect(); return (m.clientY - r.top) / r.height; }
      if (kind === 'left') return (m.clientX - rect('.as-side').left) / this.cols;
      return rect('.as-body').right - m.clientX;
    };
    const set = (v: number) => (kind === 'split' ? this.setSize({ split: v }) : this.dragSide(kind, v));
    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      followPointer(grip, m => set(at(m)));
    });
    if (kind !== 'split') grip.addEventListener('dblclick', () => this.setCollapsed(kind, !this.layout.collapsed?.[kind]));
    grip.addEventListener('keydown', e => {
      if (kind !== 'split' && e.key === 'Enter') { e.preventDefault(); this.setCollapsed(kind, !this.layout.collapsed?.[kind]); return; }
      // Growing is right for the left column's edge and down for the split; the right column's edge grows to the left.
      const grow = kind === 'split' ? e.key === 'ArrowDown' : kind === 'left' ? e.key === 'ArrowRight' : e.key === 'ArrowLeft';
      const shrink = kind === 'split' ? e.key === 'ArrowUp' : kind === 'left' ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
      if (!grow && !shrink) return;
      e.preventDefault();
      const dir = grow ? 1 : -1;
      if (kind === 'split') return this.setSize({ split: clampSplit(this.layout.size?.split ?? SPLIT.default) + dir * 0.05 });
      const now = kind === 'left' ? clampLeft(this.layout.size?.left ?? LEFT_WIDTH.default) : clampRight(this.layout.size?.right ?? RIGHT_WIDTH.default);
      this.layout = withCollapsed(this.layout, kind, false);
      this.setSize({ [kind]: now + dir * 16 });
    });
  }
  private toggleSection(id: string) {
    this.setSection(id, !this.isSectionOpen(id));
  }
  private openSection(id: string) { if (!this.isSectionOpen(id)) this.setSection(id, true); }
  private setSection(id: string, open: boolean) {
    this.layout = withSection(this.layout, this.mode, id, open);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout)); } catch { /* the layout lasts until the page reloads */ }
    this.showSections();
  }
  // ---- the Properties sub-blocks (Model mode; engine/src/studio-inspector.ts propBlocks, editor/anim-props.ts) ----
  /** What the sub-blocks are drawn for: the chosen row's kind, its warp and skin, its clip or shape, the variant a slot shows, the tool and brush. */
  private propsView(): PropBlocksView {
    const p = this.part, set = this.setParts();
    const row = p === null ? null : set ? 'set' : Object.hasOwn(this.shapes, p) ? 'shape' : this.host.parts.includes(p) ? 'part' : this.selIsBone(p) ? 'bone' : null;
    const to = row === 'part' ? this.clips[p!] ?? null : null, shape = row === 'shape' ? this.shapes[p!] : undefined;
    const shown = row === 'part' ? this.tree.slotShown(p!) : undefined;
    const deform = this.warpPanel.deformState(), skin = row === 'part' ? this.weightsPanel.skinState() : undefined;
    // A clipped part bent by a group warp while its shape is not: Deform shows it with its fix, Clip's line a ⚠.
    const issue = row === 'part' || row === 'shape' ? clipGroupIssues(this.shapeSet()).find(i => i.part === p || i.shape === p) : undefined;
    return propBlocks({
      row, name: row === null ? null : p, tool: this.gizmo.tool, brush: this.weightsPanel.brush(),
      clip: { to, shape: to !== null && Object.hasOwn(this.shapes, to) },
      ...(shape ? { shape: { bone: shape.bone ?? null, points: shape.polygon.length, clips: Object.values(this.clips).filter(c => c === p).length } } : {}),
      ...(shown !== undefined ? { slot: { shown } } : {}),
      ...(deform ? { deform } : {}),
      ...(skin ? { skin } : {}),
      ...(set ? { set: this.setState(set) } : {}),
      clipIssue: issue ? `${issue.part} is bent by the group warp ${issue.group}, but its shape ${issue.shape} is not a member: the clip would stay while the part moves.` : null,
    });
  }
  /**
   * A Ctrl-click set (docs/design/studio-inspector.md, step 4): the chosen part and the rows added to it, when all are parts with art (a bone
   * or a shape among them makes no set: those rows keep their own view). Properties then shows what they share and sets a value on all.
   */
  private setParts(): string[] | null {
    const p = this.part, isArt = (n: string) => this.host.parts.includes(n) && !Object.hasOwn(this.shapes, n);
    if (!this.modeling || p === null || !this.extras.size || !isArt(p) || ![...this.extras].every(isArt)) return null;
    return [p, ...this.extras];
  }
  private setState(set: string[]): SetState {
    return { parts: set, bones: set.map(n => this.partBones[n]?.bone ?? null), pivots: set.map(n => this.pivots[n] ?? null), clips: set.map(n => this.clips[n] ?? null) };
  }
  /** The set's shared fields (studio-inspector.ts setView), null for no set. */
  private setFields(): SetView | null { const set = this.setParts(); return set ? setView(this.setState(set)) : null; }
  /** Draw the sub-blocks; one the tool in use has a next step in opens by itself, unless the author folded it while this tool is on. */
  private showProps() {
    if (!this.modeling) return;
    for (const b of this.propsView().blocks) {
      if (b.shown && b.auto && !b.fixed && !this.subTaken.has(b.id) && !this.isSectionOpen(subOpenKey(b.id))) { this.setSubOpen(b.id, true); this.subAuto.add(b.id); }
    }
    this.props.show();
  }
  /** The tool changed: the sub-blocks the old one opened fold again, and the author's choices made meanwhile stop counting. */
  private foldAutoSubs() {
    for (const id of this.subAuto) if (this.isSectionOpen(subOpenKey(id))) this.setSubOpen(id, false);
    this.subAuto.clear();
    this.subTaken.clear();
  }
  /** A sub-block's open flag, kept with the sections' (Model mode). */
  private setSubOpen(id: PropBlockId, open: boolean) {
    this.layout = withSection(this.layout, 'model', subOpenKey(id), open);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout)); } catch { /* the layout lasts until the page reloads */ }
  }
  /** A verb of a sub-block's head line. */
  private propVerb(id: PropVerbId) {
    if (id === 'newShape') this.maskPanel.newShape();
    else if (id === 'removeClip') this.maskPanel.removeClip();
    else if (id === 'deleteShape') this.maskPanel.deleteShape();
    else if (id === 'removeBone' && this.part !== null) this.removeBoneNamed(this.part);
    else if (id === 'addWarp') this.warpPanel.add();
    else if (id === 'addGroupWarp') this.warpPanel.addGroup();
    else if (id === 'removeWarp') this.warpPanel.removeTarget();
    else if (id === 'removeSkin') void this.weightsPanel.unskin();
  }
  /** Remove a bone (one undo step): what sits on it goes to its parent, the keyforms, keys and physics that name it go with it; the note says what. */
  private removeBoneNamed(name: string) {
    const r = removeBone({ bones: this.bones, parts: this.partBones, shapes: this.shapes, keyforms: this.keyforms, anims: this.anims, deformers: this.deformers, physics: this.physics }, name);
    if ('error' in r) { this.note.textContent = r.error; return; }
    if (this.gizmo.hasPending) this.gizmo.clearPending(); // an unkeyed drag of the bone would key a bone that is gone
    this.edit(() => {
      const d = r.doc;
      this.bones = d.bones; this.partBones = d.parts; this.shapes = d.shapes; this.keyforms = d.keyforms; this.anims = d.anims; this.deformers = d.deformers; this.physics = d.physics;
      if (this.part === name) this.part = null;
      this.extras.delete(name);
      this.hidden = this.hidden.filter(h => h !== name);
    });
    this.note.textContent = r.note;
  }
  /** Model mode: the stage shows the parameters' pose, but pivots belong to the rest pose; say so while a parameter is off its default. */
  private showRestNote() {
    this.root.querySelector<HTMLElement>('.as-rest-note')!.hidden = !(this.mode === 'model' && Object.keys(changedParams(this.parameters, this.params.values())).length);
  }
  /** What a closed section holds, beside its title. */
  private showSummaries() {
    const c = this.cur, chains = Object.keys(this.physics).length, defs = this.parameters.length;
    const tracks = c ? frameTracks(c.def.frames).length : 0;
    const sum: Record<string, string> = {
      sel: this.setFields()?.label ?? this.part ?? 'the whole character', // a set: `3 parts`
      param: this.keyedControl()?.replace(/^pad:/, '') ?? '',
      params: defs ? String(defs) : 'none',
      poses: PosePanel.summary(this.poses),
      frames: tracks ? `${tracks} track${tracks === 1 ? '' : 's'}` : '',
      physics: chains ? `${chains} chain${chains === 1 ? '' : 's'}` : 'none',
      reactions: ReactionPanel.summary(this.reactions),
    };
    for (const sec of this.root.querySelectorAll<HTMLElement>('.as-sect')) sec.querySelector('.as-sect-sum')!.textContent = sum[sec.dataset.sect!] ?? '';
    for (const tab of this.root.querySelectorAll<HTMLElement>('.as-rig-tab')) tab.querySelector('.as-rig-sum')!.textContent = sum[tab.dataset.rig!] ?? '';
  }

  /** Save `values` as pose `name` (one undo step); the note to show. */
  private savePoseNamed(name: string, values: Record<string, number>): string {
    if (!Object.keys(values).length) return 'Nothing differs from the defaults yet; move a control first.';
    const next = savePose(this.poses, name, values);
    if (!next) return 'A pose name has letters, digits and _ only, and starts with a letter.';
    const replaced = Object.hasOwn(this.poses, name);
    this.edit(() => { this.poses = next; });
    return `${replaced ? 'Replaced' : 'Saved'} pose "${name}" (${Object.keys(values).join(', ')}). Apply writes it to rig.json; use it with: show ${this.char} pose=${name}`;
  }

  /** The animation picker's `⋯` menu: New, Copy (Edit copy for a preset), Rename, Delete. */
  private animationMenu(e: MouseEvent) {
    const c = this.cur, can = this.editable();
    (this.menu ??= new ContextMenu(this.root)).open(e, e.currentTarget as HTMLElement, [
      { label: 'New animation…', run: () => this.newAnimation() },
      { label: c?.preset ? 'Edit copy…' : 'Copy…', run: () => this.copyAnimation(), disabled: !c },
      { label: 'Rename…', run: () => this.renameAnimation(), disabled: !can },
      null,
      { label: 'Delete', run: () => this.deleteAnimation(), disabled: !can },
    ]);
  }

  private doc(): Snap { return { categories: this.categories, parameters: this.parameters, pads: this.pads, keyforms: this.keyforms, poses: this.poses, physics: this.physics, deformers: this.deformers, shapes: this.shapes, clips: this.clips, anims: this.anims, pivots: this.pivots, bones: this.bones, parts: this.partBones, looks: this.looks, reactions: this.reactions }; }
  private snap(): Snap { return structuredClone(this.doc()); }
  private get dirty() { return JSON.stringify(this.doc()) !== this.baseline; }
  /** Open with edits not applied to rig.json yet (the editor's leave-page guard asks about them). */
  get hasUnapplied() { return this.isOpen && this.dirty; }

  /** Show `char`'s animations: `start` is its rig.json `animations` and `pivots` and what it does by itself. */
  open(char: string, start: Snap, host: StudioHost, animation?: string, mode: Mode = 'animate') {
    this.host = host;
    this.root.querySelector('#as-anchornames')!.replaceChildren(...Object.keys(host.anchors ?? ANCHORS).map(n => el('option', { value: n })));
    this.char = char;
    this.parameters = structuredClone(start.parameters);
    this.pads = structuredClone(start.pads);
    this.categories = [...start.categories];
    this.keyforms = structuredClone(start.keyforms);
    this.rigSent = '';
    this.activeControl = null;
    this.poses = structuredClone(start.poses);
    this.physics = structuredClone(start.physics);
    this.deformers = structuredClone(start.deformers);
    this.warpPanel.reset();
    this.weightsPanel.reset();
    this.shapes = structuredClone(start.shapes);
    this.clips = structuredClone(start.clips);
    this.maskPanel.reset();
    this.shaking = null;
    this.anims = structuredClone(start.anims);
    this.pivots = structuredClone(start.pivots);
    this.bones = structuredClone(start.bones);
    this.partBones = structuredClone(start.parts);
    this.looks = structuredClone(start.looks);
    this.reactions = structuredClone(start.reactions);
    this.testVars = {};
    this.picking = false;
    this.placer.reset();
    this.pose = null;
    this.overrides = {};
    this.pivotPanel.reset();
    this.note.textContent = ''; // a note from the last session (e.g. the discard warning) does not apply any more
    this.presetNote = false;
    this.closeWarned = false;
    this.baseline = JSON.stringify(this.doc());
    this.dragFrom = null;
    this.history.clear();
    this.t = 0;
    this.playing = false;
    this.keys.sel = null;
    this.part = null;
    this.tree.reset();
    this.focusSent = undefined;
    this.rebuild();
    this.params.reset();
    this.builtParams = JSON.stringify([this.categories, this.parameters, this.pads]);
    this.params.build();
    this.physicsPanel.build();
    this.setMode(mode);
    this.placer.show();
    const alone = host.standalone;
    this.stage.mount(char, alone?.stage);
    if (!host.parts?.length && !alone) this.stageHost.append(el('div', { className: 'as-empty', textContent: `No art for ${char} yet. Convert its PSD (or add its images) to see it here.` }));
    this.root.hidden = false;
    this.tools.scene.hidden = !host.tryInScene;
    this.tools.open.hidden = !alone;
    this.root.querySelector<HTMLElement>('.close')!.hidden = !!alone;
    this.tools.apply.textContent = alone?.save.label ?? 'Apply';
    this.select(openingEntry(this.entries, animation, lastAnim()[char]));
    this.setPicking(mode === 'model' && this.gizmo.tool === 'pivot'); // the stage's studioReady repeats it once the page has loaded
    this.focus.forget();
    this.card.focus({ preventScroll: true });
  }

  /** While Close waits for a second press, the button says it discards and the note stands out (ES-15); any edit puts both back. */
  private showCloseGuard() {
    const b = this.root.querySelector<HTMLButtonElement>('.close')!;
    b.textContent = this.closeWarned ? 'Discard and close' : 'Close';
    b.setAttribute('aria-label', this.closeWarned ? 'Discard the changes and close the animation studio' : 'Close animation studio');
    b.classList.toggle('as-discard', this.closeWarned);
    this.note.classList.toggle('as-note-warn', this.closeWarned && (this.note.textContent ?? '').startsWith('There are changes'));
  }

  close(force = false) {
    if (this.root.hidden) return;
    if (!force && this.dirty && !this.closeWarned) {
      this.closeWarned = true; // browser confirm dialogs are not shown everywhere: ask in the dialog, close on the second try
      this.note.textContent = this.host.standalone ? 'There are changes that were not saved. Save them (Ctrl+S), or press Open again to discard them.' : 'There are changes that were not applied. Apply them, or press Discard and close (or Esc) to discard them.';
      this.showCloseGuard();
      return;
    }
    this.closeWarned = false;
    this.exporter.abort();
    this.shaking = null;
    this.post({ type: 'studioPause' });
    this.root.hidden = true;
    this.stage.unmount();
    this.playing = false;
    this.host.returnFocus?.();
  }

  private post(msg: object) { this.stage.post(msg); }

  private onStage(e: StageEvent) {
    if (e.type === 'ready') {
      this.post({ type: 'studioAnims', anims: this.anims });
    this.postAuto();
      this.postPivots();
      this.postPhysics();
      this.deformersSent = '';
      this.postDeformers();
      this.rigSent = '';
      this.postRig();
      this.sendParams();
      this.dressStage();
      if (this.host.scene) this.post({ type: 'studioScene', ...this.host.scene });
      this.placer.send();
      this.focusSent = undefined; // a reloaded stage starts with every part at full strength
      this.sendFocus();
      this.hiddenSent = '';
      this.sendHidden();
      this.gizmo.resend();
      this.warpSent = '';
      this.postWarp();
      this.weightsSent = '';
      this.postWeights();
      this.masksSent = '';
      this.postMasks();
      this.maskSent = '';
      this.postMask();
      if (this.modeling) this.post({ type: 'studioMarks', on: true });
      if (this.picking) this.post({ type: 'studioPick', part: this.part });
      else if (this.cur) this.post({ type: 'studioSeek', name: this.cur.name, t: this.t });
    } else if (e.type === 'exportReady' || e.type === 'exportData' || e.type === 'exportError' || e.type === 'exportDone') this.exporter.event(e);
    else if (e.type === 'picked') {
      if (!this.picking || !this.part) return;
      const { x, y, drag } = e;
      if (drag === 'end') { // the press and moves already changed the working copy; the release makes them one undo step
        if (this.dragFrom) { const before = this.dragFrom; this.dragFrom = null; this.commit(before); }
      } else if (drag === 'move') {
        this.dragFrom ??= this.snap();
        this.closeWarned = false;
        this.setSelPivot([x, y]);
        this.postPivots();
        this.pivotPanel.show();
        this.tools.apply.disabled = !this.dirty;
      } else this.edit(() => this.setSelPivot([x, y]));
    } else if (e.type === 'select') {
      // A click on art chooses the part; its bone is reached deliberately (Alt-click, the bone's pivot dot, the Properties link): docs/design/studio-stage-modes.md.
      // The tree shares the selection. In Model mode the gizmo still poses the bone a chosen part sits on (GizmoBar asks for the subject).
      // Model: clicks on one spot walk through the parts under the pointer, front to back (docs/design/studio-focus-and-verbs.md); the line over the stage says where in the walk it is.
      // With Warp or Weights a click on the chosen part itself is work on it, not a choice: no walk, the row stays.
      const mode = this.modeling ? stageMode(this.gizmo.tool) : 'transform';
      let picked = e.name;
      if (this.modeling && e.hits.length && !e.alt && keepsSubject(mode, e.hits, this.part)) { picked = this.part; this.cycle = null; }
      // Alt-click is for the bone of the part on show there (the chosen one, else the front one), so it does not step the walk on (SR-7).
      else if (this.modeling && e.hits.length && e.alt) picked = this.part !== null && e.hits.includes(this.part) ? this.part : e.hits[0];
      else if (this.modeling && e.hits.length) {
        const r = cycleHit(e.hits, null, this.cycle, e.at);
        this.cycle = r.state;
        picked = r.part;
        const label = cycleLabel(r);
        if (label) this.note.textContent = label;
      } else this.cycle = null;
      // Model, Ctrl held: the part joins the chosen ones (or leaves them) instead of replacing them.
      const c = chooseOnStage({ mode, hit: picked, boneOf: picked !== null ? this.boneOfRow(picked) : null, alt: e.alt, ctrl: e.ctrl, model: this.modeling });
      if (c.kind === 'toggle') this.toggleExtra(c.name);
      else if (c.kind === 'choose') this.choosePart(c.name);
      if (e.alt && !e.ctrl && c.kind === 'choose' && picked !== null) this.note.textContent = c.name !== picked ? `Chose ${c.name}, the bone ${picked} sits on.` : `${picked} sits on no bone, so the part itself is chosen.`;
    } else if (e.type === 'warpDrag') this.warpPanel.dragged(e.phase, e.id, e.point, e.delta);
    else if (e.type === 'warpSelect') this.warpPanel.choose(e.points, e.mode);
    else if (e.type === 'weightsPick') this.weightsPanel.pick(e.id, e.vertex);
    else if (e.type === 'weightsSelect') this.weightsPanel.choose(e.id, e.points, e.mode);
    else if (e.type === 'weightsBrush') this.weightsPanel.brushed(e.phase, e.id, e.hits);
    else if (e.type === 'alpha') { const done = this.alphaWaits.get(e.id); this.alphaWaits.delete(e.id); done?.(e.alpha && e.w >= 1 && e.h >= 1 ? { w: e.w, h: e.h, alpha: e.alpha } : null); }
    else if (e.type === 'meshTopo') this.warpPanel.topology(e);
    else if (e.type === 'warpBox') { this.warpPanel.box(e.id, e.w, e.h, e.pw, e.ph); this.weightsPanel.box(e.id, e.pw, e.ph); }
    else if (e.type === 'maskDrag') this.maskPanel.dragged(e.phase, e.shape, e.point, e.delta);
    else if (e.type === 'maskAdd') this.maskPanel.added(e.shape, e.index, e.at);
    else if (e.type === 'maskRemove') this.maskPanel.removed(e.shape, e.point);
    else if (e.type === 'maskBox') this.maskPanel.box(e.part, { x: e.x, y: e.y, w: e.w, h: e.h });
    else if (e.type === 'gizmo') this.gizmo.event(e);
    else if (e.type === 'key') {
      if (e.ctrl && e.key === 's') { if (this.host.standalone) void this.apply(); } // the stage page swallowed the browser's Save Page
      else if (e.key === ' ') this.toggle(); // Space pressed on the stage with no pan
      else if (this.brushKey(e.key, e.shift)) return; // [ and ] on the stage: the Weights brush
      else if (!this.gizmo.key(e.key, e.ctrl, e.shift) && e.key === 'escape') this.closeByKey(); // an Esc the stage and the tool did not use
    }
    else if (e.type === 'placed') {
      this.placer.placed(e.x, e.y);
    } else {
      this.t = e.t;
      this.params.sync();
      if (e.playing === false && this.playing) { this.playing = false; this.showTransport(); }
      this.showTime();
    }
  }

  // ---- the working copy ----
  /** The animations that can be shown: the character's own, then the presets it does not override. */
  private rebuild() {
    const own = Object.keys(this.anims).filter(n => Array.isArray(this.anims[n]?.keys));
    this.entries = [
      ...own.map(name => { const def = this.anims[name]; return { name, preset: false, def, dur: def.dur !== undefined && def.dur > 0 ? def.dur : 1 }; }),
      ...Object.keys(ANIMS).filter(name => !Object.hasOwn(this.anims, name) || !Array.isArray(this.anims[name]?.keys))
        .map(name => ({ name, preset: true, def: bakePreset(name, 48)!, dur: ANIMS[name].dur })),
    ];
  }

  /** Change the working copy with `fn` as one undo step, then show it. */
  private edit(fn: () => void) {
    this.closeWarned = false;
    const before = this.snap();
    fn();
    this.commit(before);
  }
  /** Make the change from `before` to the working copy an undo step, then show it (nothing when it is the same). */
  private commit(before: Snap): boolean {
    if (JSON.stringify(before) === JSON.stringify(this.doc())) return false;
    this.history.record(before, describeChange(before, this.doc()));
    this.changed();
    return true;
  }
  private restore(s: Snap) {
    this.parameters = s.parameters;
    this.pads = s.pads;
    this.categories = s.categories;
    this.keyforms = s.keyforms;
    this.poses = s.poses;
    this.physics = s.physics;
    this.deformers = s.deformers;
    this.shapes = s.shapes;
    this.clips = s.clips;
    this.anims = s.anims;
    this.pivots = s.pivots;
    this.bones = s.bones;
    this.partBones = s.parts;
    this.looks = s.looks;
    this.reactions = s.reactions;
    this.changed();
  }
  private undo() {
    const prev = this.history.undo(this.snap());
    if (prev) { this.restore(prev.state); this.showStep('Undid', prev.label); }
  }
  private redo() {
    const next = this.history.redo(this.snap());
    if (next) { this.restore(next.state); this.showStep('Redid', next.label); }
  }
  /**
   * After an undo or a redo: go to what it changed (its mode, its animation, its part, when they are there) and say what it was, so a
   * change out of sight is not made silently (docs/design/studio-undo.md).
   */
  private showStep(verb: string, step: ChangeLabel) {
    let moved = false;
    if (step.mode && step.mode !== this.mode) { this.setMode(step.mode); moved = true; }
    if (step.anim && this.cur?.name !== step.anim && this.entries.some(e => e.name === step.anim)) { this.pick(step.anim); moved = true; }
    // The part is chosen only when the view had to move (or nothing is chosen): an undo where you are working keeps your choice, a
    // Ctrl-click set included.
    const parts = new Set([...this.host.parts, ...Object.keys(this.bones)]);
    if (step.part && (moved || this.part === null) && this.part !== step.part && !this.extras.has(step.part) && parts.has(step.part)) this.choosePart(step.part);
    this.note.textContent = `${verb}: ${step.label}`;
  }
  /** The Parameters tab's hand-set values (and which of them beat the animation's tracks) go to the stage. */
  private sendParams() { this.post({ type: 'studioParams', values: this.params.base, hold: [...this.params.hold] }); }
  /** The working copy of `physics` goes to the stage, which steps it; `drive` (while shaking) moves one input back and forth. */
  private shaking: Shake | null = null;
  private postPhysics() { this.post({ type: 'studioPhysics', chains: this.physics, drive: this.shaking }); }
  private shake(drive: Shake | null) { this.shaking = drive; this.postPhysics(); }
  /** The working copy of `deformers` goes to the stage, which shapes the meshes by it; only when it differs from what the stage has. */
  private postDeformers() {
    const s = JSON.stringify(this.deformers);
    if (s === this.deformersSent) return;
    this.deformersSent = s;
    this.post({ type: 'studioDeformers', deformers: this.deformers });
  }
  /** The working copy of `parameters` and `keyforms` goes to the stage, which poses the character by them; only when it differs from what the stage has. */
  private postRig() {
    const s = JSON.stringify([this.parameters, this.keyforms]);
    if (s === this.rigSent) return;
    this.rigSent = s;
    this.post({ type: 'studioRig', parameters: this.parameters, keyforms: this.keyforms });
  }
  /** The Warp tool: the stage draws the lattice of the chosen warp (a part's or a group's; and which point is chosen), or none. */
  /** Asks the stage for the alpha channel of a part's image (the mesh generator's input); null when it does not answer in time or cannot read it. */
  private requestAlpha(part: string): Promise<{ w: number; h: number; alpha: Uint8Array } | null> {
    return new Promise(resolve => {
      const id = ++this.alphaSeq, timer = setTimeout(() => { if (this.alphaWaits.delete(id)) resolve(null); }, 8000);
      this.alphaWaits.set(id, r => { clearTimeout(timer); resolve(r); });
      this.post({ type: 'studioAlpha', id, part });
    });
  }
  private postWarp() {
    const id = this.modeling && this.gizmo.tool === 'warp' && this.part ? this.warpPanel.target() : null;
    const f = this.warpPanel.falloffNow();
    const msg = { type: 'studioWarp', id, points: id ? this.warpPanel.selection : [], radius: f.radius, curve: f.curve, topo: id ? this.warpPanel.topoTool() : null, anchor: id ? this.warpPanel.topoAnchor() : null };
    const s = JSON.stringify(msg);
    if (s === this.warpSent) return;
    this.warpSent = s;
    this.post(msg);
  }
  /** The Weights tool's view of the chosen mesh goes to the stage, when it differs from what the stage has. */
  private postWeights() {
    const msg = this.weightsPanel.message(), s = JSON.stringify(msg);
    if (s === this.weightsSent) return;
    this.weightsSent = s;
    this.post(msg);
  }
  /** The working copy of the mask shapes and clips goes to the stage, which clips the parts by it; only when it differs from what the stage has. */
  private postMasks() {
    const s = JSON.stringify([this.shapes, this.clips]);
    if (s === this.masksSent) return;
    this.masksSent = s;
    this.post({ type: 'studioMasks', shapes: this.shapes, clips: this.clips });
  }
  /** Model mode: the stage outlines the shape the chosen row edits (a shape row, or the shape a part is clipped to); with the Mask tool every shape is outlined and its points are handles. */
  private postMask() {
    const tool = this.modeling && this.gizmo.tool === 'mask', shape = this.modeling ? this.maskPanel.edited() : null;
    const msg = { type: 'studioMask', shape, part: this.modeling && this.part && this.host.parts.includes(this.part) ? this.part : null, tool, point: shape ? this.maskPanel.point : null };
    const s = JSON.stringify(msg);
    if (s === this.maskSent) return;
    this.maskSent = s;
    this.post(msg);
  }
  private postPivots() { this.post({ type: 'studioPivots', pivots: this.pivots, bones: this.bones, parts: this.partBones, width: this.host.width, height: this.host.height }); }
  /** The working copy changed: refresh the lists, the timeline and the stage. */
  private changed() {
    const name = this.cur?.name;
    this.revision++;
    this.rebuild();
    this.cur = this.entries.find(e => e.name === name) ?? this.entries[0] ?? null;
    if (this.keys.sel !== null && !this.cur?.def.keys[this.keys.sel]) this.keys.sel = null;
    this.post({ type: 'studioAnims', anims: this.anims });
    this.postAuto();
    this.postPivots();
    this.postPhysics();
    this.postDeformers();
    this.postMasks();
    this.postRig();
    const built = JSON.stringify([this.categories, this.parameters, this.pads]);
    if (built !== this.builtParams) { // a parameter or pad was added, changed or deleted, or an undo did that
      this.builtParams = built;
      if (this.activeControl && !this.controlExists(this.activeControl)) this.activeControl = null;
      this.params.build();
      this.sendParams();
    }
    this.physicsPanel.build();
    this.ptracks.clamp();
    this.frames.clamp();
    this.refreshList();
    this.refreshView();
  }

  /** Apply what is pending (the standalone page's Ctrl+S). */
  save(): Promise<void> { return this.apply(); }

  /** Hand the working copy to the host. A host that writes a file takes a moment: what changes meanwhile stays pending. */
  private async apply() {
    if (!this.dirty) return;
    const change = this.snap(), sent = JSON.stringify(change), saving = this.host.standalone?.save;
    this.tools.apply.disabled = true;
    let ok = false;
    try { ok = await this.host.apply(change); } catch { ok = false; }
    if (ok) {
      this.baseline = sent;
      this.note.textContent = saving?.done ?? 'Applied to rig.json, which the editor saves at once (Ctrl+Z in its tab undoes it).';
    } else this.note.textContent = saving?.failed ?? 'Could not write to rig.json; fix its errors first.';
    this.refreshView();
  }

  /** Apply what is pending, leave the studio and let the host play the script from the line it was opened from. */
  private async tryInScene() {
    await this.apply();
    if (this.dirty) return; // the note says why it could not be applied
    const go = this.host.tryInScene;
    this.close(true);
    go?.();
  }

  // ---- the animation list ----
  private select(entry: Entry | null) {
    if (this.picking) this.setPicking(false);
    if (entry) rememberAnim(this.char, entry.name);
    this.ptracks.sel = null;
    this.frames.sel = null;
    this.params.release();
    this.gizmo.clearPending();
    this.cur = entry;
    this.part = this.startPart(entry);
    this.keys.sel = null;
    this.playing = false;
    this.refreshList();
    this.refreshView();
    if (entry) this.seek(this.t);
  }

  /** The picker: the character's animations, then the presets it does not override. */
  private refreshList() {
    const group = (label: string, preset: boolean) => {
      const own = this.entries.filter(e => e.preset === preset);
      const g = el('optgroup', { label });
      g.append(...own.map(e => el('option', { value: e.name, textContent: e.def.auto ? `${e.name} ⟳` : e.name, title: e.def.auto ? 'Starts by itself (Automatic)' : '' })));
      return own.length ? [g] : [];
    };
    this.picker.replaceChildren(...group('Of this character', false), ...group('Presets', true));
    this.picker.value = this.cur?.name ?? '';
    this.picker.disabled = !this.entries.length;
  }

  /** Ask for a name in the dialog itself (browser prompts are not shown everywhere) and call `then` with it. */
  private askName(message: string, value: string, then: (name: string) => void) {
    const row = this.root.querySelector<HTMLFormElement>('.as-name')!, input = row.querySelector('input')!;
    row.querySelector('span')!.textContent = message;
    input.value = value;
    row.hidden = false;
    const done = () => { row.hidden = true; row.onsubmit = null; this.card.focus({ preventScroll: true }); };
    row.onsubmit = e => {
      e.preventDefault();
      const v = input.value.trim();
      if (!/^[\w-]+$/.test(v)) { this.note.textContent = 'A name has letters, digits, _ and - only.'; input.focus(); return; }
      done();
      then(v);
    };
    row.querySelector<HTMLButtonElement>('button[type="button"]')!.onclick = done;
    input.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
    input.focus();
    input.select();
  }
  private pick(name: string) { this.cur = this.entries.find(e => e.name === name) ?? this.cur; this.part = this.startPart(this.cur); this.keys.sel = null; this.refreshList(); this.refreshView(); this.seek(this.t); }

  private newAnimation() {
    this.askName('Name of the new animation', uniqueName(this.anims, 'anim'), name => {
      if (Object.hasOwn(this.anims, name)) { this.note.textContent = `${name} exists already.`; return; }
      this.edit(() => { this.anims = newAnim(this.anims, name).anims; });
      this.pick(name);
    });
  }
  private copyAnimation() {
    const c = this.cur;
    if (!c) return;
    this.askName(c.preset ? `Name of the editable copy of ${c.name} (${c.name} itself would replace the preset for this character)` : `Name of the copy of ${c.name}`,
      uniqueName(this.anims, c.preset ? `${c.name}-custom` : `${c.name}-copy`), name => {
        if (Object.hasOwn(this.anims, name) && Array.isArray(this.anims[name]?.keys)) { this.note.textContent = `${name} exists already.`; return; }
        this.edit(() => {
          if (c.preset) this.anims = { ...this.anims, [name]: bakePreset(c.name, 16)! };
          else { const d = duplicateAnim(this.anims, c.name); if (d) this.anims = renameAnim(d.anims, d.name, name) ?? d.anims; }
        });
        this.pick(name);
      });
  }
  private renameAnimation() {
    const c = this.cur;
    if (!c || c.preset) return;
    this.askName(`New name of ${c.name}`, c.name, name => {
      if (name === c.name) return;
      const renamed = renameAnim(this.anims, c.name, name);
      if (!renamed) { this.note.textContent = `${name} exists already.`; return; }
      this.edit(() => { this.anims = renamed; });
      this.pick(name);
    });
  }
  private deleteAnimation() {
    const c = this.cur;
    if (!c || c.preset) return;
    this.edit(() => { this.anims = deleteAnim(this.anims, c.name); });
    this.pick(this.entries[0]?.name ?? '');
  }

  // ---- keys ----
  private editable() { return !!this.cur && !this.cur.preset; }

  // ---- the Parts tree: what the character is made of, and how the stage dresses it ----
  private dressStage() { this.post({ type: 'studioShow', pose: this.pose, overrides: this.overrides }); }

  /** The part an animation opens at: the first one it keys, when it has no keys for the whole character. */
  private startPart(e: Entry | null) {
    if (!e || e.def.keys.some(k => !k.part)) return null;
    return animParts(e.def)[0] ?? null;
  }
  /** Ctrl-click: add `part` to the chosen ones, or take it away again (it becomes the chosen part when none is). */
  private toggleExtra(part: string | null) {
    if (part === null || !this.modeling) return;
    if (this.part === null) { this.choosePart(part); return; }
    if (part === this.part) { const next = [...this.extras][0]; if (next === undefined) return; this.extras.delete(next); this.choosePart(next, [...this.extras]); return; }
    const added = !this.extras.delete(part);
    if (added) this.extras.add(part);
    this.refreshView();
    if (!added) return;
    // Say what the set is now, and that a part the active parameter does not pose stays out of a drag.
    const d = this.driver();
    const loose = d && !isBound(this.keyforms, part, d) ? ` ${part} is not bound to ${this.activeName()}: a drag leaves it out until Bind parts… binds it.` : '';
    this.note.textContent = `Added ${part} to the chosen parts (${this.extras.size + 1}): one drag poses them by the same amount.${loose}`;
  }
  private choosePart(part: string | null, keep: string[] = []) {
    // One focus (docs/design/studio-focus-and-verbs.md): a part bound to the active parameter stays under it (a keyform focus), any other replaces it.
    if (this.modeling) this.activeControl = afterChoosePart({ control: this.keyedControl(), part: this.part }, part, (p, c) => this.boundToControl(p, c)).control;
    this.part = part;
    this.extras = new Set(keep);
    this.keys.sel = null;
    this.setPicking(this.picking || (this.mode === 'model' && this.gizmo.tool === 'pivot'));
    this.refreshView();
  }
  /** The stage dims every part but the chosen one (or a group's parts). */
  /** The stage hides these parts (and takes no click on them). */
  private sendHidden() {
    const sig = this.hidden.join('|');
    if (this.hiddenSent === sig) return;
    this.hiddenSent = sig;
    this.post({ type: 'studioHidden', parts: this.hidden });
  }
  private sendFocus() {
    const extra = [...this.extras], sig = `${this.part}|${extra.join(',')}`;
    if (this.focusSent === sig) return;
    this.focusSent = sig;
    this.post({ type: 'studioFocus', part: this.part, extra });
  }

  // ---- animations that start by themselves, and reactions ----
  /** The Automatic line of the animation on show, and the Reactions tab. */
  private showAuto() {
    const c = this.cur, f = autoFields(c?.def), a = this.automatic;
    a.min.value = f.min === null ? '' : String(f.min);
    a.max.value = f.max === null ? '' : String(f.max);
    a.when.value = f.when;
    for (const box of [a.min, a.max, a.when]) box.disabled = !c || c.preset || !this.editable();
    a.row.title = c?.preset ? 'A preset cannot start by itself: "Edit copy" first' : '';
    const every = f.min === null && f.max === null ? '' : f.min === f.max ? `every ${f.min} s` : `every ${f.min ?? 3} to ${f.max ?? 6} s`;
    a.row.querySelector<HTMLElement>('.as-auto-hint')!.textContent = !c ? '' : every && f.when ? `Starts by itself ${every}, only while ${f.when}.`
      : every ? `Starts by itself ${every}, after the previous run ends.` : f.when ? `Loops by itself while ${f.when}.`
      : 'Not automatic: plays only when a script says animate. Fill in a field to make it start by itself.';    this.reactionPanel.sync();
  }
  /** The working copy of what runs by itself goes to the stage (Model mode runs the reactions), with the test variables. */
  private postAuto() { this.post({ type: 'studioAuto', reactions: this.reactions, poses: this.poses, vars: this.testVars }); }

  // ---- Model mode: authoring the keyforms of parameters, parameter first (as in Live2D Cubism) ----
  // The author picks the parameter (activeControl, never guessed), picks the parts it moves (a click on the stage or the tick in the Parts tree:
  // each pick binds the part and makes its keys at once, at rest), clicks a key to put the slider there and poses the part with the gizmo or the
  // Warp tool. The pure half is engine/src/param-bind.ts and keyform-edit.ts; the block under the controls is editor/anim-bind.ts.
  /**
   * The status line's hint in Model mode: what a press does and the keys. The mode and what the tool works on are the tool options bar's
   * (showBar), so the line stays one line.
   */
  private modelHint(): string {
    const tool = this.gizmo.tool;
    if (tool === 'pivot') return 'Click the stage to place the pivot of the chosen part · Esc back to Move · Ctrl+Z undo · ' + this.leaveKey(true);
    if (tool === 'warp') return 'Choose a part with a warp (Bind parts… keys its lattice to the active parameter), then drag its lattice points at each key; Esc with no point selected goes back to Move · Ctrl+Z undo · ' + this.leaveKey(true);
    if (tool === 'weights') return weightsHint(this.weightsPanel.brush(), this.weightsPanel.activeBone(), this.weightsPanel.target() !== null, this.leaveKey(true));
    if (tool === 'mask') return 'Click the outline of a shape (or a part clipped to one) to choose it (Bind parts… keys its points to the active parameter), then drag its points at each key; Esc goes back to Move · Ctrl+Z undo · ' + this.leaveKey(true);
    // A chosen part whose gizmo poses the bone it sits on (the bar says so): how to choose the bone itself.
    const target = this.gizmoSubject(), back = tool === 'move' ? '' : 'Esc back to Move · ';
    const posed = this.part !== null && target !== null && target !== this.part && this.host.parts.includes(this.part) ? "Alt-click the part, or click its bone's dot, to choose the bone · " : '';
    // What to do next for this focus (the hint the Keyforms section used to show), then the keys.
    const next = this.binder ? this.bindView().hint : '';
    const first = !this.parameters.length && !this.pads.length ? 'Add a parameter with + in Parameters, then press Bind parts…' : 'Pick a parameter, press Bind parts…';
    return posed + (next ? `${next} · Ctrl-click on the stage adds a part, so one drag poses them all · ` : first + ' and tick the parts it moves (Ctrl-click on the stage adds a part so one drag poses them all), click a key and pose the part with the gizmo (W, E, R) · ') + back + 'Ctrl+Z undo · ' + this.leaveKey(tool !== 'move');
  }
  /** The status line's hint and the tool options bar, after anything that changes the tool, the mode or the focus. */
  private showStatus() {
    this.checkNote();
    this.note.dataset.hint = this.modeling ? this.modelHint() : 'Space play or pause · ' + (this.gizmo.autoKey ? 'Shift+K Auto-key off · ' : 'K key the drags · Shift+K Auto-key on · ') + (this.gizmo.tool === 'move' ? '' : 'Esc back to Move · ') + 'Ctrl+Z undo · ' + this.leaveKey(this.gizmo.tool !== 'move');
    this.showBar();
    this.gizmo.send(); // the gizmo's lock follows the same focus as the bar's line (sent only when it changed)
  }
  /**
   * A note says what the last action did: once the mode, tool, focus, animation or working copy moved on and the action wrote no note of
   * its own, it goes and the hint shows. Checked once at the end of the action, which may redraw the status several times.
   */
  private noteCheck = false;
  private checkNote() {
    if (!this.noteCheck) { this.noteCheck = true; queueMicrotask(() => { this.noteCheck = false; this.settleNote(); }); }
  }
  private settleNote() {
    const ctx = [this.mode, this.gizmo.tool, this.part, [...this.extras].join(','), this.activeControl, this.cur?.name, this.revision].join('|');
    if (!keepNote(this.noteSeen, { ctx, text: this.note.textContent ?? '' })) this.note.textContent = '';
    this.noteSeen = { ctx, text: this.note.textContent ?? '' };
  }
  /** The tool options bar: the panel of the tool in use, its mode label, and for Move, Rotate and Scale what the gizmo writes to (studio-inspector.ts). */
  private showBar() {
    const tool = this.gizmo.tool, kind = toolBar(tool);
    for (const p of this.bar.querySelectorAll<HTMLElement>('.atb')) p.hidden = p.dataset.bar !== kind;
    const label = this.bar.querySelector<HTMLElement>('.atb-mode')!;
    label.hidden = kind === 'gizmo';
    if (kind === 'weights') {
      const w = this.weightsPanel.label();
      label.textContent = modeLabel('weights', w ? this.part : null, w?.brush, w?.bone);
    } else if (kind !== 'gizmo') label.textContent = modeLabel(tool, this.part);
    label.title = label.textContent ?? '';
    if (kind !== 'gizmo') return;
    const line = this.bar.querySelector<HTMLElement>('.atb-line')!, text = gizmoLine(this.gizmoState());
    line.textContent = text;
    line.title = text;
  }
  /** What the Move, Rotate and Scale gizmo poses and whether a drag on it would be kept: the bar's line, and the lock the stage draws. */
  private gizmoState(): GizmoLineState {
    const part = this.part, subject = this.gizmoSubject();
    if (!this.modeling) {
      const a = this.cur;
      return { mode: 'animate', chosen: part, subject, anim: a ? { name: a.name, preset: a.preset } : null, autoKey: this.gizmo.autoKey };
    }
    const d = this.driver(), shape = this.maskKey(part);
    const other = part && d ? [...new Set(boundParts(this.bindDoc(), d).filter(b => b.kind !== 'pose' && (b.target === part || (b.kind === 'mask' && b.target === shape))).map(b => b.kind as 'warp' | 'mask'))] : [];
    // With no parameter active, the ones that already move the part (a click on one keeps the part; on another, it chooses that parameter alone).
    const movedBy = !d && part && this.binder ? [...new Set(this.bindView().affecting.map(a => a.name))] : [];
    // A drag writes the Ctrl-clicked parts with the chosen one when the gizmo stands on it (keyformDrag).
    const setBound = !!d && subject !== null && subject === part && [...this.extras].some(t => isBound(this.keyforms, t, d));
    return { mode: 'model', chosen: part, subject, param: d ? this.activeName() : null, bound: !!d && subject !== null && isBound(this.keyforms, subject, d), setBound, other, movedBy, hasParams: this.parameters.length + this.pads.length > 0 };
  }
  /** The bone a row sits on (a part's bone, a mask shape's bone), when it is a bone of the rig; null for a bone row or none. */
  private boneOfRow(name: string): string | null {
    const bone = this.host.parts.includes(name) ? this.partBones[name]?.bone : this.shapes[name]?.bone;
    return bone !== undefined && Object.hasOwn(this.bones, bone) ? bone : null;
  }
  /**
   * What the gizmo moves in Model mode, for a chosen part: the part itself when the active parameter poses it by a keyform of its own, else
   * the bone it sits on (engine poseTarget); the chosen row stays what the Deform, Skin and Clip sub-blocks work on. Else the chosen row.
   */
  private gizmoSubject(): string | null { return this.poserFor(this.driver()); }
  /** Is `spot` on the active parameter (or pad)? */
  private keyedSpotIs(spot: KeySpot): boolean {
    const d = this.driver();
    return !!d && (isPadSpot(spot) ? 'params' in d && d.params[0] === spot.params[0] && d.params[1] === spot.params[1] : 'param' in d && d.param === spot.param);
  }
  /** What a parameter (`driver`) poses for the chosen row: the part when it is bound to it by a pose of its own, else the bone it sits on. */
  private poserFor(driver: BindDriver | null): string | null {
    const part = this.part;
    if (!this.modeling || part === null || !this.host.parts.includes(part)) return part;
    return poseTarget(part, this.boneOfRow(part), !!driver && isBound(this.keyforms, part, driver));
  }
  private controlExists(control: string): boolean {
    return control.startsWith('pad:') ? this.pads.some(p => `pad:${p.id}` === control) : this.parameters.some(p => p.id === control);
  }
  /** The active parameter's control key (a parameter id, or `pad:<id>`), or null while the author has picked none. */
  private keyedControl(): string | null {
    if (!this.modeling) return null;
    return this.activeControl && this.controlExists(this.activeControl) ? this.activeControl : null;
  }
  /** Does `control` move `part` in any way (its pose, its warp or its mask)? The focus pairs them then, whichever tool is on. */
  private boundToControl(part: string, control: string): boolean {
    const d = driverOf(control, this.parameters, this.pads);
    if (!d) return false;
    const shape = this.maskKey(part);
    return boundParts(this.bindDoc(), d).some(b => b.target === part || (b.kind === 'mask' && b.target === shape));
  }
  /**
   * A control was chosen (its name or row, the ◆, a "Moved by" button). The chosen part stays when the control moves it, which is a keyform focus;
   * otherwise the control is the focus alone and the part is dropped.
   */
  private chooseControl(control: string) {
    this.activeControl = control;
    if (this.modeling && this.part !== null && !this.boundToControl(this.part, control)) { this.choosePart(null); return; }
    this.refreshView(); // the tree's ticks, Deform and the Bind block follow
  }
  private keyedSpot(): KeySpot | null {
    const control = this.keyedControl();
    return control ? this.params.spotOf(control) : null;
  }

  /** After a write the controls sit on the key that took it (a slider within reach of a key, a pad at its nearest corner). */
  private followSpot(spot: KeySpot) {
    const now = this.params.values();
    if (isPadSpot(spot)) {
      if (Math.abs(now[spot.params[0]] - spot.at[0]) > 1e-9) this.params.setValue(spot.params[0], spot.at[0]);
      if (Math.abs(now[spot.params[1]] - spot.at[1]) > 1e-9) this.params.setValue(spot.params[1], spot.at[1]);
    } else if (Math.abs(now[spot.param] - spot.value) > 1e-9) this.params.setValue(spot.param, spot.value);
  }

  /** A field of the Pose row in the Bind block; null puts the whole pose back to rest. */
  private setField(field: FormField | null, value: number) {
    const part = this.gizmoSubject(), spot = this.keyedSpot(); // the Pose fields are what the gizmo poses: the part, or the bone it follows
    if (!part || !spot) return;
    const form = field === null ? {} : { ...spotForm(this.keyforms, this.parameters, part, spot), [field]: field === 'opacity' ? Math.max(0, value) : value };
    const r = writeForm(this.keyforms, this.parameters, part, spot, form);
    if (!r) return;
    this.edit(() => { this.keyforms = r.keyforms; });
    this.followSpot(r.spot);
  }

  /**
   * Keyforms' per-key operations on what the gizmo poses at the slider's value: Copy form keeps the pose shown (a key's, or the blend between
   * keys) in the studio's own clipboard; Paste form writes it there as a key, mirrored sideways on request (one undo step); Reset puts the key
   * back to rest. Only a pose: a warp's or a mask's points are not copied.
   */
  private formOp(id: FormOpId) {
    if (this.bindKind() === 'warp') { this.warpFormOp(id); return; }
    if (this.bindKind() !== 'pose') return;
    if (id === 'resetForm') { this.setField(null, 0); return; }
    const part = this.gizmoSubject(), spot = this.keyedSpot();
    if (!part || !spot) return;
    const at = snapSpot(this.keyforms, this.parameters, part, spot) ?? spot;
    if (id === 'copyForm') {
      this.formClip = { kind: 'pose', form: spotForm(this.keyforms, this.parameters, part, spot), label: `${part} at ${spotLabel(at)}` };
      this.note.textContent = `Copied the pose of ${this.formClip.label}: Paste form puts it on another key or part.`;
      this.binder.show();
      return;
    }
    const clip = this.formClip, mirrored = id === 'pasteMirrored';
    if (clip?.kind !== 'pose') return;
    const r = pasteForm(this.keyforms, this.parameters, part, spot, clip.form, mirrored);
    if (!r) return;
    this.edit(() => { this.keyforms = r.keyforms; });
    this.followSpot(r.spot);
    this.note.textContent = `Pasted ${clip.label}${mirrored ? ', mirrored,' : ''} onto ${part} at ${spotLabel(r.spot)}. Ctrl+Z undoes it.`;
  }
  /** The warp the chosen part's keyform is edited on and the slider it is keyed to, with its value; null without either (a pad keys no warp). */
  private warpKeyform(): { def: DeformerDef; param: ParamDef; value: number } | null {
    const part = this.part, d = this.driver(), def = part ? this.warpFor(part) : undefined;
    const param = d && 'param' in d ? this.parameters.find(p => p.id === d.param) : undefined;
    return def && param ? { def, param, value: this.params.values()[param.id] ?? param.default } : null;
  }
  /** Keyforms' copy, paste and Reset for a warp binding: the shape of its keyform at the slider's value, and the chosen points (one undo step each). */
  private warpFormOp(id: FormOpId) {
    const k = this.warpKeyform();
    if (!k) return;
    const shown = (v: number) => String(Math.round(v * 1000) / 1000);
    if (id === 'resetForm') { this.warpPanel.resetChosen(); return; }
    if (id === 'copyForm') {
      this.formClip = { kind: 'warp', disp: ownDisplacement(k.def, k.param, k.value), label: `${k.def.id} at ${k.param.id} ${shown(k.value)}` };
      this.note.textContent = `Copied the shape of ${this.formClip.label}: Paste form puts it on another key, or on a warp of the same size.`;
      this.binder.show();
      return;
    }
    const clip = this.formClip, mirrored = id === 'pasteMirrored';
    if (clip?.kind !== 'warp') return;
    const next = pasteWarpForm(k.def, k.param, k.value, clip.disp, mirrored);
    if (next === k.def) { this.note.textContent = 'That is the shape this keyform has already.'; return; }
    this.edit(() => { this.deformers = replaceDeformer(this.deformers, next); });
    this.note.textContent = `Pasted ${clip.label}${mirrored ? ', mirrored,' : ''} onto ${k.def.id} at ${k.param.id} ${shown(k.value)}. Ctrl+Z undoes it.`;
  }
  /** What the Parameter section shows: the active parameter (with the pad it is an axis of) or pad; null when none is active. */
  private paramPropsView(): ParamPropsView {
    const c = this.keyedControl();
    if (!c) return null;
    if (c.startsWith('pad:')) { const pad = this.pads.find(p => `pad:${p.id}` === c); return pad ? { kind: 'pad', pad } : null; }
    const def = this.parameters.find(p => p.id === c);
    return def ? { kind: 'slider', def, pad: this.pads.find(p => p.x === c || p.y === c)?.id ?? null } : null;
  }

  /** The ease select of the Pose row: the curve into the slider key at the spot (one undo step). */
  private setEase(ease: string) {
    const part = this.gizmoSubject(), spot = this.keyedSpot();
    if (!part || !spot) return;
    const next = setKeyEase(this.keyforms, this.parameters, part, spot, ease);
    if (next) this.edit(() => { this.keyforms = next; });
  }

  /** "+ column" / "+ row" on a pad: a grid line at the dot's value, so a corner sits exactly there. */
  private addGridLine(params: [string, string], axis: 'x' | 'y', value: number) {
    const part = this.part;
    if (!part) { this.note.textContent = 'Choose a part or bone first; the grid belongs to it.'; return; }
    const r = extendGrid(this.keyforms, this.parameters, part, params, axis, value);
    if (!r.added) { this.note.textContent = `There is a grid line there already (or ${part}'s grid has the most lines it can).`; return; }
    this.edit(() => { this.keyforms = r.keyforms; });
    this.note.textContent = `Added a grid line at ${axis === 'x' ? params[0] : params[1]} = ${Math.round(value * 1000) / 1000} to the grid of ${part}; the pose did not change.`;
  }


  // The author picks the parameter (activeControl, never guessed), picks the parts it moves (a click on the stage or the tick in the Parts tree:
  // each pick binds the part and makes its keys at once, at rest), clicks a key to put the slider there and poses the part with the gizmo or the
  // Warp tool. The pure half is engine/src/param-bind.ts; the block under the controls is editor/anim-bind.ts.
  private driver(): BindDriver | null {
    const c = this.keyedControl();
    return c ? driverOf(c, this.parameters, this.pads) : null;
  }
  private bindDoc(): BindDoc { return { keyforms: this.keyforms, deformers: this.deformers, shapes: this.shapes }; }
  private shapeSet(): ShapeSet { return { shapes: this.shapes, clips: this.clips, deformers: this.deformers }; }
  /** The shape the Mask tool binds for a row: a shape row itself, or the shape a part is clipped to. */
  private maskKey(name: string | null): string | null {
    if (name === null) return null;
    if (Object.hasOwn(this.shapes, name)) return name;
    const to = this.clips[name];
    return to !== undefined && Object.hasOwn(this.shapes, to) ? to : null;
  }
  /** What a pick binds, by the tool that is on: the pose of a bone or part, the lattice of a warp (Warp tool) or the points of a drawn mask (Mask tool). */
  private bindKind(): BindKind { return this.gizmo.tool === 'warp' ? 'warp' : this.gizmo.tool === 'mask' ? 'mask' : 'pose'; }
  private activeName(): string {
    const c = this.keyedControl();
    return c && c.startsWith('pad:') ? c.slice(4) : c ?? '';
  }
  private isBoundHere(part: string): boolean {
    const d = this.driver();
    const kind = this.bindKind(), target = kind === 'mask' ? this.maskKey(part) : part;
    return !!d && target !== null && boundParts(this.bindDoc(), d).some(b => b.target === target && b.kind === kind);
  }

  /** Bind `part` to the active parameter as the tool says (one undo step) and say what was made. */
  /** The warp a bind, unbind or slider mark of `part` is about: the one Deform's Target ▾ chooses for the chosen row, else the part's own warp, else its group's. */
  private warpFor(part: string): DeformerDef | undefined {
    const id = part === this.part ? this.warpPanel.target() : null;
    return id ? deformerById(this.deformers, id) : deformerOf(this.deformers, part) ?? groupOf(this.deformers, part);
  }
  private bindPart(part: string): boolean {
    const driver = this.driver(), kind = this.bindKind(), name = this.activeName();
    if (!driver) { this.note.textContent = 'Pick a parameter first: click its name in the Parameters section.'; this.openSection('params'); return false; }
    if (kind !== 'pose' && 'params' in driver) {
      this.note.textContent = `A ${kind} is keyed to one slider, not to a pad. Use the buttons under the pad to make ${driver.params.join(' or ')} the active parameter.`;
      return false;
    }
    let bound = false;
    this.edit(() => {
      if (kind === 'pose') { const r = bindPose(this.keyforms, this.parameters, part, driver, this.bindSize); if (r.bound) { this.keyforms = r.keyforms; bound = true; } }
      else if ('param' in driver && kind === 'warp') { const r = bindDeformer(this.deformers, this.parameters, part, driver.param, this.warpFor(part)?.id); if (r.bound) { this.deformers = r.deformers; bound = true; } }
      else if ('param' in driver) { const r = bindMask(this.shapes, this.parameters, this.maskKey(part) ?? part, driver.param); if (r.bound) { this.shapes = r.shapes; bound = true; } }
    });
    if (!bound) {
      this.note.textContent = kind === 'warp' && !this.warpFor(part) ? `${part} has no warp yet: choose it, then Add warp in Properties › Deform.`
        : kind === 'mask' && this.maskKey(part) === null ? `${part} has no mask shape to key: choose a shape, or a part that is clipped to one.`
        : `${part} is bound to ${name} already.`;
      return false;
    }
    const shown = (v: number) => String(Math.round(v * 1000) / 1000);
    if ('param' in driver) {
      const keys = kind === 'pose' ? keyTicks(this.keyforms, driver.param, part) : warpTicks(kind === 'warp' ? this.warpFor(part)?.keyforms : this.shapes[this.maskKey(part) ?? '']?.keyforms, driver.param);
      const how = kind === 'pose' ? `pose ${part} with the gizmo (W, E, R)` : `drag the ${kind === 'warp' ? 'lattice' : 'mask'} points`;
      this.note.textContent = `Bound ${part} to ${name}: keys at ${keys.map(k => shown(k.at)).join(', ')}, all at rest. Click a key (or move the slider to one), then ${how} there.`;
    } else {
      const g = this.keyforms.find(k => k.target === part && k.params?.[0] === driver.params[0] && k.params?.[1] === driver.params[1])?.grid;
      this.note.textContent = `Bound ${part} to ${name}: a ${g?.x.length ?? this.bindSize} × ${g?.y.length ?? this.bindSize} grid of corners, all at rest. Click a corner on the pad (or move its dot there), then pose ${part} with the gizmo (W, E, R).`;
    }
    return true;
  }

  /** The chosen part takes over the keys of `from` on the active parameter, mirrored sideways when asked (one undo step). */
  private copyKeysFrom(from: string, fromControl: string, how: { flip: boolean; reverse: boolean }) {
    const driver = this.driver(), part = this.part, name = this.activeName();
    const fromDriver = driverOf(fromControl, this.parameters, this.pads);
    if (!driver || !part || !fromDriver) return;
    let done = false;
    this.edit(() => {
      const r = copyKeys(this.keyforms, this.parameters, { target: from, driver: fromDriver }, { target: part, driver }, how);
      if (r.copied) { this.keyforms = r.keyforms; done = true; }
    });
    const other = fromControl === this.keyedControl() ? '' : ` (from ${fromControl.startsWith('pad:') ? fromControl.slice(4) : fromControl})`;
    const as = [how.flip ? 'poses mirrored' : '', how.reverse ? 'range reversed' : ''].filter(Boolean).join(', ');
    this.note.textContent = done ? `${part} took the keys of ${from}${other} on ${name}${as ? `, ${as}` : ''} (Ctrl+Z undoes it).` : `Nothing to copy from ${from} to ${part}.`;
  }

  /** Take `part` off the active parameter: its keys of that kind go (one undo step; Ctrl+Z brings them back). */
  private unbindPart(part: string, kind: BindKind) {
    const driver = this.driver(), name = this.activeName();
    if (!driver) return;
    let gone = false;
    this.edit(() => {
      if (kind === 'pose') { const r = unbindPose(this.keyforms, part, driver); if (r.unbound) { this.keyforms = r.keyforms; gone = true; } }
      else if ('param' in driver && kind === 'warp') { const r = unbindDeformer(this.deformers, part, driver.param, this.warpFor(part)?.id); if (r.unbound) { this.deformers = r.deformers; gone = true; } }
      else if ('param' in driver) { const r = unbindMask(this.shapes, this.maskKey(part) ?? part, driver.param); if (r.unbound) { this.shapes = r.shapes; gone = true; } }
    });
    if (gone) this.note.textContent = `Unbound ${part} from ${name}: its ${kind === 'pose' ? 'keys' : `${kind} keys`} there were removed (Ctrl+Z brings them back).`;
  }

  // ---- Model mode: verbs that join a part and a parameter choose their target in a picker inside the Bind block (editor/anim-bind.ts) ----
  // The stage and the lists on the left only choose the focus; they never answer a verb.
  /** What the picker of a verb lists: the parts not yet bound to the active parameter, or the parameters the chosen part is not yet bound to. */
  private pickCandidates(verb: BindVerb): PickItem[] {
    if (!this.modeling) return [];
    if (verb === 'bindToParam') {
      const part = this.part, kind = this.bindKind();
      if (!part) return [];
      const controls = [...this.parameters.map(p => p.id), ...(kind === 'pose' ? this.pads.map(p => `pad:${p.id}`) : [])];
      const bound = new Set(controls.filter(c => this.boundToControl(part, c)));
      return pickTargets(verb, controls, bound).map(c => ({ id: c, label: c.startsWith('pad:') ? c.slice(4) : c, note: c.startsWith('pad:') ? 'pad' : undefined }));
    }
    const tb = this.treeBind(), kind = this.bindKind();
    if (!tb) return [];
    // In the Parts tree's order (its rows, then what a folded bone hides), so the list reads like the tree beside it (SR-19).
    const rows = [...this.root.querySelectorAll<HTMLElement>('.as-tree .as-row[data-part]')].map(r => r.dataset.part!).filter(Boolean);
    const all = [...new Set([...rows, ...this.host.parts, ...Object.keys(this.shapes), ...Object.keys(this.bones)])]
      .filter(p => kind === 'mask' ? this.maskKey(p) !== null : !Object.hasOwn(this.shapes, p)); // a part without a warp is told so when bound
    return pickTargets(verb, all, new Set(tb.bound)).map(p => ({ id: p, label: p, note: Object.hasOwn(this.bones, p) && !this.host.parts.includes(p) ? 'bone' : undefined }));
  }
  /** The picker's button: bind the ticked parts to the active parameter, or the chosen part (and the Ctrl-clicked ones) to the ticked parameters. */
  private commitPick(verb: BindVerb, ids: string[], subtree: boolean) {
    if (!this.modeling) return;
    let n = 0, last: string | null = null;
    if (verb === 'bindParts') {
      const driver = this.driver();
      if (!driver) { this.note.textContent = 'Pick a parameter first: click its name in the Parameters section.'; this.openSection('params'); return; }
      for (const id of ids) {
        if (this.isBoundHere(id)) continue;
        if (this.bindKind() === 'warp') { const control = this.activeControl; this.choosePart(id); this.activeControl = control; } // Deform targets the chosen row
        if (subtree && this.selIsBone(id) && this.bindKind() === 'pose') { this.toggleSubtree(id, driver); n++; last = id; }
        else if (this.bindPart(id)) { n++; last = id; }
      }
      if (n > 1) this.note.textContent = `Bound ${n} parts to ${this.activeName()}: keys at rest (Ctrl+Z undoes each).`;
      if (last) { const control = this.activeControl; this.choosePart(last); this.activeControl = control; this.refreshView(); } // the parameter stays: a warp or mask is bound under another name than the part
    } else {
      const group = this.part ? [this.part, ...this.extras] : [];
      let to = '';
      for (const c of ids) {
        this.activeControl = c;
        for (const p of group) if (!this.isBoundHere(p) && this.bindPart(p)) { n++; to = this.activeName(); }
      }
      if (n > 1) this.note.textContent = `Bound ${group.join(", ")} to ${ids.length === 1 ? to : `${ids.length} parameters`} (Ctrl+Z undoes each).`;
    }
    this.refreshView();
  }
  /** A word of the breadcrumb: go up from the keyform to the part alone or to the parameter alone. */
  private goUp(to: 'part' | 'param') {
    const f = focusUp({ control: this.keyedControl(), part: this.part }, to);
    this.activeControl = f.control;
    this.choosePart(f.part, to === 'part' && f.part === this.part ? [...this.extras] : []); // up to a set alone keeps the set
  }
  /** A ticked bone in the Bind parts… picker, with "what hangs on it": bind the bone, the bones below it and their parts together, or unbind them all when the bone is bound (one undo step). */
  private toggleSubtree(bone: string, driver: NonNullable<ReturnType<AnimStudio['driver']>>) {
    const sub = boneSubtree(this.bones, this.partBones, bone), targets = [...sub.bones, ...sub.parts], name = this.activeName();
    const off = isBound(this.keyforms, bone, driver);
    let n = 0;
    this.edit(() => {
      for (const t of targets) {
        if (off) { const r = unbindPose(this.keyforms, t, driver); if (r.unbound) { this.keyforms = r.keyforms; n++; } }
        else { const r = bindPose(this.keyforms, this.parameters, t, driver, this.bindSize); if (r.bound) { this.keyforms = r.keyforms; n++; } }
      }
    });
    this.note.textContent = n ? `${off ? 'Unbound' : 'Bound'} ${n} target${n === 1 ? '' : 's'} (${bone}, what is below it and their parts) ${off ? 'from' : 'to'} ${name}${off ? '' : ': all at rest'} (Ctrl+Z undoes it).` : `Everything under ${bone} is bound to ${name} already.`;
    if (!off) this.choosePart(bone);
  }

  /** A row of the bound list: choose that part, with the tool that edits what is bound (the Warp tool for a warp, the Mask tool for a mask, Move otherwise). */
  private focusBound(target: string, kind: BindKind) {
    const want = kind === 'warp' ? 'warp' : kind === 'mask' ? 'mask' : this.gizmo.tool === 'warp' || this.gizmo.tool === 'mask' ? 'move' : null;
    if (want && this.gizmo.tool !== want) this.gizmo.setTool(want);
    this.choosePart(target);
  }

  /** The marks of the Parts tree: the parts bound to the active parameter by the kind the tool says. */
  private treeBind(): { bound: string[]; what: string; kind: string } | null {
    const d = this.driver();
    if (!d) return null;
    const kind = this.bindKind(), name = this.activeName();
    const bound = boundParts(this.bindDoc(), d).filter(b => b.kind === kind).map(b => b.target);
    // A part clipped to a bound shape counts as bound with it: a pick on it binds that shape.
    if (kind === 'mask') bound.push(...Object.entries(this.clips).filter(([, to]) => bound.includes(to)).map(([p]) => p));
    return { bound, what: kind === 'pose' ? name : `${name} (${kind})`, kind };
  }

  /** The marks on a slider's track: the chosen part's keys on it (its warp's and mask's too). The active slider shows the keys of every part bound to it while the chosen part has none. */
  private ticksOf(id: string): KeyTick[] {
    // The active parameter's track marks the keys the Keys row lists, of what the gizmo poses (the part, or the bone it follows); the others, the part's own.
    const part = this.part, poser = this.keyedControl() === id ? this.poserFor({ param: id }) : part, mine = new Map<number, boolean>();
    const add = (list: KeyTick[]) => { for (const t of list) mine.set(t.at, (mine.get(t.at) ?? false) || t.posed); };
    if (part) { add(keyTicks(this.keyforms, id, poser ?? part)); add(warpTicks(this.warpFor(part)?.keyforms, id)); add(warpTicks(this.shapes[this.maskKey(part) ?? '']?.keyforms, id)); }
    if (!mine.size && this.keyedControl() === id) add(keyTicks(this.keyforms, id));
    return [...mine].map(([at, posed]) => ({ at, posed })).sort((a, b) => a.at - b.at);
  }
  /** The corners drawn on a pad: the chosen part's grid, else the grids of every part. */
  private cornersOf(x: string, y: string) {
    const active = this.driver(), poser = active && 'params' in active && active.params[0] === x && active.params[1] === y ? this.poserFor(active) : this.part;
    const mine = poser ? padCorners(this.keyforms, [x, y], poser) : [];
    return mine.length ? mine : padCorners(this.keyforms, [x, y]);
  }

  /** A finished gizmo drag in Model mode: the active parameter decides where it is written. A part not bound to it yet is not written to (Bind parts… first). */
  private keyformDrag(name: string, delta: Offset) {
    const driver = this.driver(), spot = this.keyedSpot(), pad = driver ? 'params' in driver : false;
    if (!driver || !spot) {
      this.note.textContent = this.parameters.length
        ? `Nothing was written: ${name} is chosen without a parameter. Press one of the buttons in Moved by (or Bind to parameter…) to pose it at a key, then drag again.`
        : 'Nothing was written: this character has no parameters yet. Add one in the Parameters section (New parameter), then pose again.';
      this.openSection('params');
      this.refreshView();
      return;
    }
    // The chosen parts move together: the dragged one and every part Ctrl-clicked with it, each by the same delta.
    const group = name === this.part ? [name, ...this.extras] : [name];
    // A drag writes into what is bound; binding is its own verb ("Bind parts…"). The bound ones of a Ctrl-click set are written, and the note names the rest.
    const writable = group.filter(t => isBound(this.keyforms, t, driver)), skipped = group.filter(t => !writable.includes(t));
    if (!writable.length) {
      this.note.textContent = this.unboundDragNote(name, skipped);
      this.refreshView();
      return;
    }
    let written: KeySpot | null = null, wrote: string[] = [];
    this.edit(() => {
      const r = dragForms(this.keyforms, this.parameters, writable, spot, delta, this.params.values());
      if (r) { this.keyforms = r.keyforms; written = r.spot; wrote = r.written; }
    });
    if (!written) return;
    const at: KeySpot = written;
    this.followSpot(at);
    const who = wrote.length > 1 ? `${wrote.length} parts (${wrote.join(', ')})` : wrote[0] ?? name;
    const left = skipped.length ? ` ${skipped.join(', ')} ${skipped.length > 1 ? 'are' : 'is'} not bound to ${this.activeName()}, so ${skipped.length > 1 ? 'they' : 'it'} did not move (Bind parts… binds ${skipped.length > 1 ? 'them' : 'it'}).` : '';
    this.note.textContent = `Wrote ${who} at ${spotLabel(at)} as ${wrote.length > 1 ? 'keyforms' : 'a keyform'}${pad ? ' (a corner of the grid)' : ''}. Ctrl+Z undoes the whole drag.${left}`;
  }
  /** Why a gizmo drag wrote nothing, and what to bind: the part alone, or the bone it sits on (the gizmo stands there then), or the tool for a warp or mask binding. */
  private unboundDragNote(name: string, unbound: string[]): string {
    const param = this.activeName(), part = this.part, d = this.driver();
    const kinds = part && d ? [...new Set(boundParts(this.bindDoc(), d).filter(b => b.kind !== 'pose' && (b.target === part || (b.kind === 'mask' && b.target === this.maskKey(part)))).map(b => b.kind))] : [];
    const other = kinds.length ? `${part} is bound to ${param} by its ${kinds.join(' and ')}, not by a pose: drag its ${kinds.map(k => (k === 'warp' ? 'lattice points with the Warp tool (D)' : 'shape points with the Mask tool (M)')).join(', or its ')}. ` : '';
    if (part !== null && name !== part && this.host.parts.includes(part)) // the gizmo stands on the bone: neither is bound
      return `Nothing was written. ${other}Neither ${part} nor its bone ${name} is bound to ${param} by a pose: Bind parts… binds ${part} alone, or ${name} with the parts on it, then pose again.`;
    if (other) return `Nothing was written. ${other}Bind parts… binds a pose as well.`;
    return `Nothing was written: ${unbound.join(', ')} ${unbound.length > 1 ? 'are' : 'is'} not bound to ${param} yet. Use Bind parts… and tick ${unbound.length > 1 ? 'them' : 'it'}, then pose again.`;
  }

  /**
   * The ◆ on a palette row in Model mode: the control becomes the active parameter without dropping the chosen part (the ◆ acts on it, so
   * this is not the focus rule of a click on a name); when neither the part nor its bone is bound, the part is bound first, as the ◆ says;
   * then its key at the value is added or taken away. A bind that made the key at this value already stops there.
   */
  private keyFromControl(control: string, spot: KeySpot) {
    if (this.part === null || this.bindKind() !== 'pose') { this.chooseControl(control); this.toggleKey(spot); return; }
    this.activeControl = control;
    const target = this.gizmoSubject(), d = this.driver();
    if (target !== null && d && !isBound(this.keyforms, target, d)) {
      if (!this.bindPart(this.part) || isKeyed(this.keyforms, this.parameters, this.part, spot)) { this.refreshView(); return; }
    }
    this.toggleKey(spot);
    this.refreshView();
  }

  /** The ◆ of a control and "Add key here": a key of what the gizmo poses (the chosen part, or the bone it follows) at the slider's value, or take the one there away. Nothing bound gets nothing. */
  private toggleKey(spot: KeySpot | null) {
    const part = this.gizmoSubject(), driver = this.driver();
    if (!driver || !spot) return;
    if (!part) { this.note.textContent = 'Choose a part or bone first: click it on the stage or in the Parts tree.'; return; }
    if (this.bindKind() === 'warp') { this.toggleWarpKey(); return; }
    if (this.bindKind() !== 'pose') { this.note.textContent = 'A mask shape\'s keys are written in rig.json: the Mask tool edits its rest outline. Choose Move, Rotate or Scale to key a pose, or the Warp tool to key a warp.'; return; }
    if (!isBound(this.keyforms, part, driver)) { this.note.textContent = `${part} is not bound to ${this.activeName()} yet: use Bind parts… and click it first.`; return; }
    if (isPadSpot(spot)) return;
    const at = snapSpot(this.keyforms, this.parameters, part, spot) ?? spot;
    if (isKeyed(this.keyforms, this.parameters, part, spot)) {
      const r = removeKey(this.keyforms, this.parameters, part, spot);
      if (!r.removed) { this.note.textContent = `The key at ${spotLabel(at)} stays: it is the rest pose the others are posed against.`; return; }
      this.edit(() => { this.keyforms = r.keyforms; });
      this.note.textContent = `Removed the key of ${part} at ${spotLabel(at)}.`;
      return;
    }
    const w = writeForm(this.keyforms, this.parameters, part, spot, spotForm(this.keyforms, this.parameters, part, spot));
    if (!w) return;
    this.edit(() => { this.keyforms = w.keyforms; });
    this.followSpot(w.spot);
    this.note.textContent = `Added a key for ${part} at ${spotLabel(w.spot)}, holding the pose on show. Change it with the gizmo or the Pose fields.`;
  }

  /** Keyforms' Add key / Remove this key with the Warp tool: a key of the chosen part's warp at the slider's value, holding the shape on show, or the one there taken away (one undo step). */
  private toggleWarpKey() {
    const k = this.warpKeyform();
    if (!k) { this.note.textContent = this.part && !this.warpFor(this.part) ? `${this.part} has no warp yet: Add warp in Properties › Deform.` : 'A warp is keyed to one slider, not to a pad.'; return; }
    const shown = (v: number) => String(Math.round(v * 1000) / 1000);
    const on = warpKeyAt(k.def, k.param, k.value), next = on === null ? addWarpKey(k.def, k.param, k.value) : deleteWarpKey(k.def, k.param, k.value);
    if (next === k.def) return;
    this.edit(() => { this.deformers = replaceDeformer(this.deformers, next); });
    this.note.textContent = on === null ? `Added a key of ${k.def.id} at ${k.param.id} ${shown(k.value)}, holding the shape on show. Drag points (or type their move) to change it.`
      : `Removed the key of ${k.def.id} at ${k.param.id} ${shown(on)} (Ctrl+Z brings it back).`;
  }

  /** Everything the Bind block shows. */
  private bindView(): BindView {
    const driver = this.driver(), control = this.keyedControl(), part = this.part, kind = this.bindKind();
    const none: BindView = { active: null, chosen: part, bound: [], crumb: breadcrumb({ control: null, part }, '', '', null), header: null, prevKey: null, nextKey: null, keyAction: null, keys: [], size: this.bindSize, form: { text: '', values: null, can: false }, affecting: [], copyFrom: [], hint: '' };
    if (!this.modeling) return none;
    const doc = this.bindDoc();
    const shapeKey = this.maskKey(part);
    const affecting = part ? [...affectedBy(doc, part), ...(shapeKey !== null && shapeKey !== part ? affectedBy(doc, shapeKey).filter(a => a.kind === 'mask') : [])].flatMap(a => {
      const c = controlOf(a.driver, this.parameters, this.pads);
      return c ? [{ control: c, name: c.startsWith('pad:') ? c.slice(4) : c, kind: a.kind, active: c === control }] : [];
    }) : [];
    // What the focus header offers (studio-inspector.ts focusHeader): its pickers and verbs, by how much each would list.
    const header = (param: string | null, bound: number, copySources: number, form?: BindView['form']) => focusHeader({
      mode: 'model', part, param, hasParams: this.parameters.length + this.pads.length > 0, bound, bindable: param !== null ? this.pickCandidates('bindParts').length : 0,
      movedBy: affecting.length, bindableParams: part ? this.pickCandidates('bindToParam').length : 0, kind, copySources,
      ...(part !== null && this.extras.size ? { set: { names: [part, ...this.extras], parts: !!this.setParts() } } : {}),
      form: form && {
        can: form.can, keyed: !!form.values, clip: this.formClip?.label ?? null, clipKind: this.formClip?.kind,
        ...(form.points && wkDef ? { fits: this.formClip?.kind === 'warp' && this.formClip.disp.length === deformerPoints(wkDef) * 2, lattice: !wkDef.mesh, selected: this.warpPanel.selection.length } : {}),
      },
    });
    const wkDef = kind === 'warp' && part ? this.warpFor(part) : undefined;
    if (!driver || !control) {
      const hint = !this.parameters.length ? 'This character has no parameters yet: + in Parameters adds a slider.'
        : part ? `${part} is chosen without a parameter: the ▾ after "no parameter" lists what moves it, Bind to parameter… binds it to another.`
        : 'Click the name of a parameter in Parameters to make it the active one, then press Bind parts… to choose the parts it moves.';
      return { ...none, affecting, header: header(null, 0, 0), hint };
    }
    const shown = (v: number) => String(Math.round(v * 1000) / 1000);
    const def = 'param' in driver ? this.parameters.find(p => p.id === driver.param) : undefined;
    const pad = 'params' in driver ? this.pads.find(p => `pad:${p.id}` === control) : undefined;
    const name = this.activeName();
    const active = { control, name, pad: 'params' in driver, span: def ? `${shown(def.min)} to ${shown(def.max)}, default ${shown(def.default)}` : pad ? `${pad.x} across, ${pad.y} up` : '' };
    // What the pose fields, the keys and the breadcrumb speak about: with the Move, Rotate or Scale tool, what the gizmo poses (the part, or the bone it follows).
    const poser = part !== null && kind === 'pose' ? this.gizmoSubject() ?? part : part;
    const bound: BindRow[] = boundParts(doc, driver).map(b => ({ ...b, chosen: b.target === part || b.target === poser || this.extras.has(b.target) || (b.kind === 'mask' && b.target === shapeKey) }));
    const here = bound.find(b => b.target === (kind === 'mask' ? shapeKey : poser) && b.kind === kind);
    // How the chosen part is bound when not the way the tool binds: the panel names that binding and the tool that edits it, instead of "not bound".
    const otherKinds = part ? [...new Set(bound.filter(b => b.kind !== kind && (b.kind === 'mask' ? b.target === shapeKey : b.target === part)).map(b => b.kind))] : [];
    const toolFor = (k: BindKind) => k === 'warp' ? 'the Warp tool (D)' : k === 'mask' ? 'the Mask tool (M)' : 'Move, Rotate or Scale (W, E, R)';
    const boundOtherwise = otherKinds.length ? `${part} is bound to ${name} by its ${otherKinds.join(' and ')}: choose ${otherKinds.map(toolFor).join(' or ')} to edit ${otherKinds.length > 1 ? 'those keys' : 'its keys'}` : '';
    const spot = this.keyedSpot(), poseBound = !!poser && isBound(this.keyforms, poser, driver);
    const onBone = poser !== null && poser !== part; // the gizmo poses the bone the chosen part sits on
    let keyAction: BindView['keyAction'] = null, keys: BindView['keys'] = [], prevKey: number | null = null, nextKey: number | null = null;
    if (poser && def && kind === 'pose' && poseBound) {
      const v = this.params.values()[def.id], tol = KEY_SNAP * (def.max - def.min);
      keys = keyTicks(this.keyforms, def.id, poser).map(t => ({ ...t, here: Math.abs(t.at - v) <= tol }));
      keyAction = spot && isKeyed(this.keyforms, this.parameters, poser, spot) ? (Math.abs(v - def.default) <= tol ? 'default' : 'remove') : 'add';
      prevKey = keys.filter(k => k.at < v - tol).at(-1)?.at ?? null;
      nextKey = keys.find(k => k.at > v + tol)?.at ?? null;
    }
    // A warp binding (Warp tool): the keys of the warp Deform targets on the slider, which Add / Remove key changes; a mask's keys only
    // to go to (studio-inspector.ts pointKeyStrip). A warp with no keys on the slider yet shows an empty strip: a drag or Add key makes the first.
    const wk = kind === 'warp' && part ? this.warpKeyform() : null;
    const maskKfs = kind === 'mask' && here && def ? this.shapes[shapeKey ?? '']?.keyforms : undefined;
    const strip = wk ? pointKeyStrip(warpTicks(wk.def.keyforms, wk.param.id), wk.value, WARP_KEY_SNAP * (wk.param.max - wk.param.min), 'warp')
      : maskKfs && def ? pointKeyStrip(warpTicks(maskKfs, def.id), this.params.values()[def.id] ?? def.default, WARP_KEY_SNAP * (def.max - def.min), 'mask') : null;
    if (strip) ({ keys, prev: prevKey, next: nextKey, action: keyAction } = strip);
    const onKey = strip?.keys.find(k => k.here) ?? null;
    let form: BindView['form'] = { text: '', values: null, can: false };
    if (part) {
      if (wk) {
        const who = Array.isArray(wk.def.members) ? `group warp ${wk.def.id}` : `the warp of ${part}`;
        form = {
          text: onKey ? `${who} at ${shown(onKey.at)} (a key): a drag changes it`
            : strip!.keys.length ? `${who} at ${shown(wk.value)}: between keys, a drag makes a key`
            : `${name} has no keys on ${who} yet: dragging a point makes the first, with rest at ${shown(wk.param.default)}`,
          values: null, can: true, points: true, name: 'Warp',
        };
      } else if (kind === 'warp') form = { text: boundOtherwise ? `${boundOtherwise}.` : this.warpFor(part) ? `A warp is keyed to one slider, not to a pad: make ${pad ? `${pad.x} or ${pad.y}` : 'a slider'} the active parameter.` : `${part} has no warp yet: Add warp in Properties › Deform.`, values: null, can: false, name: 'Warp' };
      else if (kind === 'mask') form = { text: here ? `The keys of ${shapeKey} on ${name} reshape it; they are written in rig.json. The Mask tool (M) edits its rest outline (Properties, Clip).` : boundOtherwise ? `${boundOtherwise}.` : `${part} is not bound to ${name} by a mask yet. Use Bind parts… above and tick it.`, values: null, can: false, name: 'Shape' };
      else if (!poseBound) form = {
        text: onBone ? `${boundOtherwise ? `${boundOtherwise}. ` : ''}Neither ${part} nor its bone ${poser} is bound to ${name} by a pose: Bind parts… above binds ${part} alone, or ${poser} with the parts on it.`
          : boundOtherwise ? `${boundOtherwise}. Bind parts… above adds a pose binding as well.` : `${part} is not bound to ${name} yet. Use Bind parts… above and tick it.`,
        values: null, can: false,
      };
      else if (spot && poser) {
        const snapped = snapSpot(this.keyforms, this.parameters, poser, spot) ?? spot, stored = formAt(this.keyforms, this.parameters, poser, spot);
        const who = onBone ? `${poser} (the bone ${part} sits on)` : poser;
        form = { text: isPadSpot(snapped) ? `${who} at the corner ${spotLabel(snapped)} (the nearest to the dot)` : `${who} at ${spotLabel(snapped)}${stored ? ' (a key)' : ': between keys, a drag or a field makes a key here'}`, values: stored as FullForm | null, can: true, ease: easeAt(this.keyforms, this.parameters, poser, spot) };
      }
    } else form = { text: 'Choose a part (the stage or the tree) to see and edit its pose at the keys.', values: null, can: false };
    const hint = !bound.length ? `No parts are bound to ${name} yet. Press Bind parts… and tick the parts it moves in the list: that makes their keys at once, all at rest.`
      : !part ? `Choose a part bound to ${name} (on the stage, in the tree, or in the ▾ after "no part") to pose it at the keys. Bind parts… binds more.`
      : !here ? (boundOtherwise ? `${boundOtherwise}, or press Bind parts… to bind it by a ${kind} as well.` : `${part} is not bound to ${name}: press Bind parts… and tick it.`)
      : `Click a key to put the slider there, then ${kind === 'warp' ? 'drag the lattice points on the stage' : kind === 'mask' ? 'drag the points of the shape on the stage' : `pose ${onBone ? `${poser}, the bone ${part} sits on,` : 'the chosen part'} with the gizmo (W, E, R)`}. Bind parts… adds more.`;
    // Pose keys of the same kind (slider or pad) to take over: other parts on this parameter, and any part, the chosen one too, on another.
    const copyFrom: BindView['copyFrom'] = [];
    if (part && kind === 'pose') {
      for (const k of this.keyforms) {
        const d: BindDriver | null = k.params && k.grid ? { params: k.params } : k.param && k.keys ? { param: k.param } : null;
        const c = d && 'params' in d === 'params' in driver ? controlOf(d, this.parameters, this.pads) : null;
        if (!c || (c === control && k.target === part)) continue;
        copyFrom.push({ target: k.target, control: c, label: c === control ? k.target : `${k.target} on ${c.startsWith('pad:') ? c.slice(4) : c}` });
      }
    }
    const valueText = spot ? (isPadSpot(spot) ? spotLabel(snapSpot(this.keyforms, this.parameters, part ?? '', spot) ?? spot) : shown(spot.value)) : '';
    // Whether a key is at the value is asked only of something the gizmo can write (a pad's dot counts at its nearest corner).
    const keyedHere = strip ? (wk ? onKey !== null : null) // a mask drag moves the rest outline and adds no key, so its crumb promises none
      : poser && spot && kind === 'pose' && poseBound ? isKeyed(this.keyforms, this.parameters, poser, snapSpot(this.keyforms, this.parameters, poser, spot) ?? spot) : null;
    const crumb = breadcrumb({ control, part }, name, valueText, keyedHere, kind === 'pose' ? poser : null);
    return { active, chosen: part, bound, crumb, header: header(name, bound.length, copyFrom.length, form), prevKey, nextKey, keyAction, keys, size: this.bindSize, form, affecting, copyFrom, hint };
  }

  // ---- Model mode: the parameters and pads themselves ----
  private paramDoc(): ParamDoc {
    return { categories: this.categories, parameters: this.parameters, pads: this.pads, keyforms: this.keyforms, poses: this.poses, anims: this.anims, deformers: this.deformers, shapes: this.shapes, physics: this.physics };
  }
  /** Apply the result of a parameter edit as one undo step and say what happened. Returns the id the thing has now (`was` is the id a rename started from, `prefix` is `pad:` for a pad), null when refused. */
  private editParams(r: ParamEdit, was?: string, prefix = ''): string | null {
    if ('error' in r) { this.note.textContent = r.error; return null; }
    if (was !== undefined && r.id !== undefined && r.id !== was) { // a rename: what is keyed to the old id follows, before the edit redraws the controls
      if (this.activeControl === prefix + was) this.activeControl = prefix + r.id;
      if (!prefix) this.params.rename(was, r.id);
    }
    this.edit(() => {
      const d = r.doc;
      this.categories = d.categories; this.parameters = d.parameters; this.pads = d.pads; this.keyforms = d.keyforms; this.poses = d.poses; this.anims = d.anims; this.deformers = d.deformers; this.shapes = d.shapes; this.physics = d.physics;
    });
    this.note.textContent = r.note;
    return r.id ?? '';
  }

  // ---- transport ----
  /** Start or stop placing the pivot of the selected part by clicking on the stage. */
  private setPicking(on: boolean) {
    if (on && this.mode === 'model') this.gizmo.tool = 'pivot'; // asking for a pivot is choosing the Pivot tool
    this.picking = on && !!this.part && !Object.hasOwn(this.shapes, this.part) && this.mode === 'model' && this.gizmo.tool === 'pivot';
    if (this.picking && this.placer.placing) this.placer.setPlacing(false);
    if (this.picking) { this.playing = false; this.showTransport(); }
    this.post({ type: 'studioPick', part: this.picking ? this.part : null });
    this.pivotPanel.show();
    this.gizmo.send();
    this.gizmo.show();
  }
  /** Is the chosen name one of the bones (and no part)? Its pivot is then `bones.<name>.pivot`, a part's is `pivots.<name>`. */
  private selIsBone(name: string | null = this.part): name is string { return name !== null && Object.hasOwn(this.bones, name) && !this.host.parts.includes(name); }
  private selPivot(): [number, number] | undefined { const p = this.part; if (!p) return undefined; return this.selIsBone(p) ? this.bones[p].pivot : this.pivots[p]; }
  /** Set (or clear) the chosen row's pivot; a set's on every part of it. Inside an `edit`, so it is one undo step. */
  private setSelPivot(at: [number, number] | null) {
    const p = this.part, set = this.setParts();
    if (set) { this.pivots = setPivots(this.pivots, set, at); return; }
    if (!p || Object.hasOwn(this.shapes, p)) return; // a mask shape has no pivot
    if (this.selIsBone(p)) this.bones = setBonePivot(this.bones, p, at); else this.pivots = setPivot(this.pivots, p, at);
  }
  private toggle() { if (this.modeling) return; if (this.playing) this.pause(); else this.play(); }
  private play() {
    if (!this.cur) return;
    this.params.release();
    if (this.picking) this.setPicking(false);
    this.playing = true;
    this.post({ type: 'studioPlay', name: this.cur.name, dur: this.cur.dur, loop: this.loopBox.checked, part: null });
    this.showTransport();
  }
  private pause() {
    this.playing = false;
    this.post({ type: 'studioPause' });
    this.showTransport();
  }
  private seek(t: number) {
    this.t = Math.min(1, Math.max(0, t));
    this.gizmo.clearPending();
    this.params.release();
    this.playing = false;
    if (this.picking) this.setPicking(false);
    if (this.cur) this.post({ type: 'studioSeek', name: this.cur.name, t: this.t });
    this.showTransport();
    this.showTime();
  }
  private showTransport() {
    this.playBtn.textContent = this.playing ? 'Pause' : 'Play';
    this.playBtn.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
  }
  private showTime() {
    const dur = this.cur?.dur ?? 1;
    this.slider.value = String(Math.round(this.t * 1000));
    this.time.textContent = `${(this.t * dur).toFixed(2)} / ${dur.toFixed(2)} s`;
    this.slider.setAttribute('aria-valuetext', `${(this.t * dur).toFixed(2)} seconds of ${dur.toFixed(2)}`); // not 0 to 1000 (SA-11)
    const x = xOf(this.tl, this.t);
    for (const l of this.playLines) { l.setAttribute('x1', String(x)); l.setAttribute('x2', String(x)); }
    this.gizmo.show(); // the "At the playhead" fields follow scrubbing and playback
  }

  // ---- everything that depends on the animation or the selection ----
  private refreshView() {
    const c = this.cur, can = this.editable();
    this.title.textContent = `${this.char}${this.dirty ? ' •' : ''}`;
    this.showCloseGuard();
    this.tools.undo.disabled = !this.history.canUndo;
    this.tools.redo.disabled = !this.history.canRedo;
    // The buttons name the step they would take back or do again.
    const u = this.history.undoLabel, r = this.history.redoLabel;
    this.tools.undo.title = u ? `Undo: ${u.label} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
    this.tools.redo.title = r ? `Redo: ${r.label} (Ctrl+Y)` : 'Redo (Ctrl+Y)';
    this.tools.apply.disabled = !this.dirty;
    this.exportBtn.disabled = !c;
    this.durInput.disabled = !can;
    this.durInput.value = c ? String(c.dur) : '';
    const keyed = c ? animParts(c.def) : [];
    const parts = [...new Set([...this.host.parts, ...Object.keys(this.bones), ...(this.modeling ? Object.keys(this.shapes) : []), ...keyed])];
    if (this.part && !parts.includes(this.part)) this.part = null;
    for (const p of [...this.extras]) if (!this.part || !this.modeling || p === this.part || !parts.includes(p)) this.extras.delete(p);
    this.showStatus(); // the bar names what the gizmo poses, and the Weights tool's brush and bone
    if (this.focusNow() !== this.shownKind) this.showSections(); // the focus changed kind: Parameter, or Keyforms and Properties
    this.paramProps.show();
    this.tree.show();
    this.sendFocus();
    this.pivotPanel.show();
    this.showAuto();
    this.showSummaries();
    this.showRestNote();
    if (c?.preset) { this.note.textContent = `${c.name} is a preset (shown as a sampled copy; it plays exactly as in the game). "Edit copy" makes an editable version.`; this.presetNote = true; }
    else if (this.presetNote) { this.note.textContent = ''; this.presetNote = false; }
    this.refreshInspector();
    this.gizmo.send();
    this.gizmo.show();
    this.params.sync();
    this.warpPanel.show();
    this.postWarp();
    this.weightsPanel.show();
    this.postWeights();
    this.maskPanel.show();
    this.postMask();
    this.showProps();
    this.refreshParamKey();
    this.refreshFrameTab();
    this.drawTimeline();
    this.showTransport();
    this.keepFocus();
  }

  /** A focused control that was redrawn, disabled or hidden (Apply, Undo, Delete key, a key button...) drops focus to the page, where the
   *  studio's keys (Esc, Space, Ctrl+Z) no longer reach it: give it to the control's replacement, or the dialog (anim-focus.ts). */
  private keepFocus() { this.focus.restore(); }

  /** The selected parameter key's fields in the Parameters section. */
  private refreshParamKey() {
    const sel = this.ptracks.sel, k = sel ? this.cur?.def.params?.[sel.id]?.[sel.index] : undefined, can = this.editable();
    const dur = this.cur?.dur ?? 1;
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-pk]')) {
      input.value = k ? String(input.dataset.pk === 't' ? secondsOf(k.t, dur) : k.v) : '';
      if (input.dataset.pk === 't') input.max = String(dur);
      input.disabled = !can || !k;
    }
    const ease = this.root.querySelector<HTMLSelectElement>('.ap-ease')!;
    showEase(ease, k?.ease ?? '');
    ease.disabled = !can || !k;
    this.root.querySelector<HTMLButtonElement>('.ap-delkey')!.disabled = !can || !k;
    // With no key chosen the row is its hint alone, not a set of blank fields (ES-9).
    for (const f of this.root.querySelectorAll<HTMLElement>('.ap-keyedit label, .ap-delkey')) f.classList.toggle('as-off', !k);
    this.root.querySelector('.ap-keyhint')!.textContent = sel && k ? `${sel.id} key ${sel.index + 1} of ${this.cur?.def.params?.[sel.id]?.length}.` : 'Click a diamond on a parameter lane of the timeline. Double-click a parameter lane to add a key there.';
  }

  /** The Frames section: the slot choices, and the selected block's fields. */
  private refreshFrameTab() {
    const c = this.cur, can = this.editable(), slots = Object.entries(this.host.slots).filter(([, v]) => v.length);
    const q = (cls: string) => this.root.querySelector<any>('.af-' + cls)!;
    const slotSel = q('slot'), sel = this.frames.sel;
    if (slotSel.options.length !== slots.length) slotSel.replaceChildren(...slots.map(([n]) => el('option', { value: n, textContent: n })));
    if (sel && slots.some(([n]) => n === sel.slot)) slotSel.value = sel.slot;
    const track = c ? trackOfSlot(c.def, slotSel.value) : undefined, keys = c && track ? asKeys(track, c.dur).keys! : [];
    const k = sel && sel.slot === slotSel.value ? keys[sel.index] : undefined;
    q('fill').disabled = !can || !slots.length;
    q('remove').disabled = !can || !track;
    const frame = q('frame');
    frame.replaceChildren(...[...(this.host.slots[slotSel.value] ?? []), 'none'].map(n => el('option', { value: n, textContent: n })));
    frame.value = k?.frame ?? '';
    q('t').value = k && c ? String(secondsOf(k.t, c.dur)) : '';
    q('t').max = String(c?.dur ?? 1);
    for (const f of [frame, q('t'), q('dup'), q('del')]) f.disabled = !can || !k;
    q('earlier').disabled = !can || !k || sel!.index === 0;
    q('later').disabled = !can || !k || sel!.index >= keys.length - 1;
    this.root.querySelector('.af-hint')!.textContent = k ? `${sel!.slot} frame ${sel!.index + 1} of ${keys.length}.`
      : slots.length ? 'Click a block on a frame row of the timeline, or double-click a row to add a frame. Drag a block to retime it.' : 'This character has no slots with variants to step through.';
  }

  private refreshInspector() {
    const c = this.cur, can = this.editable(), k = this.keys.selectedKey();
    const keys = c ? keysOf(c.def, this.part) : [];
    this.keySel.replaceChildren(el('option', { value: '', textContent: keys.length ? '(none selected)' : '(no keys)' }),
      ...keys.map(({ index, key }) => el('option', { value: String(index), textContent: `${timeLabel(key.t, c!.dur)} · ${KEY_CHANNELS.filter(ch => key[ch] !== undefined).map(ch => `${ch} ${key[ch]}`).join(', ')}` })));
    this.keySel.value = this.keys.sel !== null && keys.some(x => x.index === this.keys.sel) ? String(this.keys.sel) : '';
    this.keySel.disabled = !keys.length;
    this.fields.t.value = k && c ? String(secondsOf(k.t, c.dur)) : '';
    this.fields.t.max = String(c?.dur ?? 1);
    for (const ch of KEY_CHANNELS) this.fields[ch].value = k?.[ch] !== undefined ? String(k[ch]) : '';
    showEase(this.easeSel, k?.ease ?? '');
    for (const f of [...Object.values(this.fields), this.easeSel, this.delKey]) f.disabled = !can || !k;
    this.addBtn.disabled = this.addCh.disabled = !can;
    // A key's fields show once a key is chosen, the key list once there are keys; until then the row is Add key alone (ES-9).
    for (const f of [...Object.values(this.fields), this.easeSel]) f.closest('label')?.classList.toggle('as-off', !k);
    this.delKey.classList.toggle('as-off', !k);
    this.keySel.closest('label')?.classList.toggle('as-off', !keys.length);
  }

  // ---- timeline ----
  /** The parameter lanes of the animation on show: one for each parameter it keys (a name the rig lacks gets the span of its keys). */
  private trackLanes() {
    const c = this.cur;
    if (!c) return [];
    const defs = this.parameters;
    return trackIds(c.def).map(id => {
      const keys = paramKeys(c.def, id), d = defs.find(x => x.id === id), vs = keys.map(k => k.v);
      const min = d ? d.min : Math.min(...vs, 0), max = d ? d.max : Math.max(...vs, 1);
      return { id, min, max: max > min ? max : min + 1, keys, samples: sampleTrack(c.def, id, 120) };
    });
  }
  /** One row per frame track of the animation on show (a clip written with `frames` shown as the blocks it expands to). */
  private frameRows() {
    const c = this.cur;
    return c ? frameTracks(c.def.frames).map(t => ({ slot: t.slot, blocks: frameBlocks(asKeys(t, c.dur)) })) : [];
  }
  private drawTimeline() {
    const c = this.cur;
    if (!c) { this.tl.replaceChildren(); this.ruler.replaceChildren(); this.shownLanes = null; return; }
    const tracks = this.trackLanes(), frames = this.frameRows();
    this.playLines = drawTimeline(this.tl, this.ruler, { def: c.def, dur: c.dur, preset: c.preset, editable: this.editable(), part: this.part, sel: this.keys.sel, frozen: this.keys.frozen, ranges: this.ranges, tracks, selParam: this.ptracks.sel, frames, selFrame: this.frames.sel });
    this.showTime();
    // A lane that just appeared (a parameter or frame track keyed, a folded channel opened) scrolls into view, so its first key is seen.
    const rows = drawnRows(this.tl).rows, view = `${c.name}\n${this.part ?? ''}`;
    const names = rows.map(r => (r.kind === 'channel' ? (r.folded ? '' : r.ch) : r.kind === 'param' ? `p:${tracks[r.index].id}` : `f:${frames[r.index].slot}`));
    const before = this.shownLanes?.view === view ? this.shownLanes.names : null;
    this.shownLanes = { view, names: new Set(names) };
    const fresh = before && rows.find((_, i) => names[i] && !before.has(names[i]));
    if (fresh) {
      const wrap = this.tl.parentElement!, cover = this.ruler.getBoundingClientRect().height;
      const top = this.tl.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop + fresh.top;
      if (top - cover < wrap.scrollTop) wrap.scrollTop = top - cover;
      else if (top + fresh.height > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = top + fresh.height - wrap.clientHeight;
    }
  }
  /** The lanes the timeline showed last, and for which animation and part (a change of either is not a new lane). */
  private shownLanes: { view: string; names: Set<string> } | null = null;
}

type StudioTools = Record<'undo' | 'redo' | 'apply' | 'scene' | 'open' | 'resetdock', HTMLButtonElement>;
