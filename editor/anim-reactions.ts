// The Reactions tab (of the rig strip under the stage, Model mode): rig.json `reactions`, the poses the character holds while a condition is true (condition, pose,
// seconds and ease of the move into it; add, remove, reorder: the first entry that holds wins), and the studio-only Test variables
// that stand in for the story's variables so a condition can be seen to hold. See docs/design/auto-animations.md.
import { DEFAULT_REACTION_OVER, EASE_NAMES, parseCondition, parseVarValue, type ReactionDef, type Value } from '../engine/src/index.js';
import { el, layoutRows } from './anim-dom.js';

export interface ReactionHost {
  reactions(): ReactionDef[];
  /** The names of the rig's poses. */
  poses(): string[];
  editable(): boolean;
  note(text: string): void;
  /** Replace the list (one undo step). */
  setReactions(list: ReactionDef[]): void;
  /** The studio-only test variables, and a way to change them (not saved, not in the undo history). */
  vars(): Record<string, Value>;
  setVars(vars: Record<string, Value>): void;
}

/** A text or number field with the given attributes. */
function field(attrs: Record<string, string>, value: string): HTMLInputElement {
  const i = document.createElement('input');
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  i.spellcheck = false;
  i.value = value;
  return i;
}

/** A drop-down of `names` (`first` is an extra leading choice with an empty value). */
function choice(className: string, names: string[], first?: string): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = className;
  if (first !== undefined) sel.add(new Option(first, ''));
  for (const n of names) sel.add(new Option(n, n));
  return sel;
}

const show = (v: Value): string => (Array.isArray(v) ? JSON.stringify(v) : typeof v === 'string' ? JSON.stringify(v) : String(v));

export class ReactionPanel {
  private list: HTMLElement;
  private vars: HTMLElement;

  constructor(private root: HTMLElement, private host: ReactionHost) {
    this.root.innerHTML = `
      <div class="as-auto"><span class="as-pivot-name">Reactions</span>
        <button type="button" class="ar-add" title="Add a reaction: a pose held while a condition is true">Add reaction</button>
        <span class="as-pivot-hint">The first one whose condition holds wins. The condition is written like an <b>if</b>: story variables, speaking, always, param.&lt;id&gt;.</span></div>
      <div class="ar-list"></div>
      <div class="as-auto"><span class="as-pivot-name">Test variables</span>
        <button type="button" class="ar-addvar" title="Give a story variable a value for this preview only">Add variable</button>
        <span class="as-pivot-hint">Only here, never saved: the studio has no story, so conditions that name a variable use these.</span></div>
      <div class="ar-vars"></div>`;
    layoutRows(this.root);
    this.list = this.root.querySelector('.ar-list')!;
    this.vars = this.root.querySelector('.ar-vars')!;
    this.root.querySelector('.ar-add')!.addEventListener('click', () => {
      const pose = this.host.poses()[0];
      if (!pose) { this.host.note('Save a pose first (Poses), then bind a condition to it here.'); return; }
      this.host.setReactions([...this.host.reactions(), { when: 'speaking', pose }]);
    });
    this.root.querySelector('.ar-addvar')!.addEventListener('click', () => {
      let n = 1;
      while (`var${n}` in this.host.vars()) n++;
      this.host.setVars({ ...this.host.vars(), [`var${n}`]: 0 });
    });
  }

  /** What the section shows beside its title. */
  static summary(list: readonly ReactionDef[]): string {
    return list.length ? `${list.length} reaction${list.length === 1 ? '' : 's'}` : 'none';
  }

  sync() {
    const reactions = this.host.reactions(), poses = this.host.poses(), can = this.host.editable();
    const change = (i: number, patch: Partial<ReactionDef> | null) => {
      const next = reactions.map(r => ({ ...r }));
      if (patch === null) next.splice(i, 1);
      else {
        next[i] = { ...next[i], ...patch };
        for (const k of ['over', 'ease'] as const) if (next[i][k] === undefined) delete next[i][k];
      }
      this.host.setReactions(next);
    };
    const move = (i: number, by: number) => {
      const next = reactions.slice(), [r] = next.splice(i, 1);
      next.splice(i + by, 0, r);
      this.host.setReactions(next);
    };
    this.list.replaceChildren(...reactions.map((r, i) => {
      const when = field({ type: 'text', size: '26', class: 'ar-when', autocomplete: 'off' }, r.when);
      when.setAttribute('aria-label', `Condition of reaction ${i + 1}`);
      when.addEventListener('change', () => {
        const text = when.value.trim();
        if (!text || !parseCondition(text)) { this.host.note(`"${when.value}" is not a valid condition (an expression such as affection >= 5 or speaking).`); when.value = r.when; return; }
        change(i, { when: text });
      });
      const pose = choice('ar-pose', poses.includes(r.pose) ? poses : [...poses, r.pose]);
      pose.value = r.pose;
      pose.setAttribute('aria-label', `Pose of reaction ${i + 1}`);
      pose.addEventListener('change', () => change(i, { pose: pose.value }));
      const over = field({ type: 'number', min: '0', step: '0.1', size: '4', class: 'ar-over', placeholder: String(DEFAULT_REACTION_OVER) }, r.over === undefined ? '' : String(r.over));
      over.setAttribute('aria-label', `Seconds the move into the pose of reaction ${i + 1} takes`);
      over.addEventListener('change', () => { const n = Number(over.value); change(i, { over: over.value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined }); });
      const ease = choice('ar-ease', [...EASE_NAMES], '(default)');
      ease.value = r.ease ?? '';
      ease.setAttribute('aria-label', `Ease of the move of reaction ${i + 1}`);
      ease.addEventListener('change', () => change(i, { ease: ease.value || undefined }));
      const btn = (text: string, label: string, run: () => void, off = false) => {
        const b = el('button', { type: 'button', textContent: text, title: label, disabled: off || !can }) as HTMLButtonElement;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', run);
        return b;
      };
      return el('div', { className: 'as-auto' },
        el('label', {}, 'When ', when), el('label', {}, 'hold ', pose), el('label', {}, 'over ', over, ' s'), el('label', {}, 'ease ', ease),
        btn('↑', `Move reaction ${i + 1} earlier`, () => move(i, -1), i === 0), btn('↓', `Move reaction ${i + 1} later`, () => move(i, 1), i === reactions.length - 1),
        btn('✕', `Delete reaction ${i + 1}`, () => change(i, null)));
    }));

    const vars = this.host.vars();
    this.vars.replaceChildren(...Object.entries(vars).map(([name, value]) => {
      const n = field({ type: 'text', size: '12', autocomplete: 'off' }, name);
      n.setAttribute('aria-label', 'Variable name');
      const v = field({ type: 'text', size: '10', autocomplete: 'off' }, show(value));
      v.setAttribute('aria-label', `Value of ${name}`);
      const set = () => {
        const next: Record<string, Value> = {};
        for (const [k, x] of Object.entries(vars)) if (k !== name) next[k] = x;
        const key = n.value.trim();
        if (key) next[key] = parseVarValue(v.value);
        this.host.setVars(next);
      };
      n.addEventListener('change', set);
      v.addEventListener('change', set);
      const del = el('button', { type: 'button', textContent: '✕', title: 'Remove this test variable' }) as HTMLButtonElement;
      del.setAttribute('aria-label', `Remove test variable ${name}`);
      del.addEventListener('click', () => { const next = { ...vars }; delete next[name]; this.host.setVars(next); });
      return el('div', { className: 'as-auto' }, el('label', {}, n, ' = ', v), del);
    }));
  }
}
