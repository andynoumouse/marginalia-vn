// The test bench of the docking layer (dock-sandbox.html): five dummy panels in three zones, the layout kept in localStorage.
// `window.vnDock` exposes the dock for the browser test.
import { defaultDock, isDefaultDock, readDock, writeDock, type DockSpec } from '../engine/src/dock.js';
import { mountDock } from './dock-ui.js';

const spec: DockSpec = {
  zones: ['left', 'center', 'right'],
  panels: [
    { id: 'tree', zone: 'left' }, { id: 'params', zone: 'left' },
    { id: 'stage', zone: 'center', zones: ['center'] },
    { id: 'sel', zone: 'right' }, { id: 'warp', zone: 'right', zones: ['left', 'right'] },
  ],
};
const KEY = 'vn-dock-sandbox';
const stored = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();

const panels: Record<string, HTMLElement> = {};
for (const p of spec.panels) {
  const el = document.createElement('section');
  el.className = 'panel';
  el.id = `p-${p.id}`;
  el.innerHTML = `<h2>${p.id}</h2><div class="body">${p.id === 'stage' ? 'A panel that may only be in the center.' : `Panel ${p.id}.`}</div>`;
  if (p.id === 'stage') el.style.minHeight = '200px';
  panels[p.id] = el;
}

const dock = mountDock({
  spec,
  zones: { left: document.getElementById('z-left')!, center: document.getElementById('z-center')!, right: document.getElementById('z-right')! },
  panels,
  handle: (_id, el) => el.querySelector('h2'),
  layout: readDock(spec, stored),
  onChange: layout => { try { localStorage.setItem(KEY, writeDock(layout)); } catch { /* private mode */ } },
});

let warpShown = true;
document.getElementById('reset')!.addEventListener('click', () => {
  dock.setLayout(defaultDock(spec));
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
});
document.getElementById('hide')!.addEventListener('click', () => {
  warpShown = !warpShown;
  dock.setPresent(warpShown ? null : spec.panels.map(p => p.id).filter(id => id !== 'warp'));
});

(window as unknown as { vnDock: unknown }).vnDock = { get layout() { return dock.layout; }, isDefault: () => isDefaultDock(spec, dock.layout) };
