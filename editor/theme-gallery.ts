// Screen gallery of the theme panel: small live renderings of the text box, choices, title, pause, options, saves, the
// confirm dialog, history, chapters and a toast. Each tile is an iframe holding a copy of the preview page's own stage
// (its stylesheet and screen markup, fetched from `../`) filled with fixed sample data, so nothing needs the game to be
// played and the tiles cannot drift from the real screens. An edit swaps the generated theme stylesheet in every tile.
// Clicking an element in a tile reports the component (and state) that styles it.

import { UI_COMPONENTS } from '../engine/src/index.js';

interface Source { css: string; stage: HTMLElement }

export interface Inspect { key: string; state: string }

const STAGE_W = 1920;
const STAGE_H = 1080;
const TILE_W = 340;

const TILES: { id: string; label: string; fill(s: HTMLElement): void }[] = [
  { id: 'textbox', label: 'Text box', fill(s) {
    set(s, '#box', e => { e.dataset.visible = 'true'; e.dataset.done = 'true'; });
    set(s, '#name', e => { e.textContent = 'Alice'; });
    set(s, '#text', e => { e.textContent = 'The rain had stopped by the time we reached the park.'; });
  } },
  { id: 'choices', label: 'Choices', fill(s) {
    set(s, '#menu', e => {
      e.dataset.visible = 'true';
      e.innerHTML = '<div class="prompt">What now?</div><button type="button">Follow her</button><button type="button" data-seen="true">Stay here</button>'
        + '<button type="button" aria-disabled="true">Go home</button>';
    });
  } },
  { id: 'title', label: 'Title', fill(s) {
    show(s, 'title');
    mockScreen(s, 'titleui', [{ text: 'Sample Game', y: 60, font: 100 }, ...['New game', 'Continue', 'Load', 'Options'].map((label, i) => ({ label, y: 330 + i * 96 }))]);
  } },
  { id: 'pause', label: 'Pause', fill(s) {
    show(s, 'pause');
    mockScreen(s, 'pauseui', ['Resume', 'Save', 'Load', 'Options', 'Main menu'].map((label, i) => ({ label, y: 300 + i * 96 })));
  } },
  { id: 'options', label: 'Options', fill(s) {
    show(s, 'options');
    mockScreen(s, 'optionsui', [{ text: 'Options', y: 120, font: 52 }, ...['Audio', 'Game', 'Accessibility'].map((label, i) => ({ label, y: 210 + i * 96, tab: i === 0 })), { label: 'Back', y: 520 }]);
  } },
  { id: 'saves', label: 'Saves', fill(s) {
    show(s, 'saves');
    mockScreen(s, 'savesui', [{ text: 'Save', y: 60, font: 52 }, ...['Slot 1', 'Slot 2', 'Slot 3'].map((label, i) => ({ label, y: 200 + i * 110 })), { label: 'Back', y: 540 }]);
  } },
  { id: 'confirm', label: 'Confirm dialog', fill(s) {
    show(s, 'confirm');
    set(s, '#confirmText', e => { e.textContent = 'Delete this save?'; });
    set(s, '#confirmYes', e => { e.dataset.variant = 'danger'; });
  } },
  { id: 'history', label: 'History', fill(s) {
    show(s, 'history');
    mockScreen(s, 'historyui', [{ text: 'History', y: 50, font: 52 }, ...['Alice: Did you bring the umbrella?', 'The park was empty.', 'Bob: It stopped raining.'].map((label, i) => ({ label, y: 200 + i * 110 }))]);
  } },
  { id: 'chapters', label: 'Chapters', fill(s) {
    show(s, 'chapters');
    mockScreen(s, 'chaptersui', [{ text: 'Chapters', y: 50, font: 52 }, ...['1. The park', '2. The bridge', '???'].map((label, i) => ({ label, y: 200 + i * 110 }))]);
  } },
  { id: 'quickmenu', label: 'Quick menu', fill(s) {
    set(s, '#box', e => { e.dataset.visible = 'true'; e.dataset.done = 'true'; });
    set(s, '#text', e => { e.textContent = 'The rain had stopped by the time we reached the park.'; });
    set(s, '#quickui', e => {
      e.dataset.visible = 'true';
      e.innerHTML = '<div>' + ['Save', 'Load', 'Auto', 'Skip', 'History'].map((label, i) =>
        `<button type="button" class="sc-btn"${label === 'Auto' ? ' aria-pressed="true"' : ''} style="left:${480 + i * 190}px;top:1000px;width:170px;height:54px;font-size:24px">${label}</button>`).join('') + '</div>';
    });
  } },
  { id: 'hotspot', label: 'Hotspot and tooltip', fill(s) {
    set(s, '#hudui', e => {
      e.dataset.visible = 'true';
      e.innerHTML = '<div><button type="button" class="sc-hot" data-active="true" style="left:560px;top:300px;width:420px;height:360px"></button>'
        + '<button type="button" class="sc-hot" style="left:1100px;top:380px;width:300px;height:280px"></button>'
        + '<div class="sc-tip" data-show="true" style="left:620px;top:690px">Old bridge</div></div>';
    });
  } },
  { id: 'hud', label: 'HUD', fill(s) {
    set(s, '#hudui', e => {
      e.dataset.visible = 'true';
      e.innerHTML = '<div><div class="sc-text" style="left:80px;top:60px">Day 3 · Trust 42</div>'
        + '<button type="button" class="sc-btn" style="left:1560px;top:60px;width:280px;height:96px">Journal</button>'
        + '<button type="button" class="sc-btn" data-on="false" style="left:1560px;top:180px;width:280px;height:96px">Map</button></div>';
    });
  } },
  { id: 'toast', label: 'Toast', fill(s) { set(s, '#toast', e => { e.dataset.show = 'true'; e.textContent = 'Game saved'; }); } },
];

function set(root: HTMLElement, selector: string, fn: (e: HTMLElement) => void) {
  const e = root.querySelector<HTMLElement>(selector);
  if (e) fn(e);
}
/** The starter title and pause screens are drawn by script at run time; a tile gets a still of the same kinds of elements (centered buttons, a heading) in their layer. */
function mockScreen(root: HTMLElement, layer: string, parts: { label?: string; text?: string; y: number; font?: number; tab?: boolean }[]) {
  set(root, `#${layer}`, layerEl => {
    layerEl.dataset.visible = 'true';
    layerEl.replaceChildren(...parts.map(p => {
      const e = document.createElement(p.text ? 'div' : 'button');
      e.className = p.text ? 'sc-text' : 'sc-btn';
      e.textContent = p.text ?? p.label ?? '';
      const w = p.text ? STAGE_W : 288;
      e.style.left = `${(STAGE_W - w) / 2}px`; e.style.top = `${p.y}px`; e.style.width = `${w}px`;
      if (p.tab !== undefined) { e.setAttribute('role', 'tab'); e.setAttribute('aria-selected', String(p.tab)); }
      if (p.text) { e.style.textAlign = 'center'; if (p.font) e.style.fontSize = `${p.font}px`; } else e.style.height = '84px';
      return e;
    }));
  });
}
function show(root: HTMLElement, id: string) {
  set(root, `#${id}`, e => { e.hidden = false; });
}

/** Extra parts that are themed but not a menu component: element selector -> component key. Checked after the menu components. */
const EXTRA: [string, string][] = [['#name', 'namebox'], ['#text', 'text'], ['#box', 'textbox'], ['#menu button', 'choice'], ['.sc-hot', 'hotspot'], ['.sc-tip', 'tooltip']];

/** The component (and state) that styles `el` in a tile's document; null if nothing themed is under it. */
export function inspectElement(el: Element): Inspect | null {
  for (let e: Element | null = el; e && e.id !== 'stage'; e = e.parentElement) {
    // Several components can match one element (a tab is also a button); the longest matching selector is the most specific.
    let best: (Inspect & { len: number }) | null = null;
    const consider = (key: string, state: string, selectors: string[]) => {
      for (const s of selectors) if (e!.matches(s) && (!best || s.length > best.len)) best = { key, state, len: s.length };
    };
    for (const [base, def] of Object.entries(UI_COMPONENTS)) {
      const parts = def.selector.split(',').map(s => s.trim());
      consider(base, def.selected && e.matches(parts.map(s => s + def.selected).join(', ')) ? 'selected' : '', parts);
      for (const [variant, suffix] of Object.entries(def.variants ?? {})) consider(`${base}.${variant}`, '', parts.map(s => s + suffix));
    }
    for (const [selector, key] of EXTRA) consider(key, '', [selector]);
    if (best) return { key: (best as Inspect).key, state: (best as Inspect).state };
  }
  return null;
}

export class ThemeGallery {
  readonly element: HTMLDivElement;
  private source: Source | null | undefined;
  private frames = new Map<string, HTMLIFrameElement>();
  private css = '';
  private size = { width: STAGE_W, height: STAGE_H };

  constructor(private readonly onInspect: (i: Inspect) => void) {
    this.element = document.createElement('div');
    this.element.className = 'td-gallery';
    this.element.setAttribute('aria-label', 'Screens');
  }

  /** Show the tiles with this theme stylesheet (`themeCss` of the theme being edited). Building happens on the first call. */
  async update(css: string, size: { width: number; height: number } = { width: STAGE_W, height: STAGE_H }) {
    this.css = css;
    if (this.source === undefined) this.source = await load();
    if (!this.source) { this.element.textContent = 'The screens could not be loaded from the preview.'; return; }
    if (this.frames.size === 0 || size.width !== this.size.width || size.height !== this.size.height) {
      this.size = size;
      this.frames.clear();
      this.build(this.source);
    }
    for (const f of this.frames.values()) this.apply(f);
  }

  private apply(frame: HTMLIFrameElement) {
    const style = frame.contentDocument?.getElementById('themeStyle');
    if (style && style.textContent !== this.css) style.textContent = this.css;
  }

  private build(src: Source) {
    this.element.replaceChildren();
    for (const tile of TILES) {
      const stage = src.stage.cloneNode(true) as HTMLElement;
      stage.querySelectorAll('script, canvas').forEach(n => n.remove());
      tile.fill(stage);
      const figure = document.createElement('figure');
      const frame = document.createElement('iframe');
      frame.title = tile.label;
      frame.tabIndex = -1;
      frame.style.width = `${TILE_W}px`;
      const scale = TILE_W / this.size.width;
      frame.style.height = `${Math.round(this.size.height * scale)}px`;
      frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base href="${new URL('../', location.href).href}">`
        + `<style>${src.css}</style><style id="themeStyle">${this.css}</style>`
        + '<style>html, body { margin: 0; overflow: hidden; background: #000; } #stage { left: 0 !important; top: 0 !important; translate: none; '
        + `width: ${this.size.width}px; height: ${this.size.height}px; transform: scale(${scale}) !important; transform-origin: 0 0 !important; }`
        + ' .screen { animation: none !important; } #toast { transition: none !important; }</style>'
        + `</head><body>${stage.outerHTML.replace(/<\/script/gi, '<\\/script')}</body></html>`;
      frame.addEventListener('load', () => {
        this.apply(frame);
        frame.contentDocument?.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const hit = inspectElement(e.target as Element);
          if (hit) this.onInspect(hit);
        }, true);
      });
      const caption = document.createElement('figcaption');
      caption.textContent = tile.label;
      figure.append(frame, caption);
      this.element.append(figure);
      this.frames.set(tile.id, frame);
    }
  }
}

async function load(): Promise<Source | null> {
  try {
    const res = await fetch('../');
    if (!res.ok) return null;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const stage = doc.getElementById('stage');
    if (!stage) return null;
    return { css: [...doc.querySelectorAll('style')].map(s => s.textContent ?? '').join('\n'), stage: stage as HTMLElement };
  } catch {
    return null;
  }
}
