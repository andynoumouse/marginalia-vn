import { filterLooks, nextLooks } from './fx.js';
import { layerPoses } from './params.js';
import { CAMERA_TARGET, type DisplayState, type SpriteState, type VisualOp } from './types.js';

export const emptyState = (): DisplayState => ({ bg: null, sprites: [], music: null, musicLoop: false, tint: null, camera: { zoom: 1, x: 0.5, y: 0.5 }, weather: null, filter: null, images: [], hud: [] });

/** A character just shown with nothing set: bottom centre, no scale, rotation, flip or animation. */
export const newSprite = (char: string): SpriteState => ({ char, pose: null, more: [], overrides: {}, x: 0.5, y: 0, scale: 1, rotation: 0, alpha: 1, flip: false, anchor: [0.5, 1], anim: null, params: {} });

type Poses = Record<string, Record<string, Record<string, number>>> | undefined;
/** One handler per visual op that leaves lasting state; flash, shake, hop, one-shot animate, sound play, movie and wait have none. */
type Handlers = { [K in VisualOp['op']]?: (state: DisplayState, op: Extract<VisualOp, { op: K }>, poses: Poses) => void };

const spriteOf = (state: DisplayState, char: string) => state.sprites.find(x => x.char === char);

const HANDLERS: Handlers = {
  scene(state, op) {
    state.bg = op.bg;
    state.sprites = [];
    state.tint = null;
    state.camera = { zoom: 1, x: 0.5, y: 0.5 };
    state.weather = null;
    state.filter = null;
    state.wind = null;
    state.gravity = null;
    state.images = (state.images ?? []).filter(i => i.keep);
    state.hud = (state.hud ?? []).filter(h => h.keep);
  },
  show(state, op, poses) {
    let s = spriteOf(state, op.char);
    if (!s) {
      s = newSprite(op.char);
      state.sprites.push(s);
    }
    if (op.pose !== null) { s.pose = op.pose; s.more = [...op.more]; s.overrides = { ...op.overrides }; }
    else s.overrides = { ...s.overrides, ...op.overrides };
    if (op.poses?.length) s.params = { ...s.params, ...layerPoses(poses?.[op.char], op.poses) };
    if (op.x !== null) s.x = op.x;
    if (op.y !== undefined) s.y = op.y;
    if (op.scale !== undefined) s.scale = op.scale;
    if (op.flip !== undefined) s.flip = op.flip;
    if (op.anchor !== undefined) s.anchor = [...op.anchor];
    if (op.order || (op.behind && state.sprites.some(x => x.char === op.behind))) { // behind someone not on stage: stays where it is
      const rest = state.sprites.filter(x => x !== s);
      const at = op.order === 'back' ? 0 : op.order === 'front' ? rest.length : rest.findIndex(x => x.char === op.behind);
      state.sprites = [...rest.slice(0, at), s, ...rest.slice(at)];
    }
  },
  hide(state, op) {
    state.sprites = state.sprites.filter(x => x.char !== op.char);
  },
  move(state, op) {
    const s = spriteOf(state, op.char);
    if (!s) return;
    if (op.x !== null) s.x = op.x;
    if (op.y !== null) s.y = op.y;
    if (op.scale !== null) s.scale = op.scale;
    if (op.rotation !== null) s.rotation = op.rotation;
    if (op.alpha !== null) s.alpha = op.alpha;
    if (op.flip !== null) s.flip = op.flip;
    if (op.anchor !== null) s.anchor = [...op.anchor];
    if (op.tint !== undefined) { if (op.tint === null) delete s.tint; else s.tint = op.tint; }
  },
  param(state, op, poses) {
    const s = spriteOf(state, op.char);
    if (s) s.params = { ...s.params, ...layerPoses(poses?.[op.char], op.poses), ...op.params };
  },
  animate(state, op) {
    if (op.char === CAMERA_TARGET) { // the camera: its running loop and automatic transforms live in `state.camera`
      const cam = state.camera ??= { zoom: 1, x: 0.5, y: 0.5 };
      if (op.auto && op.name !== null) {
        const rest = (cam.autos ?? []).filter(n => n !== op.name);
        const next = op.auto === 'on' ? [...rest, op.name] : rest;
        if (next.length) cam.autos = next; else delete cam.autos;
      } else if (op.loop || op.name === null) {
        if (op.name === null) delete cam.anim;
        else cam.anim = { name: op.name, dur: op.dur, strength: op.strength, part: null, ...(op.def ? { def: op.def } : {}) };
      }
      return;
    }
    if (op.auto && op.name !== null) { // attach or detach an automatic transform (the renderer's scheduler runs it)
      const target = spriteOf(state, op.char) ?? (state.images ?? []).find(i => i.name === op.char);
      if (!target) return;
      const rest = (target.autos ?? []).filter(n => n !== op.name);
      const next = op.auto === 'on' ? [...rest, op.name] : rest;
      if (next.length) target.autos = next; else delete target.autos;
      return;
    }
    if (!(op.loop || op.name === null)) return;
    const anim = op.name === null ? null : { name: op.name, dur: op.dur, strength: op.strength, part: op.part, ...(op.def ? { def: op.def } : {}) };
    const s = spriteOf(state, op.char);
    if (s) { s.anim = anim; return; }
    const img = (state.images ?? []).find(i => i.name === op.char);
    if (img) { if (anim) img.anim = anim; else delete img.anim; }
  },
  image(state, op) {
    const images = state.images ??= [];
    if (op.action === 'hide') { state.images = images.filter(i => i.name !== op.name); return; }
    let img = images.find(i => i.name === op.name);
    if (op.action === 'show') {
      if (!img) {
        img = { name: op.name, file: op.file, x: 0, y: 0, scale: 1, rotation: 0, alpha: 1, anchor: [0, 0], layer: 0, fixed: false, keep: false };
        images.push(img);
      }
      img.file = op.file;
      if (op.x !== undefined) img.x = op.x;
      if (op.y !== undefined) img.y = op.y;
      if (op.scale !== undefined) img.scale = op.scale;
      if (op.rotation !== undefined) img.rotation = op.rotation;
      if (op.alpha !== undefined) img.alpha = op.alpha;
      if (op.anchor !== undefined) img.anchor = [...op.anchor];
      if (op.layer !== undefined) img.layer = op.layer;
      if (op.fixed !== undefined) img.fixed = op.fixed;
      if (op.keep !== undefined) img.keep = op.keep;
      if (op.tint !== undefined) img.tint = op.tint;
      if (op.parallax !== undefined) { if (op.parallax === 1) delete img.parallax; else img.parallax = op.parallax; }
    } else if (img) {
      if (op.x !== null) img.x = op.x;
      if (op.y !== null) img.y = op.y;
      if (op.scale !== null) img.scale = op.scale;
      if (op.rotation !== null) img.rotation = op.rotation;
      if (op.alpha !== null) img.alpha = op.alpha;
      if (op.anchor !== null) img.anchor = [...op.anchor];
      if (op.tint !== undefined) { if (op.tint === null) delete img.tint; else img.tint = op.tint; }
    }
  },
  music(state, op) {
    if (op.action === 'pause') { if (state.music) state.musicPaused = true; return; }
    if (op.action === 'resume') { delete state.musicPaused; return; }
    state.music = op.action === 'play' ? op.name : null;
    state.musicLoop = op.action === 'play' && op.loop;
    delete state.musicPaused;
  },
  sound(state, op) {
    if (op.action === 'loop' && op.name) { if (!(state.ambience ?? []).includes(op.name)) state.ambience = [...(state.ambience ?? []), op.name]; }
    else if (op.action === 'stop') {
      const left = op.name ? (state.ambience ?? []).filter(n => n !== op.name) : [];
      if (left.length) state.ambience = left; else delete state.ambience;
    }
  },
  tint(state, op) {
    state.tint = op.color ? { color: op.color, strength: op.strength } : null;
  },
  camera(state, op) {
    const was = state.camera;
    const roll = op.roll ?? was?.roll ?? 0;
    // What `animate camera` runs is not part of the view: a zoom, pan, roll or reset leaves it going.
    state.camera = { zoom: op.zoom ?? was?.zoom ?? 1, x: op.x ?? was?.x ?? 0.5, y: op.y ?? was?.y ?? 0.5, ...(roll ? { roll } : {}), ...(was?.anim ? { anim: was.anim } : {}), ...(was?.autos ? { autos: was.autos } : {}) };
  },
  weather(state, op) {
    state.weather = op.kind ? { kind: op.kind, intensity: op.intensity } : null;
  },
  filter(state, op) {
    const looks = nextLooks(filterLooks(state.filter), op.looks, op.merge);
    state.filter = looks.length ? looks : null;
  },
  letterbox(state, op) {
    if (op.size > 0) state.letterbox = op.size; else delete state.letterbox;
  },
  gravity(state, op) {
    state.gravity = op.factor === 1 ? null : op.factor;
  },
  wind(state, op) {
    state.wind = op.strength ? { strength: op.strength, gusts: op.gusts } : null;
  },
  behaviors(state, op) {
    if (op.on) delete state.behaviors; else state.behaviors = false;
  },
  focus(state, op) {
    if (op.on) delete state.focus; else state.focus = false;
  },
};

/** Apply a visual command to the canonical display state (also used for instant restore). */
export function applyToState(state: DisplayState, op: VisualOp, poses?: Record<string, Record<string, Record<string, number>>>): void {
  (HANDLERS[op.op] as ((state: DisplayState, op: VisualOp, poses: Poses) => void) | undefined)?.(state, op, poses);
}
