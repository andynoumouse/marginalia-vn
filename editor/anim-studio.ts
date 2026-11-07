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
import { MaskPanel } from './anim-mask.js';
import { BindPanel, type BindRow, type BindView } from './anim-bind.js';
import { TrackEditor } from './anim-ptracks.js';
import { FrameEditor } from './anim-frames.js';
import { UndoStack } from './anim-history.js';
import { PivotPanel } from './anim-pivot.js';
import { GizmoBar } from './anim-gizmo.js';
import { toolRowHtml } from './studio-toolrow.js';
import { PlacePanel } from './anim-place.js';
import { ExportDialog } from './anim-export.js';
import { ContextMenu } from './context-menu.js';
import { mountDock, type Dock } from './dock-ui.js';
import { RigTree } from './anim-tree.js';
import { el } from './anim-dom.js';
import { drawTimeline,      xOf } from './anim-timeline.js';
import {
   ANCHORS, asKeys, changedParams, deformerOf, maskOf, readLayout, studioDockSpec, studioPresent, readDock, writeDock, defaultDock, isDefaultDock, type DockLayout, type DeformerDef, type MaskDef, 
  addPad, addParam, affectedBy, bindDeformer, bindMask, bindPose, boneSubtree, boundParts, copyKeys, controlOf, DEFAULT_PAD_SIZE, deleteParam, deletePad, dragForms, driverOf, isBound, keyTicks, KEY_SNAP, removeKey, unbindDeformer, unbindMask, unbindPose, warpTicks,
  type BindDoc, type BindDriver, type BindKind, type KeyTick, type PadSize, type FullForm, easeAt, extendGrid, formAt, isKeyed, setKeyEase, isPadSpot, moveControl, moveControlTo, addCategory, renameCategory, deleteCategory, moveCategory, padCorners, snapSpot, spotForm, spotLabel, updatePad, updateParam, writeForm,
  type KeyformDef, type KeySpot, type Offset, type ParamDoc, type ParamEdit, sectionOpen, withSection, withSize, withCollapsed, dragColumn, clampLeft, clampRight, clampSplit, LEFT_WIDTH, RIGHT_WIDTH, SPLIT, type StudioSide, type StudioSizes, type StudioLayout, type StudioMode, frameBlocks, frameTracks, trackOfSlot, DEFAULT_FPS, deleteParamKey, keyParams, paramKeys, sampleTrack, savePose, deletePose, trackIds, type PadDef, type ParamDef, type PoseDef, type RigPhysicsChain, type Positions, type Anchors, ANIMS, animParts, bakePreset, deleteAnim,  duplicateAnim, EASE_NAMES, KEY_CHANNELS, keysOf, newAnim, partsUnder, soloHidden, toggleHidden, renameAnim,
   setBonePivot, setDur,  setPivot, setPivots, uniqueName, noRigSettings, type RigSettings, type AnimDef, type Anims, type Bones, type Looks, type KeyChannel,  type PartBones, type Pivots, type RigOutline, type StudioDoc,
} from '../engine/src/index.js';
const HISTORY = 100;

/** A collapsible section: a header button (chevron, title, a short summary) over its body. The studio opens and closes them. */
const section = (id: string, title: string, body: string, extra = '') => `<section class="as-sect" data-sect="${id}"><h3><button type="button" class="as-sect-grab" hidden aria-label="Move ${title}: drag, or use Alt and the arrow keys" title="Move this section" data-dock-handle="${id}"><span aria-hidden="true">⠿</span></button><button type="button" class="as-sect-head" id="as-head-${id}" aria-controls="as-sect-${id}" aria-expanded="true"><span class="as-chev" aria-hidden="true"></span><span class="as-sect-title">${title}</span><span class="as-sect-sum"></span></button>${extra}</h3><div class="as-sect-body" id="as-sect-${id}" role="region" aria-labelledby="as-head-${id}">${body}</div></section>`;

interface Entry { name: string; preset: boolean; def: AnimDef; dur: number }
export type { RigSettings };
/** What the studio edits (engine/src/studio-doc.ts): the character's `parameters`, `pads` and `keyforms`, its `animations`, `pivots`, `bones` and `parts`, `idle`, the animation of `speak` and `blink`, its mesh warps (`deformers`) and the clips of its parts (`masks`). */
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
/** Where the author put the sections (engine/src/dock.ts); kept apart from LAYOUT_KEY, whose open/closed state and sizes it does not touch. */
/** The width of a folded side column. */
const RAIL_PX = 24;
const DOCK_KEY ='vn.editor.studioDock';

export class AnimStudio {
  private root: HTMLDivElement;
  private card: HTMLElement;
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
  private dock!: Dock;
  /** How many columns the left area has now: two while the second one holds a section. */
  private cols = 1;
  /** The author's section layout; a narrow window shows the first one meanwhile (the sections stack in one column). */
  private dockStored: DockLayout = defaultDock(studioDockSpec());
  private durInput: HTMLInputElement;
  private note: HTMLElement;
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
  private maskPanel: MaskPanel;
  private ptracks: TrackEditor;
  private frames: FrameEditor;
  private parameters: ParamDef[] = [];       // rig.json `parameters`, `pads` and `keyforms`: Model mode authors them
  private pads: PadDef[] = [];
  private categories: string[] = [];          // rig.json `categories`: the Parameters section's groups, in order
  private keyforms: KeyformDef[] = [];
  private rigSent = '';                       // what the stage was last told of them
  private builtParams = '';                   // the parameters and pads the Parameters section was built for
  private activeControl: string | null = null; // the active parameter, the one a gizmo drag writes the keyform of: a parameter id or `pad:<id>`; null until the author picks one
  private bindSize: PadSize = DEFAULT_PAD_SIZE;   // the grid a part gets when it is bound to a pad (Model mode)
  private binder: BindPanel;
  private poses: Record<string, PoseDef> = {};   // rig.json `poses`
  private physics: Record<string, RigPhysicsChain> = {}; // rig.json `physics`
  private deformers: DeformerDef[] = [];      // rig.json `deformers`
  private deformersSent = '';                 // what the stage was last told, so an edit elsewhere does not repeat it
  private warpSent = '';
  private masks: MaskDef[] = [];              // rig.json `masks`
  private masksSent = '';
  private maskSent = '';
  private host: StudioHost = { parts: [], looks: [], slots: {}, width: 0, height: 0, apply: () => false };
  private char = '';
  private anims: Anims = {};
  private pivots: Pivots = {};
  private bones: Bones = {};             // rig.json `bones`, and `parts` (which bone each part sits on)
  private partBones: PartBones = {};
  private looks: Looks = {};              // rig.json `looks`
  private rig: RigSettings = noRigSettings();
  private auto: Record<'spSlot' | 'spVars' | 'spRate' | 'blSlot' | 'blVariant' | 'blMin' | 'blMax' | 'blDur', HTMLInputElement>;
  private variantList: HTMLDataListElement;
  private pose: string | null = null;     // how the stage dresses the character (not saved anywhere)
  private overrides: Record<string, string> = {};
  private picking = false;                // the stage waits for a click that places the pivot of `part`
  private pivotPanel: PivotPanel;
  private tree: RigTree;
  private hidden: string[] = [];        // parts and bones hidden on the stage, for this session (never saved, kept across animations and modes)
  private hiddenSent = '';
  private focusSent: string | null | undefined; // the part the stage was last told to bring forward
  private idleSel: HTMLSelectElement;
  private speakSel: HTMLSelectElement;
  private blinkBox: HTMLInputElement;
  private placer: PlacePanel;
  private gizmo: GizmoBar;
  private dragFrom: Snap | null = null;   // the working copy before a pivot drag on the stage began
  private baseline = '';
  private history = new UndoStack<Snap>(HISTORY);
  private entries: Entry[] = [];
  private cur: Entry | null = null;
  private part: string | null = null;
  private extras = new Set<string>();         // Model mode: parts added to `part` with Ctrl-click; a pick binds them and a drag poses them all by the same delta
  private keys: KeyEditor;
  private ranges: Record<KeyChannel, number> = { x: 1, y: 1, scale: 1, rot: 1 };
  private t = 0;
  private playing = false;
  private playLine: SVGLineElement | null = null;
  private presetNote = false;  // the note says what a preset is
  private closeWarned = false; // Close was pressed with unapplied changes; the next press discards them

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'animStudio';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="as-card" role="dialog" aria-modal="true" aria-label="Animation studio" tabindex="-1">
        <header><strong></strong>
          <span class="as-modes" role="group" aria-label="Mode">
            <button type="button" data-mode="model" title="Model: what the character is made of. Parts, bones, pivots, physics, and what the parameters do: pick a parameter, pick the parts it moves, pose them at its keys">Model</button><button type="button" data-mode="animate" title="Animate: animations on a timeline, with keys and playback">Animate</button></span>
          <span class="as-spacer"></span>
          <button type="button" data-t="open" hidden title="Open another character folder">Open...</button>
          <button type="button" data-t="export" title="Export the animation on show as a PNG sequence with transparency">Export...</button>
          <button type="button" data-t="resetdock" hidden title="Put the sections back in their first columns and order">Reset layout</button>
          <button type="button" data-t="undo">Undo</button><button type="button" data-t="redo">Redo</button>
          <button type="button" data-t="apply" class="primary">Apply</button>
          <button type="button" data-t="scene" hidden title="Apply, close and play the script from the animate line you came from">Try in scene</button>
          <button type="button" class="close" aria-label="Close animation studio">Close</button></header>
        <div class="as-body">
          <div class="as-side">
            <div class="as-picker">
              <label>Animation <select class="as-anim" aria-label="Animation"></select></label>
              <button type="button" class="as-more" aria-haspopup="menu" aria-label="Animation actions" title="New, copy, rename and delete animations">⋯</button>
            </div>
            <form class="as-name" hidden><span></span>
              <input type="text" aria-label="Animation name" spellcheck="false" autocomplete="off">
              <div><button type="submit">OK</button><button type="button">Cancel</button></div></form>
            <div class="as-looks"></div>
            <div class="as-cols"><div class="as-dock" data-zone="left">
              ${section('poses', 'Poses', '<div class="apo"></div>')}
              ${section('params', 'Parameters', '<div class="ap"></div>', '<button type="button" class="ap-add ap-model-only" aria-haspopup="menu" aria-label="Add a parameter or a pad" title="Add a parameter (a slider) or a pad (two parameters on one 2D control)">+</button>')}
              <div class="as-grip as-grip-h" data-grip="split" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Height of the Parameters block: drag, or use the up and down arrow keys" title="Drag to resize"></div>
              ${section('tree', 'Parts', '<div class="as-tree"></div>')}
            </div><div class="as-dock" data-zone="left2" aria-label="Second left column"></div></div>
          </div>
          <div class="as-grip as-grip-v" data-grip="left" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Width of the left column: drag, or use the left and right arrow keys; drag it to the window's edge, or press Enter, to fold the column away" title="Drag to resize; drag to the edge or double-click to fold"></div>
          <div class="as-grip as-grip-r" data-grip="right" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Width of the right column: drag, or use the left and right arrow keys; drag it to the window's edge, or press Enter, to fold the column away" title="Drag to resize; drag to the edge or double-click to fold"></div>
          <button type="button" class="as-rail as-rail-left" data-rail="left" hidden aria-label="Show the left column" title="Show the left column">›</button>
          <button type="button" class="as-rail as-rail-right" data-rail="right" hidden aria-label="Show the right column" title="Show the right column">‹</button>
          <div class="as-main">
            <div class="as-gizmo">
              ${toolRowHtml()}
            </div>
            <div class="as-stage"></div>
            <div class="as-transport">
              <button type="button" class="as-play" aria-label="Play">Play</button>
              <label><input type="checkbox" class="as-loop"> Loop</label>
              <input type="range" class="as-slider" min="0" max="1000" value="0" aria-label="Position in the animation">
              <span class="as-time" aria-live="off"></span>
              <label>Length <input type="number" class="as-dur" min="0.05" step="0.1" aria-label="Length in seconds"> s</label>
            </div>
            <div class="as-tlwrap"><svg class="as-timeline" role="img" aria-label="Timeline: one lane for each of x, y, scale and rotation. Double-click a lane to add a key, drag a key to move it."></svg></div>
          </div>
          <div class="as-inspect"><div class="as-dock" data-zone="right">
            ${section('keyforms', 'Keyforms', '<div class="ab"></div>')}
            ${section('sel', 'Selection', `
              <div class="as-sel-name"><strong class="as-gz-name"></strong></div>
              <div class="as-sel-anim as-gz-nums"><span class="as-pivot-name">At the playhead</span>
                <label>x <input type="number" data-g="x" step="0.005"></label><label>y <input type="number" data-g="y" step="0.005"></label><label>scale <input type="number" data-g="scale" step="0.005"></label><label>rot <input type="number" data-g="rot" step="0.5"></label></div>
              <div class="as-sel-anim as-inspector">
                <label>Key <select class="as-key" aria-label="Key"></select></label>
                <label>t <input type="number" data-f="t" min="0" max="1" step="0.01"></label>
                <label>x <input type="number" data-f="x" step="0.005"></label>
                <label>y <input type="number" data-f="y" step="0.005"></label>
                <label>scale <input type="number" data-f="scale" step="0.005"></label>
                <label>rot <input type="number" data-f="rot" step="0.5"></label>
                <label>ease <select class="as-ease" aria-label="Ease into this key"></select></label>
                <button type="button" class="as-delkey">Delete key</button>
                <span class="as-add"><button type="button" class="as-addkey">Add key at playhead for</button>
                  <select class="as-addch" aria-label="Channel of the new key"></select></span>
              </div>
              <div class="as-sel-model as-pivot">
                <span class="as-pivot-name">Pivot</span>
                <label>x <input type="number" data-p="x" step="1"></label>
                <label>y <input type="number" data-p="y" step="1"></label>
                <button type="button" class="as-pick">Pick on stage</button>
                <button type="button" class="as-pivot-clear">Clear</button>
                <button type="button" class="as-pivot-share" aria-expanded="false">Same pivot for…</button>
                <span class="as-share" hidden></span>
                <span class="as-pivot-hint">Choose a part or a bone in the tree. The pivot is where it turns and scales; in PSD pixels.</span>
              </div>
              <p class="as-sel-model as-pivot-hint as-rest-note" hidden>Some parameters are not at their defaults: the stage shows that pose, but pivots belong to the rest pose.</p>
              <div class="ap-keyedit"><span class="as-pivot-name">Parameter key</span>
                <label>t <input type="number" data-pk="t" min="0" max="1" step="0.01"></label>
                <label>value <input type="number" data-pk="v" step="0.01"></label>
                <label>ease <select class="ap-ease" aria-label="Ease into this parameter key"></select></label>
                <button type="button" class="ap-delkey">Delete key</button>
                <span class="as-pivot-hint ap-keyhint">Click a diamond on a parameter lane of the timeline. Double-click a parameter lane to add a key there.</span></div>
              <div class="as-detail"></div>`)}
            ${section('warp', 'Warp', '<div class="aw"></div>')}
            ${section('mask', 'Mask', '<div class="am"></div>')}
            ${section('frames', 'Frames', `
              <div class="af-bar"><span class="as-pivot-name">Frame track</span>
                <label>Slot <select class="af-slot" aria-label="Slot whose variants are the frames"></select></label>
                <label>fps <input type="number" class="af-fps" min="1" max="60" step="1" value="${DEFAULT_FPS}" aria-label="Frames a second"></label>
                <button type="button" class="af-fill">Frames from this slot</button>
                <button type="button" class="af-remove">Remove track</button></div>
              <div class="af-edit"><span class="as-pivot-name">Frame</span>
                <label>shows <select class="af-frame" aria-label="Variant this block shows"></select></label>
                <label>from t <input type="number" class="af-t" min="0" max="1" step="0.01"></label>
                <button type="button" class="af-dup">Duplicate</button>
                <button type="button" class="af-earlier" title="Swap this frame with the one before it; the times stay">Earlier</button>
                <button type="button" class="af-later" title="Swap this frame with the one after it; the times stay">Later</button>
                <button type="button" class="af-del">Delete</button>
                <span class="as-pivot-hint af-hint"></span></div>`)}
            ${section('physics', 'Physics', '<div class="ph"></div>')}
            ${section('auto', 'By itself', `
              <div class="as-auto">
                <span class="as-pivot-name">By itself</span>
                <label>Idle <select class="as-idle" aria-label="Animation that loops while the character is on stage"></select></label>
                <label>Talking <select class="as-speak" aria-label="Animation that loops while a line types"></select></label>
                <label><input type="checkbox" class="as-blink"> Blink</label>
                <span class="as-pivot-hint">Saved under autonomous (idle, speak, blink). Empty fields use the defaults shown in grey.</span>
              </div>
              <div class="as-auto">
                <span class="as-pivot-name">Mouth</span>
                <label>Slot <input type="text" class="as-sp-slot" list="as-slotnames" placeholder="mouth" size="8"></label>
                <label>Variants <input type="text" class="as-sp-vars" list="as-variantnames" placeholder="open, neutral" size="24" aria-label="Mouth variants cycled while a line types, separated by commas"></label>
                <label>Changes a second <input type="number" class="as-sp-rate" min="0.5" step="0.5" placeholder="8"></label>
              </div>
              <div class="as-auto">
                <span class="as-pivot-name">Blink</span>
                <label>Slot <input type="text" class="as-bl-slot" list="as-slotnames" placeholder="eyes" size="8"></label>
                <label>Variant <input type="text" class="as-bl-variant" list="as-variantnames" placeholder="closed" size="8"></label>
                <label>Every <input type="number" class="as-bl-min" min="0.1" step="0.5" placeholder="3"> to <input type="number" class="as-bl-max" min="0.1" step="0.5" placeholder="6"> s</label>
                <label>Closed for <input type="number" class="as-bl-dur" min="0.02" step="0.02" placeholder="0.12"> s</label>
                <datalist id="as-slotnames"></datalist><datalist id="as-variantnames"></datalist>
              </div>`)}
            ${section('place', 'Place in scene', `
              <div class="as-place">
                <span class="as-pivot-name">Place</span>
                <button type="button" class="as-place-btn" aria-pressed="false">Place on stage</button>
                <label>x <input type="number" data-pl="x" step="0.01"></label>
                <label>y <input type="number" data-pl="y" step="0.01"></label>
                <label>scale <input type="number" data-pl="scale" step="0.05" min="0.05"></label>
                <label><input type="checkbox" class="as-flip"> flip</label>
                <label>anchor <input type="text" class="as-anchor" list="as-anchornames" size="9" placeholder="feet"></label>
                <datalist id="as-anchornames"></datalist>
                <input type="text" class="as-place-line" readonly aria-label="The show line for this placement" size="38">
                <button type="button" class="as-place-copy">Copy</button>
                <button type="button" class="as-place-insert" hidden>Insert in script</button>
                <span class="as-pivot-hint">Drag the character on the stage, then insert or paste the line into the script. It includes the look and slot variants chosen on the left.</span>
              </div>`)}
          </div></div>
        </div>
        <div class="as-note" role="status"></div>
      </div>`;
    host.append(this.root);
    const q = <T extends Element>(s: string) => this.root.querySelector<T>(s)!;
    this.card = q('.as-card');
    this.title = q('header strong');
    this.stageHost = q('.as-stage');
    this.stage = new StageBridge(this.stageHost, e => this.onStage(e));
    this.picker = q('.as-anim');
    this.tl = q('.as-timeline');
    this.playBtn = q('.as-play');
    this.loopBox = q('.as-loop');
    this.slider = q('.as-slider');
    this.time = q('.as-time');
    this.durInput = q('.as-dur');
    this.note = q('.as-note');
    this.keySel = q('.as-key');
    this.easeSel = q('.as-ease');
    this.delKey = q('.as-delkey');
    this.addCh = q('.as-addch');
    this.addBtn = q('.as-addkey');
    this.exportBtn = q('[data-t="export"]');
    this.tools = Object.fromEntries(['undo', 'redo', 'apply', 'scene', 'open', 'resetdock'].map(n => [n, q<HTMLButtonElement>(`[data-t="${n}"]`)])) as StudioTools;
    this.fields = Object.fromEntries(['t', ...KEY_CHANNELS].map(n => [n, q<HTMLInputElement>(`[data-f="${n}"]`)])) as Record<'t' | KeyChannel, HTMLInputElement>;
    this.pivotPanel = new PivotPanel(q('.as-pivot'), {
      state: () => ({ part: this.part, at: this.selPivot(), isBone: this.selIsBone(this.part), picking: this.picking, pivots: this.pivots, parts: this.host.parts }),
      setPicking: on => this.setPicking(on),
      setPivot: at => this.edit(() => this.setSelPivot(at)),
      clear: () => { this.setPicking(false); this.edit(() => this.setSelPivot(null)); },
      share: (part, at) => this.edit(() => { this.pivots = setPivots(this.pivots, [part], at); }),
    });
    this.tree = new RigTree({ tree: q('.as-tree'), detail: q('.as-detail'), looks: q('.as-looks') }, {
      state: () => ({ char: this.char, mode: this.mode, pose: this.pose, overrides: this.overrides, looks: this.looks, bones: this.bones, partBones: this.partBones, part: this.part, anim: this.cur ? { name: this.cur.name, def: this.cur.def } : null, bind: this.treeBind(), hidden: this.hidden }),
      outline: (pose, overrides, looks) => this.host.outline?.(pose, overrides, looks),
      image: file => this.host.image?.(file),
      change: patch => this.edit(() => {
        if (patch.bones) this.bones = patch.bones;
        if (patch.parts) this.partBones = patch.parts;
        if (patch.looks) this.looks = patch.looks;
        if (patch.part !== undefined) this.part = patch.part;
      }),
      choosePart: (part, add) => add ? this.toggleExtra(part) : this.choosePart(part),
      toggleBind: (part, subtree) => this.toggleBind(part, subtree),
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
      anim: () => (this.cur ? { name: this.cur.name, def: this.cur.def, preset: this.cur.preset } : null),
      post: msg => this.post(msg),
      note: text => { this.note.textContent = text; },
      edit: fn => this.edit(fn),
      setAnim: (name, def) => { this.anims[name] = def; },
      toolChanged: () => {
        if (this.mode === 'model') this.setPicking(this.gizmo.tool === 'pivot');
        if (this.gizmo.tool === 'warp') this.openSection('warp');
        if (this.gizmo.tool === 'mask') this.openSection('mask');
        if (this.modeling) this.note.dataset.hint = this.modelHint();
        this.warpPanel.show();
        this.maskPanel.show();
        this.postWarp();
        this.postMask();
        if (this.modeling) { this.tree.show(); this.binder.show(); }
      },
      keyformDrag: (name, _tool, delta) => this.keyformDrag(name, delta),
      undo: () => this.undo(),
      redo: () => this.redo(),
    });
    this.idleSel = q('.as-idle');
    this.speakSel = q('.as-speak');
    this.blinkBox = q('.as-blink');
    this.auto = { spSlot: q('.as-sp-slot'), spVars: q('.as-sp-vars'), spRate: q('.as-sp-rate'), blSlot: q('.as-bl-slot'), blVariant: q('.as-bl-variant'), blMin: q('.as-bl-min'), blMax: q('.as-bl-max'), blDur: q('.as-bl-dur') };
    this.variantList = q('#as-variantnames');
    this.placer = new PlacePanel(this.root, {
      studio: () => this.host,
      dress: () => ({ char: this.char, pose: this.pose, overrides: this.overrides }),
      post: msg => this.post(msg),
      note: text => { this.note.textContent = text; },
      stopPicking: () => { if (this.picking) this.setPicking(false); },
    });
    this.idleSel.addEventListener('change', () => this.edit(() => { this.rig = { ...this.rig, idle: this.idleSel.value || null }; }));
    this.speakSel.addEventListener('change', () => this.edit(() => { this.rig = { ...this.rig, speakAnim: this.speakSel.value || null }; }));
    this.blinkBox.addEventListener('change', () => this.edit(() => { this.rig = { ...this.rig, blink: this.blinkBox.checked }; }));
    const word = (v: string) => v.trim() || null;
    const num = (v: string) => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null; };
    const offer = (slot: () => string) => () => this.variantList.replaceChildren(...(this.host.slots[slot()] ?? []).map(n => el('option', { value: n })));
    this.auto.spVars.addEventListener('focus', offer(() => this.rig.speakSlot ?? 'mouth'));
    this.auto.blVariant.addEventListener('focus', offer(() => this.rig.blinkSlot ?? 'eyes'));
    const set = (patch: Partial<RigSettings>) => this.edit(() => { this.rig = { ...this.rig, ...patch }; });
    const a = this.auto;
    a.spSlot.addEventListener('change', () => set({ speakSlot: word(a.spSlot.value) }));
    a.spVars.addEventListener('change', () => set({ speakVariants: a.spVars.value.split(',').map(v => v.trim()).filter(Boolean) }));
    a.spRate.addEventListener('change', () => set({ speakRate: num(a.spRate.value) }));
    a.blSlot.addEventListener('change', () => set({ blinkSlot: word(a.blSlot.value) }));
    a.blVariant.addEventListener('change', () => set({ blinkVariant: word(a.blVariant.value) }));
    a.blDur.addEventListener('change', () => set({ blinkDur: num(a.blDur.value) }));
    for (const box of [a.blMin, a.blMax]) box.addEventListener('change', () => {
      const lo = num(a.blMin.value), hi = num(a.blMax.value);
      // One end left empty takes its default; a range that runs backwards is not kept.
      const every: [number, number] | null = lo === null && hi === null ? null : [lo ?? 3, hi ?? 6];
      if (every && every[1] < every[0]) { this.showAuto(); this.note.textContent = 'Blink "every" needs the first number to be the smaller.'; return; }
      set({ blinkEvery: every });
    });
    this.easeSel.append(el('option', { value: '', textContent: `(default: inout)` }), ...EASE_NAMES.map(n => el('option', { value: n, textContent: n })));
    this.addCh.append(...KEY_CHANNELS.map(c => el('option', { value: c, textContent: c })));

    this.root.addEventListener('mousedown', e => { if (e.target === this.root && !this.host.standalone) this.close(); });
    q('.close').addEventListener('click', () => this.close());
    this.tools.open.addEventListener('click', () => this.host.standalone?.open());
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.as-modes button')) b.addEventListener('click', () => this.setMode(b.dataset.mode as Mode));
    for (const head of this.root.querySelectorAll<HTMLButtonElement>('.as-sect-head')) head.addEventListener('click', () => this.toggleSection(head.closest<HTMLElement>('.as-sect')!.dataset.sect!));
    for (const grip of this.root.querySelectorAll<HTMLElement>('.as-grip')) this.gripEvents(grip);
    for (const rail of this.root.querySelectorAll<HTMLElement>('.as-rail')) rail.addEventListener('click', () => this.setCollapsed(rail.dataset.rail as StudioSide, false));
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
      isKeyed: spot => (this.part ? isKeyed(this.keyforms, this.parameters, this.part, spot) : null),
      toggleKey: spot => this.toggleKey(spot),
      addGridLine: (params, axis, value) => this.addGridLine(params, axis, value),
      categories: () => this.categories,
      addCategory: () => this.editParams(addCategory(this.paramDoc())),
      renameCategory: (from, to) => this.editParams(renameCategory(this.paramDoc(), from, to)),
      deleteCategory: name => { this.editParams(deleteCategory(this.paramDoc(), name)); },
      moveCategory: (name, before) => { this.editParams(moveCategory(this.paramDoc(), name, before)); },
      moveControlTo: (control, category, before) => { this.editParams(moveControlTo(this.paramDoc(), control, category, before)); },
      addParam: category => this.editParams(addParam(this.paramDoc(), category)),
      addPad: category => this.editParams(addPad(this.paramDoc(), category)),
      editParam: (id, patch) => this.editParams(updateParam(this.paramDoc(), id, patch), id),
      editPad: (id, patch) => this.editParams(updatePad(this.paramDoc(), id, patch), id, 'pad:'),
      deleteParam: id => { this.editParams(deleteParam(this.paramDoc(), id)); },
      deletePad: id => { this.editParams(deletePad(this.paramDoc(), id)); },
      moveControl: (control, dir) => { this.editParams(moveControl(this.paramDoc(), control, dir)); },
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
    this.binder = new BindPanel(q('.ab'), {
      view: () => this.bindView(),
      focus: (target, kind) => this.focusBound(target, kind),
      unbind: (target, kind) => this.unbindPart(target, kind),
      bindChosen: () => { if (this.part) this.bindPart(this.part); },
      setSize: size => { this.bindSize = size; this.binder.show(); },
      jump: at => { const d = this.driver(); if (d && 'param' in d) this.params.setValue(d.param, at); },
      keyHere: () => this.toggleKey(this.keyedSpot()),
      setField: (field, value) => this.setField(field, value),
      resetForm: () => this.setField(null, 0),
      setEase: ease => this.setEase(ease),
      activate: control => this.chooseControl(control),
      copyKeys: (from, control, mirror) => this.copyKeysFrom(from, control, mirror),
    });
    this.warpPanel = new WarpPanel(q('.aw'), {
      part: () => this.part,
      activeParam: () => { const d = this.driver(); return d && 'param' in d ? d.param : null; },
      isPart: name => this.host.parts.includes(name),
      deformers: () => this.deformers,
      params: () => this.parameters,
      values: () => this.params.values(),
      setValue: (id, v) => this.params.setValue(id, v),
      set: next => this.edit(() => { this.deformers = next; }),
      drag: () => {
        // The stage shows each step as it goes; the release makes the whole drag one undo step.
        const before = this.snap();
        return {
          put: next => { this.deformers = next; this.closeWarned = false; this.postDeformers(); this.tools.apply.disabled = !this.dirty; this.warpPanel.show(); },
          end: () => { if (!this.commit(before)) this.refreshView(); },
        };
      },
      useTool: () => this.gizmo.setTool('warp'),
      selected: () => this.postWarp(),
      framedIn: part => Object.entries(this.anims).find(([, a]) => frameTracks(a?.frames).some(f => f.slot === part))?.[0] ?? null,
      note: text => { this.note.textContent = text; },
    });
    this.maskPanel = new MaskPanel(q('.am'), {
      part: () => this.part,
      isPart: name => this.host.parts.includes(name),
      parts: () => this.host.parts,
      bones: () => Object.keys(this.bones),
      masks: () => this.masks,
      params: () => this.parameters,
      set: next => this.edit(() => { this.masks = next; }),
      drag: () => {
        // The stage shows each step as it goes; the release makes the whole drag one undo step.
        const before = this.snap();
        return {
          put: next => { this.masks = next; this.closeWarned = false; this.postMasks(); this.tools.apply.disabled = !this.dirty; this.maskPanel.show(); },
          end: () => { if (!this.commit(before)) this.refreshView(); },
        };
      },
      useTool: () => this.gizmo.setTool('mask'),
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
      tl: this.tl,
      current: () => this.cur,
      editable: () => this.editable(),
      lanes: () => this.trackLanes().map(({ id, min, max }) => ({ id, min, max })),
      setAnim: (name, def) => { this.anims[name] = def; },
      edit: fn => this.edit(fn),
      dragStep: (name, def) => {
        this.anims[name] = def;
        this.rebuild();
        this.cur = this.entries.find(en => en.name === name) ?? this.cur;
        this.post({ type: 'studioAnims', anims: this.anims });
        this.refreshView();
      },
      beginDrag: () => {
        const before = this.snap();
        return () => { if (!this.commit(before)) this.refreshView(); };
      },
      seek: t => this.seek(t),
      refreshView: () => this.refreshView(),
    });
    this.frames = new FrameEditor({
      tl: this.tl,
      current: () => this.cur,
      editable: () => this.editable(),
      slots: () => this.host.slots,
      rows: () => this.frameRows().map(r => r.slot),
      paramLanes: () => this.trackLanes().length,
      setAnim: (name, def) => { this.anims[name] = def; },
      edit: fn => this.edit(fn),
      dragStep: (name, def) => {
        this.anims[name] = def;
        this.rebuild();
        this.cur = this.entries.find(en => en.name === name) ?? this.cur;
        this.post({ type: 'studioAnims', anims: this.anims });
        this.refreshView();
      },
      beginDrag: () => {
        const before = this.snap();
        return () => { if (!this.commit(before)) this.refreshView(); };
      },
      seek: t => this.seek(t),
      refreshView: () => this.refreshView(),
      note: text => { this.note.textContent = text; },
    });
    const af = (cls: string) => this.root.querySelector<any>('.af-' + cls)!;
    af('fill').addEventListener('click', () => this.frames.fillFromSlot(af('slot').value, Math.max(1, Number(af('fps').value) || DEFAULT_FPS)));
    af('remove').addEventListener('click', () => this.frames.removeTrack(af('slot').value));
    af('dup').addEventListener('click', () => this.frames.duplicate());
    af('earlier').addEventListener('click', () => this.frames.reorder(-1));
    af('later').addEventListener('click', () => this.frames.reorder(1));
    af('del').addEventListener('click', () => this.frames.deleteSelected());
    af('frame').addEventListener('change', () => this.frames.setFrame(af('frame').value));
    af('t').addEventListener('change', () => { const v = Number(af('t').value); if (af('t').value !== '' && Number.isFinite(v)) this.frames.setTime(v); else this.refreshView(); });
    this.root.querySelector('.ap-ease')!.append(el('option', { value: '', textContent: '(default: inout)' }), ...EASE_NAMES.map(n => el('option', { value: n, textContent: n })));
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-pk]')) input.addEventListener('change', () => {
      const v = Number(input.value);
      if (input.value !== '' && Number.isFinite(v)) this.ptracks.patchSelected({ [input.dataset.pk as 't' | 'v']: v });
      else this.refreshView();
    });
    this.root.querySelector('.ap-ease')!.addEventListener('change', e => this.ptracks.patchSelected({ ease: (e.target as HTMLSelectElement).value || undefined }));
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
      tl: this.tl,
      current: () => this.cur,
      editable: () => this.editable(),
      part: () => this.part,
      time: () => this.t,
      addChannel: () => this.addCh.value as KeyChannel,
      ranges: () => this.ranges,
      setAnim: (name, def) => { this.anims[name] = def; },
      edit: fn => this.edit(fn),
      dragStep: (name, def) => {
        this.anims[name] = def;
        this.rebuild();
        this.cur = this.entries.find(en => en.name === name) ?? this.cur;
        this.post({ type: 'studioAnims', anims: this.anims });
        this.refreshView();
      },
      beginDrag: () => {
        const before = this.snap();
        return () => { if (!this.commit(before)) this.refreshView(); };
      },
      seek: t => this.seek(t),
      note: text => { this.note.textContent = text; },
      refreshView: () => this.refreshView(),
    });
    this.root.addEventListener('keydown', e => this.onKeydown(e));
    new ResizeObserver(() => { if (!this.root.hidden) this.drawTimeline(); }).observe(this.tl);
  }

  /** Play, scrub, duration, undo, redo, Apply and Try in the scene. */
  private wireTransport() {
    this.playBtn.addEventListener('click', () => this.toggle());
    this.slider.addEventListener('input', () => this.seek(Number(this.slider.value) / 1000));
    this.loopBox.addEventListener('change', () => { if (this.playing) this.play(); });
    this.durInput.addEventListener('change', () => this.edit(() => { if (this.cur && !this.cur.preset) this.anims[this.cur.name] = setDur(this.cur.def, Number(this.durInput.value)); }));
    this.tools.undo.addEventListener('click', () => this.undo());
    this.tools.redo.addEventListener('click', () => this.redo());
    this.tools.apply.addEventListener('click', () => void this.apply());
    this.tools.scene.addEventListener('click', () => this.tryInScene());
  }

  /** The key selector, the key fields, the ease select and the add and delete buttons of the timeline. */
  private wireKeyControls() {
    this.keySel.addEventListener('change', () => { this.keys.sel = this.keySel.value === '' ? null : Number(this.keySel.value); this.refreshView(); });
    for (const [name, input] of Object.entries(this.fields)) input.addEventListener('change', () => this.keys.fieldChanged(name as 't' | KeyChannel, input.value));
    this.easeSel.addEventListener('change', () => this.keys.patchSelected({ ease: this.easeSel.value || undefined }));
    this.delKey.addEventListener('click', () => this.keys.removeSelected());
    this.addBtn.addEventListener('click', () => this.keys.addAtPlayhead());
  }

  /** Esc closes, Tab stays in the dialog, a letter picks a gizmo, Ctrl+Z and Ctrl+Y undo and redo, Space plays. */
  private onKeydown(e: KeyboardEvent) {
    const typing = e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox';
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!this.host.standalone) this.close(); }
    else if (e.key === 'Tab') this.trapTab(e);
    else if (!typing && !(e.target instanceof HTMLSelectElement) && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && this.gizmo.key(e.key.toLowerCase(), false, e.shiftKey)) e.preventDefault();
    else if ((e.ctrlKey || e.metaKey) && !typing && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) this.redo(); else this.undo();
    } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof SVGElement)) {
      e.preventDefault();
      this.toggle();
    }
  }

  get isOpen() { return !this.root.hidden; }

  /** What the status line says about leaving: the dialog closes with Esc, the standalone page's studio is the page and saves with Ctrl+S. */
  private leaveKey() { return this.host.standalone ? 'Ctrl+S save' : 'Esc close'; }

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
    this.mode = mode;
    this.gizmo.setMode(mode);
    this.root.dataset.mode = mode;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.as-modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    if (!model) this.physicsPanel.stop();
    this.note.dataset.hint = modeling ? this.modelHint() : 'Space play or pause · Ctrl+Z undo · ' + this.leaveKey();
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
    const mine = studioPresent(this.mode, this.host.standalone?.without);
    this.dock.setPresent(mine);
    for (const sec of this.root.querySelectorAll<HTMLElement>('.as-sect')) {
      const id = sec.dataset.sect!, has = mine.includes(id), open = has && this.isSectionOpen(id);
      sec.querySelector('.as-sect-head')!.setAttribute('aria-expanded', String(open));
      sec.querySelector<HTMLElement>('.as-sect-body')!.hidden = !open;
    }
  }
  /** The sizes the author dragged, as the CSS reads them: the left column's width and the most height the Parameters block takes. */
  private applySizes() {
    const body = this.root.querySelector<HTMLElement>('.as-body')!, fold = this.layout.collapsed ?? {};
    // A folded column is a thin rail; the left area is as wide as its columns (one or two) together.
    body.style.setProperty('--as-left', `${fold.left ? RAIL_PX : (this.layout.size?.left ?? LEFT_WIDTH.default) * this.cols}px`);
    body.style.setProperty('--as-right', `${fold.right ? RAIL_PX : this.layout.size?.right ?? RIGHT_WIDTH.default}px`);
    body.style.setProperty('--as-split', String(this.layout.size?.split ?? SPLIT.default));
    body.dataset.fold = Object.keys(fold).join(' ');
    for (const rail of body.querySelectorAll<HTMLElement>('.as-rail')) rail.hidden = !fold[rail.dataset.rail as StudioSide];
  }
  private saveLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout)); } catch { /* the layout lasts until the page reloads */ }
    this.applySizes();
  }
  private setSize(size: StudioSizes) {
    this.layout = withSize(this.layout, size);
    this.saveLayout();
  }
  /** Fold a side column away to its rail, or bring it back. */
  private setCollapsed(side: StudioSide, collapsed: boolean) {
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
      const move = (m: PointerEvent) => set(at(m));
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
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
  private toggleSection(id: string) { this.setSection(id, !this.isSectionOpen(id)); }
  private openSection(id: string) { if (!this.isSectionOpen(id)) this.setSection(id, true); }
  private setSection(id: string, open: boolean) {
    this.layout = withSection(this.layout, this.mode, id, open);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout)); } catch { /* the layout lasts until the page reloads */ }
    this.showSections();
  }
  /** Model mode: the stage shows the parameters' pose, but pivots belong to the rest pose; say so while a parameter is off its default. */
  private showRestNote() {
    this.root.querySelector<HTMLElement>('.as-rest-note')!.hidden = !(this.mode === 'model' && Object.keys(changedParams(this.parameters, this.params.values())).length);
  }
  /** What a closed section holds, beside its title. */
  private showSummaries() {
    const c = this.cur, chains = Object.keys(this.physics).length, defs = this.parameters.length;
    const by = [this.rig.idle ? 'idle' : '', this.rig.speakAnim ? 'talking' : '', this.rig.blink ? 'blink' : ''].filter(Boolean).join(', ');
    const tracks = c ? frameTracks(c.def.frames).length : 0;
    const sum: Record<string, string> = {
      sel: this.part ?? 'the whole character',
      params: defs ? String(defs) : 'none',
      poses: PosePanel.summary(this.poses),
      frames: tracks ? `${tracks} track${tracks === 1 ? '' : 's'}` : '',
      warp: this.warpPanel.summary(),
      mask: this.maskPanel.summary(),
      physics: chains ? `${chains} chain${chains === 1 ? '' : 's'}` : 'none',
      auto: by || 'none',
    };
    for (const sec of this.root.querySelectorAll<HTMLElement>('.as-sect')) sec.querySelector('.as-sect-sum')!.textContent = sum[sec.dataset.sect!] ?? '';
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

  /** Keep Tab inside the dialog: wrap from the last focusable element to the first and back. */
  private trapTab(e: KeyboardEvent) {
    const items = [...this.card.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
      .filter(x => x.tabIndex >= 0 && !(x as HTMLInputElement).disabled && x.getClientRects().length > 0);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === this.card)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    else if (!this.card.contains(at)) { e.preventDefault(); first.focus(); }
  }
  private doc(): Snap { return { categories: this.categories, parameters: this.parameters, pads: this.pads, keyforms: this.keyforms, poses: this.poses, physics: this.physics, deformers: this.deformers, masks: this.masks, anims: this.anims, pivots: this.pivots, bones: this.bones, parts: this.partBones, looks: this.looks, rig: this.rig }; }
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
    this.masks = structuredClone(start.masks);
    this.maskPanel.reset();
    this.shaking = null;
    this.anims = structuredClone(start.anims);
    this.pivots = structuredClone(start.pivots);
    this.bones = structuredClone(start.bones);
    this.partBones = structuredClone(start.parts);
    this.looks = structuredClone(start.looks);
    this.rig = { ...start.rig };
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
    this.select(this.entries.find(e => e.name === animation) ?? this.entries[0] ?? null);
    this.setPicking(mode === 'model' && this.gizmo.tool === 'pivot'); // the stage's studioReady repeats it once the page has loaded
    this.card.focus({ preventScroll: true });
  }

  close(force = false) {
    if (this.root.hidden) return;
    if (!force && this.dirty && !this.closeWarned) {
      this.closeWarned = true; // browser confirm dialogs are not shown everywhere: ask in the dialog, close on the second try
      this.note.textContent = this.host.standalone ? 'There are changes that were not saved. Save them (Ctrl+S), or press Open again to discard them.' : 'There are changes that were not applied. Apply them, or press Close (or Esc) again to discard them.';
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
      // A part on a bone selects the bone (the gizmo moves what hangs on it); the tree shares the selection. The Warp tool works on the part itself.
      const bone = e.name !== null ? this.partBones[e.name]?.bone : undefined;
      const target = e.name !== null && bone !== undefined && Object.hasOwn(this.bones, bone) && !(this.modeling && (this.gizmo.tool === 'warp' || this.gizmo.tool === 'mask')) ? bone : e.name;
      // Model, Ctrl held: the part joins the chosen ones (or leaves them) instead of replacing them.
      if (e.ctrl && this.modeling) this.toggleExtra(target); else this.choosePart(target);
      // Model: with a parameter active, picking a part on the stage binds it to the parameter (and makes its keys); a part that is bound already is only chosen, and so is every part with Shift held or while no parameter is active.
      if (this.modeling && !e.shift && target !== null && this.keyedControl() && !this.isBoundHere(target) && (this.part === target || this.extras.has(target))) this.bindPart(target);
    } else if (e.type === 'warpDrag') this.warpPanel.dragged(e.phase, e.part, e.point, e.delta);
    else if (e.type === 'warpBox') this.warpPanel.box(e.part, e.w, e.h);
    else if (e.type === 'maskDrag') this.maskPanel.dragged(e.phase, e.part, e.point, e.delta);
    else if (e.type === 'maskAdd') this.maskPanel.added(e.part, e.index, e.at);
    else if (e.type === 'maskRemove') this.maskPanel.removed(e.part, e.point);
    else if (e.type === 'maskBox') this.maskPanel.box(e.part, { x: e.x, y: e.y, w: e.w, h: e.h });
    else if (e.type === 'gizmo') this.gizmo.event(e);
    else if (e.type === 'key') {
      if (e.ctrl && e.key === 's') { if (this.host.standalone) void this.apply(); } // the stage page swallowed the browser's Save Page
      else this.gizmo.key(e.key, e.ctrl, e.shift);
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
    this.history.record(before);
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
    this.masks = s.masks;
    this.anims = s.anims;
    this.pivots = s.pivots;
    this.bones = s.bones;
    this.partBones = s.parts;
    this.looks = s.looks;
    this.rig = s.rig;
    this.changed();
  }
  private undo() {
    const prev = this.history.undo(this.snap());
    if (prev) this.restore(prev);
  }
  private redo() {
    const next = this.history.redo(this.snap());
    if (next) this.restore(next);
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
  /** The Warp tool: the stage draws the lattice of the chosen part's warp (and which point is chosen), or none. */
  private postWarp() {
    const part = this.modeling && this.gizmo.tool === 'warp' && this.part && deformerOf(this.deformers, this.part) ? this.part : null;
    const msg = { type: 'studioWarp', part, point: part ? this.warpPanel.point : null };
    const s = JSON.stringify(msg);
    if (s === this.warpSent) return;
    this.warpSent = s;
    this.post(msg);
  }
  /** The working copy of `masks` goes to the stage, which clips the parts by it; only when it differs from what the stage has. */
  private postMasks() {
    const s = JSON.stringify(this.masks);
    if (s === this.masksSent) return;
    this.masksSent = s;
    this.post({ type: 'studioMasks', masks: this.masks });
  }
  /** Model mode: the stage outlines the chosen part's mask (and with the Mask tool, a polygon's points are handles), or none. */
  private postMask() {
    const part = this.modeling && this.part && maskOf(this.masks, this.part) ? this.part : null;
    const msg = { type: 'studioMask', part, tool: part !== null && this.gizmo.tool === 'mask', point: part ? this.maskPanel.point : null };
    const s = JSON.stringify(msg);
    if (s === this.maskSent) return;
    this.maskSent = s;
    this.post(msg);
  }
  private postPivots() { this.post({ type: 'studioPivots', pivots: this.pivots, bones: this.bones, parts: this.partBones, width: this.host.width, height: this.host.height }); }
  /** The working copy changed: refresh the lists, the timeline and the stage. */
  private changed() {
    const name = this.cur?.name;
    this.rebuild();
    this.cur = this.entries.find(e => e.name === name) ?? this.entries[0] ?? null;
    if (this.keys.sel !== null && !this.cur?.def.keys[this.keys.sel]) this.keys.sel = null;
    this.post({ type: 'studioAnims', anims: this.anims });
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
      this.note.textContent = saving?.done ?? 'Applied to rig.json (Ctrl+Z in the editor undoes it; Ctrl+S saves).';
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
      g.append(...own.map(e => el('option', { value: e.name, textContent: e.name })));
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
    if (!this.extras.delete(part)) this.extras.add(part);
    this.refreshView();
  }
  private choosePart(part: string | null, keep: string[] = []) {
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

  // ---- idle, talking, blinking ----
  private showAuto() {
    const names = [...new Set([...Object.keys(this.anims).filter(n => Array.isArray(this.anims[n]?.keys)), ...Object.keys(ANIMS)])];
    for (const [sel, value] of [[this.idleSel, this.rig.idle], [this.speakSel, this.rig.speakAnim]] as const) {
      const all = value && !names.includes(value) ? [...names, value] : names; // a name the file has but nothing defines stays visible
      sel.replaceChildren(el('option', { value: '', textContent: '(none)' }), ...all.map(n => el('option', { value: n, textContent: n })));
      sel.value = value ?? '';
    }
    this.blinkBox.checked = this.rig.blink;
    const r = this.rig, a = this.auto;
    a.spSlot.value = r.speakSlot ?? '';
    a.spVars.value = r.speakVariants.join(', ');
    a.spRate.value = r.speakRate === null ? '' : String(r.speakRate);
    a.blSlot.value = r.blinkSlot ?? '';
    a.blVariant.value = r.blinkVariant ?? '';
    a.blMin.value = r.blinkEvery ? String(r.blinkEvery[0]) : '';
    a.blMax.value = r.blinkEvery ? String(r.blinkEvery[1]) : '';
    a.blDur.value = r.blinkDur === null ? '' : String(r.blinkDur);
    for (const k of ['blSlot', 'blVariant', 'blMin', 'blMax', 'blDur'] as const) a[k].disabled = !r.blink;
    this.root.querySelector('#as-slotnames')!.replaceChildren(...Object.keys(this.host.slots).map(n => el('option', { value: n })));
  }

  // ---- Model mode: authoring the keyforms of parameters, parameter first (as in Live2D Cubism) ----
  // The author picks the parameter (activeControl, never guessed), picks the parts it moves (a click on the stage or the tick in the Parts tree:
  // each pick binds the part and makes its keys at once, at rest), clicks a key to put the slider there and poses the part with the gizmo or the
  // Warp tool. The pure half is engine/src/param-bind.ts and keyform-edit.ts; the block under the controls is editor/anim-bind.ts.
  private modelHint(): string {
    const tool = this.gizmo.tool;
    if (tool === 'pivot') return 'Click the stage to place the pivot of the chosen part · Ctrl+Z undo · ' + this.leaveKey();
    if (tool === 'warp') return 'Warp tool: pick a part with a warp to bind it to the active parameter, then drag its lattice points at each key · Ctrl+Z undo · ' + this.leaveKey();
    if (tool === 'mask') return 'Mask tool: pick a part with a drawn mask to bind it to the active parameter, then drag its points at each key · Ctrl+Z undo · ' + this.leaveKey();
    return 'Pick a parameter, click the parts it moves on the stage (or tick them in the tree; Shift-click only selects, Ctrl-click adds a part so one drag poses them all), click a key and pose the part with the gizmo (W, E, R) · Ctrl+Z undo · ' + this.leaveKey();
  }
  private controlExists(control: string): boolean {
    return control.startsWith('pad:') ? this.pads.some(p => `pad:${p.id}` === control) : this.parameters.some(p => p.id === control);
  }
  /** The active parameter's control key (a parameter id, or `pad:<id>`), or null while the author has picked none. */
  private keyedControl(): string | null {
    if (!this.modeling) return null;
    return this.activeControl && this.controlExists(this.activeControl) ? this.activeControl : null;
  }
  private chooseControl(control: string) {
    this.activeControl = control;
    this.refreshView(); // the tree's ticks, the Warp section and the Bind block follow
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
    const part = this.part, spot = this.keyedSpot();
    if (!part || !spot) return;
    const form = field === null ? {} : { ...spotForm(this.keyforms, this.parameters, part, spot), [field]: field === 'opacity' ? Math.max(0, value) : value };
    const r = writeForm(this.keyforms, this.parameters, part, spot, form);
    if (!r) return;
    this.edit(() => { this.keyforms = r.keyforms; });
    this.followSpot(r.spot);
  }

  /** The ease select of the Pose row: the curve into the slider key at the spot (one undo step). */
  private setEase(ease: string) {
    const part = this.part, spot = this.keyedSpot();
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
  private bindDoc(): BindDoc { return { keyforms: this.keyforms, deformers: this.deformers, masks: this.masks }; }
  /** What a pick binds, by the tool that is on: the pose of a bone or part, the lattice of a warp (Warp tool) or the points of a drawn mask (Mask tool). */
  private bindKind(): BindKind { return this.gizmo.tool === 'warp' ? 'warp' : this.gizmo.tool === 'mask' ? 'mask' : 'pose'; }
  private activeName(): string {
    const c = this.keyedControl();
    return c && c.startsWith('pad:') ? c.slice(4) : c ?? '';
  }
  private isBoundHere(part: string): boolean {
    const d = this.driver();
    return !!d && boundParts(this.bindDoc(), d).some(b => b.target === part && b.kind === this.bindKind());
  }

  /** Bind `part` to the active parameter as the tool says (one undo step) and say what was made. */
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
      else if ('param' in driver && kind === 'warp') { const r = bindDeformer(this.deformers, this.parameters, part, driver.param); if (r.bound) { this.deformers = r.deformers; bound = true; } }
      else if ('param' in driver) { const r = bindMask(this.masks, this.parameters, part, driver.param); if (r.bound) { this.masks = r.masks; bound = true; } }
    });
    if (!bound) {
      this.note.textContent = kind === 'warp' && !deformerOf(this.deformers, part) ? `${part} has no warp yet: choose it, then Add warp in the Warp section.`
        : kind === 'mask' && !maskOf(this.masks, part)?.polygon ? `${part} has no drawn mask polygon to key (a mask that follows another part has no points).`
        : `${part} is bound to ${name} already.`;
      return false;
    }
    const shown = (v: number) => String(Math.round(v * 1000) / 1000);
    if ('param' in driver) {
      const keys = kind === 'pose' ? keyTicks(this.keyforms, driver.param, part) : warpTicks(kind === 'warp' ? deformerOf(this.deformers, part)?.keyforms : maskOf(this.masks, part)?.keyforms, driver.param);
      const how = kind === 'pose' ? `pose ${part} with the gizmo (W, E, R)` : `drag the ${kind === 'warp' ? 'lattice' : 'mask'} points`;
      this.note.textContent = `Bound ${part} to ${name}: keys at ${keys.map(k => shown(k.at)).join(', ')}, all at rest. Click a key (or move the slider to one), then ${how} there.`;
    } else {
      const g = this.keyforms.find(k => k.target === part && k.params?.[0] === driver.params[0] && k.params?.[1] === driver.params[1])?.grid;
      this.note.textContent = `Bound ${part} to ${name}: a ${g?.x.length ?? this.bindSize} × ${g?.y.length ?? this.bindSize} grid of corners, all at rest. Click a corner on the pad (or move its dot there), then pose ${part} with the gizmo (W, E, R).`;
    }
    return true;
  }

  /** The chosen part takes over the keys of `from` on the active parameter, mirrored sideways when asked (one undo step). */
  private copyKeysFrom(from: string, fromControl: string, mirror: boolean) {
    const driver = this.driver(), part = this.part, name = this.activeName();
    const fromDriver = driverOf(fromControl, this.parameters, this.pads);
    if (!driver || !part || !fromDriver) return;
    let done = false;
    this.edit(() => {
      const r = copyKeys(this.keyforms, this.parameters, { target: from, driver: fromDriver }, { target: part, driver }, { flip: mirror, reverse: mirror });
      if (r.copied) { this.keyforms = r.keyforms; done = true; }
    });
    const other = fromControl === this.keyedControl() ? '' : ` (from ${fromControl.startsWith('pad:') ? fromControl.slice(4) : fromControl})`;
    this.note.textContent = done ? `${part} took the keys of ${from}${other} on ${name}${mirror ? ', mirrored' : ''} (Ctrl+Z undoes it).` : `Nothing to copy from ${from} to ${part}.`;
  }

  /** Take `part` off the active parameter: its keys of that kind go (one undo step; Ctrl+Z brings them back). */
  private unbindPart(part: string, kind: BindKind) {
    const driver = this.driver(), name = this.activeName();
    if (!driver) return;
    let gone = false;
    this.edit(() => {
      if (kind === 'pose') { const r = unbindPose(this.keyforms, part, driver); if (r.unbound) { this.keyforms = r.keyforms; gone = true; } }
      else if ('param' in driver && kind === 'warp') { const r = unbindDeformer(this.deformers, part, driver.param); if (r.unbound) { this.deformers = r.deformers; gone = true; } }
      else if ('param' in driver) { const r = unbindMask(this.masks, part, driver.param); if (r.unbound) { this.masks = r.masks; gone = true; } }
    });
    if (gone) this.note.textContent = `Unbound ${part} from ${name}: its ${kind === 'pose' ? 'keys' : `${kind} keys`} there were removed (Ctrl+Z brings them back).`;
  }

  /** The tick of a row in the Parts tree: bind the part to the active parameter (and choose it), or unbind it. */
  private toggleBind(part: string, subtree = false) {
    const driver = this.driver();
    if (!driver) { this.note.textContent = 'Pick a parameter first: click its name in the Parameters section.'; this.openSection('params'); return; }
    if (subtree && this.selIsBone(part) && this.bindKind() === 'pose') { this.toggleSubtree(part, driver); return; }
    if (this.isBoundHere(part)) { this.unbindPart(part, this.bindKind()); return; }
    this.choosePart(part);
    this.bindPart(part);
  }

  /** Alt on a bone's tick: bind the bone, the bones below it and their parts together, or unbind them all when the bone is bound (one undo step). */
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

  /** The ticks of the Parts tree: the parts bound to the active parameter by the kind the tool says. */
  private treeBind(): { bound: string[]; what: string } | null {
    const d = this.driver();
    if (!d) return null;
    const kind = this.bindKind(), name = this.activeName();
    return { bound: boundParts(this.bindDoc(), d).filter(b => b.kind === kind).map(b => b.target), what: kind === 'pose' ? name : `${name} (${kind})` };
  }

  /** The marks on a slider's track: the chosen part's keys on it (its warp's and mask's too). The active slider shows the keys of every part bound to it while the chosen part has none. */
  private ticksOf(id: string): KeyTick[] {
    const part = this.part, mine = new Map<number, boolean>();
    const add = (list: KeyTick[]) => { for (const t of list) mine.set(t.at, (mine.get(t.at) ?? false) || t.posed); };
    if (part) { add(keyTicks(this.keyforms, id, part)); add(warpTicks(deformerOf(this.deformers, part)?.keyforms, id)); add(warpTicks(maskOf(this.masks, part)?.keyforms, id)); }
    if (!mine.size && this.keyedControl() === id) add(keyTicks(this.keyforms, id));
    return [...mine].map(([at, posed]) => ({ at, posed })).sort((a, b) => a.at - b.at);
  }
  /** The corners drawn on a pad: the chosen part's grid, else the grids of every part. */
  private cornersOf(x: string, y: string) {
    const mine = this.part ? padCorners(this.keyforms, [x, y], this.part) : [];
    return mine.length ? mine : padCorners(this.keyforms, [x, y]);
  }

  /** A finished gizmo drag in Model mode: the active parameter decides where it is written. A part not bound to it yet is bound first (all in one undo step). */
  private keyformDrag(name: string, delta: Offset) {
    const driver = this.driver(), spot = this.keyedSpot(), pad = driver ? 'params' in driver : false;
    if (!driver || !spot) {
      this.note.textContent = this.parameters.length
        ? 'Nothing was written: pick a parameter first. Click its name in the Parameters section, then pose again.'
        : 'Nothing was written: this character has no parameters yet. Add one in the Parameters section (New parameter), then pose again.';
      this.openSection('params');
      this.refreshView();
      return;
    }
    // The chosen parts move together: the dragged one and every part Ctrl-clicked with it, each by the same delta.
    const group = name === this.part ? [name, ...this.extras] : [name];
    let written: KeySpot | null = null, boundNow = false, wrote: string[] = [];
    this.edit(() => {
      let kfs = this.keyforms;
      for (const t of group) if (!isBound(kfs, t, driver)) { kfs = bindPose(kfs, this.parameters, t, driver, this.bindSize).keyforms; boundNow = true; }
      const r = dragForms(kfs, this.parameters, group, spot, delta, this.params.values());
      if (r) { this.keyforms = r.keyforms; written = r.spot; wrote = r.written; }
    });
    if (!written) return;
    const at: KeySpot = written;
    this.followSpot(at);
    const who = wrote.length > 1 ? `${wrote.length} parts (${wrote.join(', ')})` : name;
    this.note.textContent = `${boundNow ? `Bound ${who} to ${this.activeName()} and wrote ` : 'Wrote '}${who} at ${spotLabel(at)} as ${wrote.length > 1 ? 'keyforms' : 'a keyform'}${pad ? ' (a corner of the grid)' : ''}. Ctrl+Z undoes the whole drag.`;
  }

  /** The ◆ of a control and "Add key here": a key of the chosen part at the slider's value, or take the one there away. A part that is not bound yet is bound first. */
  private toggleKey(spot: KeySpot | null) {
    const part = this.part, driver = this.driver();
    if (!driver || !spot) return;
    if (!part) { this.note.textContent = 'Choose a part or bone first: click it on the stage or in the Parts tree.'; return; }
    if (this.bindKind() !== 'pose') { this.note.textContent = 'With the Warp or Mask tool a drag of a point adds the key at the slider\'s value. Choose Move, Rotate or Scale to key a pose.'; return; }
    if (!isBound(this.keyforms, part, driver)) { this.bindPart(part); return; }
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

  /** Everything the Bind block shows. */
  private bindView(): BindView {
    const driver = this.driver(), control = this.keyedControl(), part = this.part, kind = this.bindKind();
    const none: BindView = { active: null, chosen: part, bound: [], canBind: false, keyAction: null, keys: [], size: this.bindSize, form: { text: '', values: null, can: false }, affecting: [], copyFrom: [], hint: '' };
    if (!this.modeling) return none;
    const doc = this.bindDoc();
    const affecting = part ? affectedBy(doc, part).flatMap(a => {
      const c = controlOf(a.driver, this.parameters, this.pads);
      return c ? [{ control: c, name: c.startsWith('pad:') ? c.slice(4) : c, kind: a.kind, active: c === control }] : [];
    }) : [];
    if (!driver || !control) {
      return { ...none, affecting, hint: !this.parameters.length ? 'This character has no parameters yet: New parameter adds a slider.' : 'Click the name of a parameter above to make it the active one. Then pick the parts it moves, on the stage or in the Parts tree.' };
    }
    const shown = (v: number) => String(Math.round(v * 1000) / 1000);
    const def = 'param' in driver ? this.parameters.find(p => p.id === driver.param) : undefined;
    const pad = 'params' in driver ? this.pads.find(p => `pad:${p.id}` === control) : undefined;
    const name = this.activeName();
    const active = { control, name, pad: 'params' in driver, span: def ? `${shown(def.min)} to ${shown(def.max)}, default ${shown(def.default)}` : pad ? `${pad.x} across, ${pad.y} up` : '' };
    const bound: BindRow[] = boundParts(doc, driver).map(b => ({ ...b, chosen: b.target === part || this.extras.has(b.target) }));
    const here = bound.find(b => b.target === part && b.kind === kind);
    const canBind = !!part && !here && (kind === 'pose' || ('param' in driver && (kind === 'warp' ? !!deformerOf(this.deformers, part) : !!maskOf(this.masks, part)?.polygon)));
    const spot = this.keyedSpot(), poseBound = !!part && isBound(this.keyforms, part, driver);
    let keyAction: BindView['keyAction'] = null, keys: BindView['keys'] = [];
    if (part && def && kind === 'pose' && poseBound) {
      const v = this.params.values()[def.id], tol = KEY_SNAP * (def.max - def.min);
      keys = keyTicks(this.keyforms, def.id, part).map(t => ({ ...t, here: Math.abs(t.at - v) <= tol }));
      keyAction = spot && isKeyed(this.keyforms, this.parameters, part, spot) ? (Math.abs(v - def.default) <= tol ? 'default' : 'remove') : 'add';
    }
    let form: BindView['form'] = { text: '', values: null, can: false };
    if (part) {
      if (kind !== 'pose') form = { text: `The ${kind} of ${part} is posed with its ${kind === 'warp' ? 'lattice' : 'mask'} points on the stage (the Warp section has the numbers).`, values: null, can: false };
      else if (!poseBound) form = { text: `${part} is not bound to ${name} yet. Bind it above, or drag it with the gizmo: that binds it too.`, values: null, can: false };
      else if (spot) {
        const snapped = snapSpot(this.keyforms, this.parameters, part, spot) ?? spot, stored = formAt(this.keyforms, this.parameters, part, spot);
        form = { text: isPadSpot(snapped) ? `${part} at the corner ${spotLabel(snapped)} (the nearest to the dot)` : `${part} at ${spotLabel(snapped)}${stored ? ' (a key)' : ': between keys, a drag or a field makes a key here'}`, values: stored as FullForm | null, can: true, ease: easeAt(this.keyforms, this.parameters, part, spot) };
      }
    } else form = { text: 'Choose a part (the stage or the tree) to see and edit its pose at the keys.', values: null, can: false };
    const hint = !bound.length ? `Click a part on the stage, or tick it in the Parts tree, to bind it to ${name}: that makes its keys at once, all at rest.`
      : part && !here && canBind ? `${part} is not bound to ${name}: press Bind, tick it in the tree, or just drag it.`
      : 'Click a key to put the slider there, then pose the chosen part with the gizmo (W, E, R). Picking another part binds it too.';
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
    return { active, chosen: part, bound, canBind, keyAction, keys, size: this.bindSize, form, affecting, copyFrom, hint };
  }

  // ---- Model mode: the parameters and pads themselves ----
  private paramDoc(): ParamDoc {
    return { categories: this.categories, parameters: this.parameters, pads: this.pads, keyforms: this.keyforms, poses: this.poses, anims: this.anims, deformers: this.deformers, masks: this.masks, physics: this.physics };
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
      this.categories = d.categories; this.parameters = d.parameters; this.pads = d.pads; this.keyforms = d.keyforms; this.poses = d.poses; this.anims = d.anims; this.deformers = d.deformers; this.masks = d.masks; this.physics = d.physics;
    });
    this.note.textContent = r.note;
    return r.id ?? '';
  }

  // ---- transport ----
  /** Start or stop placing the pivot of the selected part by clicking on the stage. */
  private setPicking(on: boolean) {
    if (on && this.mode === 'model') this.gizmo.tool = 'pivot'; // asking for a pivot is choosing the Pivot tool
    this.picking = on && !!this.part && this.mode === 'model' && this.gizmo.tool === 'pivot';
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
  private setSelPivot(at: [number, number] | null) {
    const p = this.part;
    if (!p) return;
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
    const x = xOf(this.tl, this.t);
    this.playLine?.setAttribute('x1', String(x));
    this.playLine?.setAttribute('x2', String(x));
  }

  // ---- everything that depends on the animation or the selection ----
  private refreshView() {
    const c = this.cur, can = this.editable();
    this.title.textContent = `${this.char}${this.dirty ? ' •' : ''}`;
    this.tools.undo.disabled = !this.history.canUndo;
    this.tools.redo.disabled = !this.history.canRedo;
    this.tools.apply.disabled = !this.dirty;
    this.exportBtn.disabled = !c;
    this.durInput.disabled = !can;
    this.durInput.value = c ? String(c.dur) : '';
    const keyed = c ? animParts(c.def) : [];
    const parts = [...new Set([...this.host.parts, ...Object.keys(this.bones), ...keyed])];
    if (this.part && !parts.includes(this.part)) this.part = null;
    for (const p of [...this.extras]) if (!this.part || !this.modeling || p === this.part || !parts.includes(p)) this.extras.delete(p);
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
    this.maskPanel.show();
    this.postMask();
    this.refreshParamKey();
    this.refreshFrameTab();
    this.drawTimeline();
    this.showTransport();
    this.keepFocus();
  }

  /** A focused button that just got disabled (Apply, Undo, Delete key...) drops focus to the page, where the studio's keys
   *  (Esc, Space, Ctrl+Z) no longer reach it: take focus back to the dialog. The browser moves focus off a disabled element
   *  only later, so a disabled activeElement counts as lost already. */
  private keepFocus() {
    const a = document.activeElement as HTMLButtonElement | null;
    if (!this.root.hidden && (!this.root.contains(a) || a?.disabled)) this.card.focus({ preventScroll: true });
  }

  /** The selected parameter key's fields in the Parameters section. */
  private refreshParamKey() {
    const sel = this.ptracks.sel, k = sel ? this.cur?.def.params?.[sel.id]?.[sel.index] : undefined, can = this.editable();
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-pk]')) { input.value = k ? String(input.dataset.pk === 't' ? k.t : k.v) : ''; input.disabled = !can || !k; }
    const ease = this.root.querySelector<HTMLSelectElement>('.ap-ease')!;
    ease.value = k?.ease ?? '';
    ease.disabled = !can || !k;
    this.root.querySelector<HTMLButtonElement>('.ap-delkey')!.disabled = !can || !k;
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
    q('t').value = k ? String(k.t) : '';
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
      ...keys.map(({ index, key }) => el('option', { value: String(index), textContent: `t=${key.t}  ${KEY_CHANNELS.filter(ch => key[ch] !== undefined).map(ch => `${ch} ${key[ch]}`).join(', ')}` })));
    this.keySel.value = this.keys.sel !== null && keys.some(x => x.index === this.keys.sel) ? String(this.keys.sel) : '';
    this.keySel.disabled = !keys.length;
    this.fields.t.value = k ? String(k.t) : '';
    for (const ch of KEY_CHANNELS) this.fields[ch].value = k?.[ch] !== undefined ? String(k[ch]) : '';
    this.easeSel.value = k?.ease ?? '';
    for (const f of [...Object.values(this.fields), this.easeSel, this.delKey]) f.disabled = !can || !k;
    this.addBtn.disabled = this.addCh.disabled = !can;
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
    if (!c) { this.tl.replaceChildren(); return; }
    this.playLine = drawTimeline(this.tl, { def: c.def, dur: c.dur, preset: c.preset, editable: this.editable(), part: this.part, sel: this.keys.sel, frozen: this.keys.frozen, ranges: this.ranges, tracks: this.trackLanes(), selParam: this.ptracks.sel, frames: this.frameRows(), selFrame: this.frames.sel });
    this.showTime();
  }
}

type StudioTools = Record<'undo' | 'redo' | 'apply' | 'scene' | 'open' | 'resetdock', HTMLButtonElement>;
