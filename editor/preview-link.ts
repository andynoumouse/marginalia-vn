// The link to the live preview: the highlighted line the story is on (and following it), jumps from the preview's error
// banner, the variables panel, and the Play-from-here commands. editor.ts hands over what these call back into (initPreviewLink).

import { parseVarValue } from '../engine/src/index.js';
import { showPreviewPane } from './preview-pane.js';
import { $, files, S, setStatus, type FileState } from './state.js';

declare const monaco: any;

const preview = () => $<HTMLIFrameElement>('preview');
const followEl = () => $<HTMLInputElement>('follow');
let host: { activate(name: string): void; goToLine(name: string, line: number): void; save(f: FileState): Promise<void> };

/** Messages from the preview iframe only. */
const listen = (fn: (e: MessageEvent) => void) => window.addEventListener('message', e => {
  if (e.origin === location.origin && e.source === preview().contentWindow) fn(e);
});

export function showPreviewLine() {
  S.decorations?.clear();
  if (!S.previewPos || S.previewPos.file !== S.active) return;
  const { line } = S.previewPos;
  S.decorations.set([{
    range: new monaco.Range(line, 1, line, 1),
    options: { isWholeLine: true, className: 'vn-preview-line', linesDecorationsClassName: 'vn-preview-gutter' },
  }]);
  if (followEl().checked) S.editor.revealLineInCenterIfOutsideViewport(line);
}

listen(e => {
  const m = e.data as { type?: string; file?: string; line?: number } | null;
  if (m?.type !== 'position' || typeof m.file !== 'string' || typeof m.line !== 'number') return;
  // Follow only when the story moves: a hot reload reports the same position again, and must not pull
  // you away from the file you are editing. Following never leaves game.json either.
  const moved = S.previewPos?.file !== m.file || S.previewPos.line !== m.line;
  S.previewPos = { file: m.file, line: m.line };
  if (followEl().checked && moved && m.file !== S.active && files.has(m.file) && files.get(S.active)?.kind === 'script') host.activate(m.file);
  else showPreviewLine();
});

// The preview's error banner asks to jump to the line of a problem.
listen(e => {
  const m = e.data as { type?: string; file?: string; line?: number } | null;
  if (m?.type !== 'showLine' || typeof m.file !== 'string' || typeof m.line !== 'number' || !files.has(m.file)) return;
  if (m.file !== S.active) host.activate(m.file);
  const line = Math.min(Math.max(m.line, 1), files.get(m.file)!.model.getLineCount());
  S.editor.setPosition({ lineNumber: line, column: 1 });
  S.editor.revealLineInCenter(line);
  S.editor.focus();
});

// Live story variables, sent by the preview with every line; values that just changed are highlighted.
const varsEl = $('vars'), varsList = $('varsList');
let lastVars: Record<string, unknown> = {};
function showVars(vars: Record<string, unknown>) {
  const names = Object.keys(vars).sort();
  varsList.replaceChildren(...(names.length ? names.flatMap(n => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = n;
    dd.textContent = typeof vars[n] === 'string' || Array.isArray(vars[n]) ? JSON.stringify(vars[n]) : String(vars[n]);
    if (!n.includes('.') || n.startsWith('persistent.')) { // unlocked.<flag> entries are read-only
      dd.title = 'Double-click to edit (true/false, a number, text, or a list like ["a", "b"])';
      dd.addEventListener('dblclick', () => editVar(n, dd));
    }
    if (n in lastVars && JSON.stringify(lastVars[n]) !== JSON.stringify(vars[n]) || !(n in lastVars) && Object.keys(lastVars).length) dd.className = 'changed';
    return [dt, dd];
  }) : [Object.assign(document.createElement('div'), { className: 'none', textContent: 'No variables set yet.' })]));
  lastVars = vars;
}
function editVar(name: string, dd: HTMLElement) {
  const input = document.createElement('input');
  input.value = dd.textContent ?? '';
  input.className = 'varEdit';
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    if (commit) preview().contentWindow?.postMessage({ type: 'setVar', name, value: parseVarValue(input.value) }, location.origin);
    else showVars(lastVars);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(false));
  dd.replaceChildren(input);
  input.focus();
  input.select();
}
listen(e => {
  const m = e.data as { type?: string; vars?:Record<string, unknown>; file?: string; line?: number } | null;
  if (m?.type === 'goto-error' && typeof m.file === 'string' && typeof m.line === 'number') host.goToLine(m.file, m.line);
  else if (m?.type === 'vars' && m.vars && !varsEl.hidden) showVars(m.vars);
  else if (m?.type === 'vars' && m.vars) lastVars = m.vars;
});

function previewTitle() {
  preview().contentWindow?.postMessage({ type: 'title' }, location.origin);
}

export function previewScreen(name: string) {
  showPreviewPane();
  preview().contentWindow?.postMessage({ type: 'screen', name }, location.origin);
}

export async function previewFromCursor() {
  const f = files.get(S.active);
  if (!f) return;
  showPreviewPane();
  clearTimeout(f.timer);
  await host.save(f);
  if (f.kind !== 'script') { previewTitle(); return; }
  const pos = S.editor.getPosition();
  preview().contentWindow?.postMessage({ type: 'goto', file: S.active, line: pos.lineNumber }, location.origin);
}

export function toggleFollow() {
  followEl().checked = !followEl().checked;
  showPreviewLine();
  setStatus(`follow preview ${followEl().checked ? 'on' : 'off'}`);
}

export function toggleVars() {
  varsEl.hidden = !varsEl.hidden;
  if (!varsEl.hidden) showVars(lastVars);
}

export function initPreviewLink(h: typeof host) {
  host = h;
  $('varsBtn').addEventListener('click', toggleVars);
  $('varsClose').addEventListener('click', () => { varsEl.hidden = true; });
  followEl().addEventListener('change', showPreviewLine);
}
