// The character's parts, bones and looks in the animation studio. Three places on screen, one state: the Parts tree (the
// left column: one plain row for each part and bone, the way to choose what you work on), the details of the chosen row
// (a section of the right column: its bone, its variants; in Model mode also the bone's parent and Remove), and the Look
// choice (the left column, under the animation picker). It draws from the studio's working copy (read through
// `TreeHost.state`) and hands every change back through the host.

import { addBone, animParts, boneRows, deleteBone, partsUnder, saveLook, setBoneParent, setPartBone, uniqueBoneName, type AnimDef, type Bones, type Looks, type PartBones, type RigOutline, type StudioMode } from '../engine/src/index.js';
import { el } from './anim-dom.js';

export interface TreeState {
  char: string;
  mode: StudioMode;
  pose: string | null;
  overrides: Record<string, string>;
  looks: Looks;
  bones: Bones;
  partBones: PartBones;
  /** The mask shapes (imageless parts, Model mode) and the part or shape each clipped part is clipped to. */
  shapes: Record<string, { bone?: string }>;
  clips: Record<string, string>;
  /** The part (or bone) chosen, null for the whole character. */
  part: string | null;
  /** The animation on show, for its "keyed" marks. */
  anim: { name: string; def: AnimDef } | null;
  /** Model mode with a parameter active: a mark on each row shows whether that part is bound to it (`bound` are the ones bound now, `what` names the parameter). A display only: binding is done in the Bind block's picker. */
  bind: { bound: string[]; what: string; kind: string } | null;
  /** Parts and bones hidden on the stage (a studio aid, never saved). */
  hidden: string[];
}

export interface TreeHost {
  state(): TreeState;
  outline(pose: string | null, overrides: Record<string, string>, looks: Looks): RigOutline | undefined;
  image(file: string): string | undefined;
  /** Replace some of the working copy as one undo step; `part` follows when given. */
  change(patch: { bones?: Bones; parts?: PartBones; looks?: Looks; part?: string | null }): void;
  /** `add` (Ctrl held, Model mode): add the part to the chosen ones, or take it off. `subtree` (Alt held): a bone's whole subtree, for a pick that binds. */
  choosePart(part: string | null, add?: boolean, subtree?: boolean): void;
  /** Set a slot's variant on the stage (the one set already goes back to what the look picks). */
  toggleVariant(slot: string, variant: string): void;
  /** Hide a row's parts on the stage, or show them again; `solo` hides every other part instead. */
  toggleHidden(name: string, solo: boolean): void;
  /** Show every part on the stage again. */
  showAll(): void;
  /** Dress the stage with a look (null: the default). */
  pickLook(pose: string | null): void;
  selIsBone(name: string | null): boolean;
  note(text: string): void;
}

/** Where the three views draw. */
export interface TreeRoots { tree: HTMLElement; detail: HTMLElement; looks: HTMLElement }

export class RigTree {
  private drawn = '';                       // what is shown now, so it is rebuilt only when that changes
  private collapsed = new Set<string>();    // bones whose subtree the tree hides
  private scrolledTo: string | null | undefined; // the part the tree last scrolled to

  constructor(readonly roots: TreeRoots, private host: TreeHost) {
    for (const r of [roots.tree, roots.detail]) {
      r.addEventListener('click', e => this.click(e));
      r.addEventListener('keydown', e => this.key(e));
    }
  }

  private all() { return [this.roots.tree, this.roots.detail, this.roots.looks]; }
  private own(e: Element) { return this.all().some(r => r.contains(e)); }

  /** Draw again whatever the state is (a new character or a reloaded stage). */
  reset() { this.drawn = ''; this.scrolledTo = undefined; }

  private click(e: MouseEvent) {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b || !this.own(b)) return;
    const d = b.dataset;
    if (d.slot !== undefined && d.variant !== undefined) this.host.toggleVariant(d.slot, d.variant);
    else if (d.eye !== undefined) this.host.toggleHidden(d.eye, e.altKey);
    else if (d.showAll !== undefined) this.host.showAll();
    else if (d.part !== undefined) this.host.choosePart(d.part || null, e.ctrlKey || e.metaKey, e.altKey);
  }

  /** Up / Down / Home / End move between the rows of the tree; Left / Right (and Home / End) between a slot's variants. */
  private key(e: KeyboardEvent) {
    const from = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!from || !this.own(from) || e.altKey || e.ctrlKey || e.metaKey) return;
    const chip = from.classList.contains('as-variant');
    const list = chip ? [...from.parentElement!.querySelectorAll<HTMLButtonElement>('.as-variant')] : [...this.roots.tree.querySelectorAll<HTMLButtonElement>('.as-row')];
    const prev = chip ? 'ArrowLeft' : 'ArrowUp', next = chip ? 'ArrowRight' : 'ArrowDown';
    const i = list.indexOf(from);
    const to = e.key === prev ? i - 1 : e.key === next ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
    if (to === null || i < 0) return;
    e.preventDefault(); // also at the ends, so the arrow does not scroll the panel
    list[to]?.focus();
  }

  show() {
    const { host, roots } = this;
    const s = host.state();
    const { char, bones, partBones } = s;
    const shapeNames = s.mode === 'model' ? Object.keys(s.shapes) : [];
    const o = host.outline(s.pose, s.overrides, s.looks);
    const keyed = s.anim ? animParts(s.anim.def) : [];
    const drawn = JSON.stringify([o, keyed, s.part, s.pose, s.overrides, s.anim?.name, bones, partBones, shapeNames.map(n => [n, s.shapes[n].bone]), s.clips, s.looks, s.mode, [...this.collapsed], s.bind, s.hidden]);
    if (drawn === this.drawn) return;
    this.drawn = drawn;
    const model = s.mode === 'model';
    const active = document.activeElement instanceof HTMLElement && this.own(document.activeElement) && Object.keys(document.activeElement.dataset).length ? JSON.stringify(document.activeElement.dataset) : null;
    for (const r of this.all()) r.replaceChildren();
    if (!o?.parts.length) {
      roots.tree.append(el('p', { className: 'as-tree-hint', textContent: `No parts: ${char} is a flat character (or has no converted PSD yet), so its keys move the whole body.` }));
      return;
    }
    const thumb = (file: string | null) => {
      const src = file ? host.image(file) : undefined;
      return src ? el('img', { src, alt: '', loading: 'lazy' }) : el('span', { className: 'as-thumb' });
    };
    const badge = (kind: string, title: string) => el('span', { className: `as-badge as-badge-${kind}`, textContent: kind, title });
    const keys = (name: string) => (keyed.includes(name) ? el('span', { className: 'as-keyed', textContent: 'keyed', title: `${s.anim!.name} moves it` }) : '');
    const muted = (text: string) => el('span', { className: 'as-muted', textContent: text });
    const row = (part: string | null, ...kids: (Node | string)[]) => {
      const b = el('button', { type: 'button', className: 'as-row' }, ...kids);
      b.dataset.part = part ?? '';
      b.setAttribute('aria-pressed', String(s.part === part));
      return b;
    };
    // Model mode: a mark before a row says whether that part is bound to the active parameter. It is a display; "Bind parts…" is what binds, and the ✕ in the Bound parts list unbinds.
    const tick = (name: string): HTMLElement | null => {
      if (!s.bind) return null;
      const on = s.bind.bound.includes(name);
      const b = el('span', { className: 'as-bind', textContent: on ? '✓' : '' });
      b.dataset.bind = name;
      b.title = on ? `${name} is bound to ${s.bind.what}` : `${name} is not bound to ${s.bind.what}`;
      b.setAttribute('role', 'img');
      b.setAttribute('aria-label', on ? `${name} bound to ${s.bind.what}` : `${name} not bound to ${s.bind.what}`);
      return b;
    };
    // An eye before a row hides that part (a bone: its parts) on the stage; Alt-click shows only that one. Looking only: not saved.
    const eye = (name: string): HTMLElement => {
      const off = s.hidden.includes(name);
      const b = el('button', { type: 'button', className: 'as-eye', textContent: off ? '✕' : '●' });
      b.dataset.eye = name;
      b.title = off ? `${name} is hidden on the stage: click to show it` : `Hide ${name} on the stage (Alt-click: show only ${name}). Only for looking, not saved`;
      b.setAttribute('aria-label', `${name} shown on the stage`);
      b.setAttribute('role', 'checkbox');
      b.setAttribute('aria-checked', String(!off));
      return b;
    };
    const onBone = Object.fromEntries(Object.entries(partBones).map(([p, d]) => [p, d?.bone]));
    const hiddenSlots = new Set(o.parts.filter(p => p.kind === 'slot' && !p.file).map(p => p.name));

    // ---- the tree ----
    roots.tree.append(
      row(null, el('strong', { textContent: 'The whole character' }), keyed.length && s.anim?.def.keys.some(k => !k.part) ? el('span', { className: 'as-keyed', textContent: 'keyed' }) : ''),
      el('h4', { textContent: 'Parts' }),
    );
    if (s.hidden.length) {
      const all = el('button', { type: 'button', className: 'as-showall', title: 'Show every part on the stage again' }, `Show all (${s.hidden.length} hidden)`);
      all.dataset.showAll = '';
      roots.tree.append(all);
    }
    for (const p of o.parts) {
      const r = row(p.name, thumb(p.file), el('span', { className: 'as-pname', textContent: p.name }), badge(p.kind, p.kind === 'slot' ? 'A slot: shows one of its variants at a time (show mina slot=variant)' : 'A layer: one image, always drawn'), keys(p.name),
        p.kind === 'slot' && !p.file ? muted('hidden') : '');
      if (hiddenSlots.has(p.name)) { r.classList.add('as-hidden'); r.title = 'Nothing of this slot is shown in this look'; }
      if (s.hidden.includes(p.name)) r.classList.add('as-stagehidden');
      const t = tick(p.name);
      roots.tree.append(el('div', { className: 'as-item as-bindrow' }, eye(p.name), ...(t ? [t] : []), r));
    }
    // A mask shape is a part with no image: a row of its own, with no thumbnail, no eye and no keys (nothing of it is drawn or animated).
    if (shapeNames.length) {
      roots.tree.append(el('h4', { textContent: 'Shapes', title: 'Mask shapes: imageless parts that clip other parts (Mask section)' }));
      for (const name of shapeNames) {
        const bone = s.shapes[name].bone, clipped = Object.keys(s.clips).filter(p => s.clips[p] === name);
        const r = row(name, el('span', { className: 'as-thumb as-shape-icon', textContent: '◇', title: 'A mask shape' }), el('span', { className: 'as-pname', textContent: name }), badge('shape', 'A mask shape: an outline that clips other parts, with no image of its own'),
          muted(`${bone ? `on ${bone}` : 'on the character'}${clipped.length ? `, clips ${clipped.join(', ')}` : ''}`));
        r.title = `Mask shape ${name}${bone ? ` on bone ${bone}` : ''}${clipped.length ? `; clips ${clipped.join(', ')}` : '; clips nothing yet'}`;
        const t = s.bind?.kind === 'mask' ? tick(name) : null;
        roots.tree.append(el('div', { className: 'as-item as-bindrow as-shaperow' }, ...(t ? [t] : []), r));
      }
    }
    // Dragging a bone row onto another makes it that bone's child (Model mode); onto this heading, a top bone.
    const reparent = (name: string, parent: string | null) => {
      const next = setBoneParent(bones, name, parent);
      if (!next) { host.note(`${name} cannot hang from ${parent}: that would be a loop.`); return; }
      host.change({ bones: next });
    };
    const dropTarget = (target: HTMLElement, parent: string | null) => {
      target.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('text/x-bone')) { e.preventDefault(); target.classList.add('as-drop'); } });
      target.addEventListener('dragleave', () => target.classList.remove('as-drop'));
      target.addEventListener('drop', e => {
        target.classList.remove('as-drop');
        const dragged = e.dataTransfer?.getData('text/x-bone');
        if (!dragged) return;
        e.preventDefault();
        if (dragged !== parent) reparent(dragged, parent);
      });
    };
    const boneNames = boneRows(bones);
    if (boneNames.length || model) {
      const bonesHead = el('h4', { textContent: 'Bones', title: model ? 'Drop a bone here to make it a top bone' : '' });
      if (model) dropTarget(bonesHead, null);
      roots.tree.append(bonesHead);
    }
    for (const { name, depth } of boneNames) {
      const hidden = (() => { for (let c = bones[name]?.parent, i = 0; c !== undefined && i < 99; c = bones[c]?.parent, i++) if (this.collapsed.has(c)) return true; return false; })();
      if (hidden) continue;
      const hasKids = Object.values(bones).some(b => b?.parent === name);
      const item = el('div', { className: 'as-item as-bone' });
      item.style.marginLeft = `${depth * 12}px`;
      if (model) {
        item.draggable = true;
        item.title = 'Drag onto another bone to hang it from there';
        item.addEventListener('dragstart', e => { e.dataTransfer?.setData('text/x-bone', name); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
        dropTarget(item, name);
      }
      if (hasKids) {
        const shut = this.collapsed.has(name);
        const fold = el('button', { type: 'button', className: 'as-bone-fold', title: shut ? `Show the bones under ${name}` : `Hide the bones under ${name}` }, shut ? '▸' : '▾');
        fold.dataset.fold = name;
        fold.setAttribute('aria-expanded', String(!shut));
        fold.addEventListener('click', () => { if (shut) this.collapsed.delete(name); else this.collapsed.add(name); this.drawn = ''; this.show(); });
        item.append(fold);
      }
      const members = partsUnder(bones, onBone, name);
      const t = tick(name);
      item.append(eye(name));
      if (t) item.append(t);
      const r = row(name, el('span', { className: 'as-pname', textContent: name }), badge('bone', 'A bone: moves its parts, and the bones below it, as one piece'), keys(name));
      r.title = members.length ? `Moves ${members.join(', ')}` : 'No parts';
      if (members.length && members.every(m => hiddenSlots.has(m))) r.classList.add('as-hidden');
      if (s.hidden.includes(name)) r.classList.add('as-stagehidden');
      item.append(r);
      roots.tree.append(item);
    }
    if (model) {
      const add = el('button', { type: 'button', className: 'as-bone-new', title: 'A bone with no image, under the chosen bone (or at the top)' }, 'New bone');
      add.addEventListener('click', () => {
        const name = uniqueBoneName(bones, 'bone');
        const next = addBone(bones, name, host.selIsBone(s.part) ? s.part : null);
        if (next) host.change({ bones: next, part: name });
      });
      roots.tree.append(add);
    }

    // ---- the chosen row's details ----
    // A choice of bone for a part or a bone's parent: `none` stands for the top (no bone), `skip` lists bones that may not be chosen.
    const boneSelect = (label: string, prefix: string, value: string | null, skip: string[], pick: (bone: string | null) => void, name: string): HTMLLabelElement => {
      const sel = document.createElement('select');
      sel.className = 'as-bone-sel';
      sel.setAttribute('aria-label', label);
      sel.dataset.boneFor = name;
      sel.append(el('option', { value: '', textContent: '(none)' }), ...Object.keys(bones).filter(b => !skip.includes(b)).map(b => el('option', { value: b, textContent: b })));
      sel.value = value !== null && Object.hasOwn(bones, value) ? value : '';
      sel.addEventListener('change', () => pick(sel.value || null));
      return el('label', { className: 'as-bone-label', title: label }, `${prefix} `, sel);
    };
    const chosen = s.part;
    const part = chosen === null ? undefined : o.parts.find(p => p.name === chosen);
    if (chosen === null) {
      if (!model) roots.detail.append(el('p', { className: 'as-tree-hint', textContent: 'Keys here move the whole character. Choose a part or a bone in the tree, or click one on the stage, for its own lanes.' }));
    } else if (part) {
      if (model) roots.detail.append(boneSelect('Bone of ' + part.name, 'On bone', partBones[part.name]?.bone ?? null, [], b => host.change({ parts: setPartBone(partBones, part.name, b) }), part.name));
      if (part.kind === 'slot') {
        const chips = el('div', { className: 'as-variants', role: 'group' } as Partial<HTMLDivElement>);
        chips.setAttribute('aria-label', `Variants of ${part.name}`);
        for (const v of [...part.variants, { name: 'none', file: null, poses: [], isDefault: false }]) {
          const set = s.overrides[part.name] === v.name;
          const c = el('button', { type: 'button', className: 'as-variant', title: [
            v.name === 'none' ? 'Show nothing in this slot' : v.name,
            v.isDefault ? 'the default' : '',
            v.poses.length ? `picked by look ${v.poses.join(', ')}` : '',
            set ? 'set here: click again to go back to what the look picks' : '',
          ].filter(Boolean).join('; ') }, thumb(v.file), v.isDefault ? `${v.name}*` : v.name);
          c.dataset.slot = part.name;
          c.dataset.variant = v.name;
          c.setAttribute('aria-pressed', String(part.shown === v.name || (v.name === 'none' && !part.file)));
          if (set) c.classList.add('as-set');
          chips.append(c);
        }
        roots.detail.append(el('h4', { textContent: 'Variants' }), chips, el('p', { className: 'as-tree-hint', textContent: 'Click a variant to dress the stage (only for looking, not saved; * marks the default).' }));
      }
    } else if (Object.hasOwn(s.shapes, chosen) && model) {
      const bone = s.shapes[chosen].bone, clipped = Object.keys(s.clips).filter(p => s.clips[p] === chosen);
      roots.detail.append(el('p', { className: 'as-muted as-bone-parts', textContent: `A mask shape${bone ? ` on ${bone}` : ''}${clipped.length ? `: it clips ${clipped.join(', ')}` : ', clipping nothing yet'}. Edit it in the Mask section (Mask tool, M).` }));
    } else if (Object.hasOwn(bones, chosen)) {
      const kids = new Set<string>();
      for (const { name: b } of boneNames) { for (let c: string | undefined = bones[b]?.parent, i = 0; c !== undefined && i < 99; c = bones[c]?.parent, i++) if (c === chosen) kids.add(b); }
      const members = partsUnder(bones, onBone, chosen);
      roots.detail.append(el('p', { className: 'as-muted as-bone-parts', textContent: members.length ? `Moves ${members.join(', ')}` : 'No parts on this bone.' }));
      if (model) {
        roots.detail.append(boneSelect(`Parent of ${chosen}`, 'Under', bones[chosen]?.parent ?? null, [chosen, ...kids], parent => reparent(chosen, parent), chosen));
        const del = el('button', { type: 'button', className: 'as-bone-del', title: `Remove ${chosen}: what is on it goes to its parent` }, 'Remove bone');
        del.addEventListener('click', () => {
          const gone = deleteBone(bones, partBones, chosen);
          host.change({ bones: gone.bones, parts: gone.parts, part: null });
        });
        roots.detail.append(del);
      }
    }

    // ---- the look ----
    const look = document.createElement('select');
    look.className = 'as-look-sel';
    look.dataset.look = '';
    look.setAttribute('aria-label', `Look (show ${char} <look>)`);
    look.append(el('option', { value: '', textContent: '(default)', title: 'Every slot at its default variant' }),
      ...o.looks.map(p => {
        const picks = Object.entries(p.picks).map(([k, v]) => `${k} ${v}`).join(', ') || 'looks like the default';
        return el('option', { value: p.name, textContent: p.name, title: `${p.from === 'rig' ? 'A look in rig.json' : 'A look from the art: a name tagged on variants in the PSD'}: ${picks}` });
      }));
    look.value = s.pose !== null && o.looks.some(p => p.name === s.pose) ? s.pose : '';
    look.addEventListener('change', () => host.pickLook(look.value || null));
    roots.looks.append(el('label', { className: 'as-look' }, 'Look ', look));
    if (model) {
      const lookName = document.createElement('input');
      lookName.type = 'text';
      lookName.className = 'as-look-name';
      lookName.dataset.look = 'name';
      lookName.placeholder = 'look name';
      lookName.setAttribute('aria-label', 'Name of the new look');
      const saveBtn = el('button', { type: 'button', className: 'as-look-save', title: 'Save what the stage shows now (every slot, the looks and variants you picked) as a look in rig.json' }, 'Save as look');
      saveBtn.addEventListener('click', () => {
        const picks: Record<string, string | null> = {};
        for (const p of o.parts) if (p.kind === 'slot') picks[p.name] = p.shown;
        const name = lookName.value.trim();
        const next = saveLook(s.looks, name, picks);
        if (!next) { host.note(name ? 'This character has no slots to save.' : 'Give the look a name first.'); return; }
        host.change({ looks: next });
      });
      roots.looks.append(el('div', { className: 'as-look-save-row' }, lookName, saveBtn));
    }

    if (active) this.all().flatMap(r => [...r.querySelectorAll<HTMLElement>('button, select, input')]).find(b => JSON.stringify(b.dataset) === active)?.focus({ preventScroll: true });
    if (this.scrolledTo !== s.part) roots.tree.querySelector<HTMLElement>('.as-row[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
    this.scrolledTo = s.part;
  }
}
