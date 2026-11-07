// Monaco providers that work across files: label/variable rename (F2), references (Shift+F12), color swatches, and the
// Find in All Files entry point. They read the open models through state.ts, so they need nothing from editor.ts.

import { applyTextEdits, findColors, formatHex, labelAt, labelRefs, renameLabel, renameVariable, variableAt, variableUses, type LabelEdit, type ProjectFile } from '../engine/src/index.js';
import { files, projectFiles, S } from './state.js';

declare const monaco: any;

/** Apply engine edits to the open models, one undo step per file. */
export function applyEdits(edits: LabelEdit[]) {
  for (const f of files.values()) {
    const mine = edits.filter(e => e.file === f.name);
    if (!mine.length) continue;
    f.model.pushEditOperations([], mine.map(e => ({
      range: { startLineNumber: e.line, startColumn: e.col + 1, endLineNumber: e.line, endColumn: e.col + 1 + e.length }, text: e.text,
    })), () => null);
  }
}

export function registerRename() {
  const fileOf = (model: any) => [...files.values()].find(f => f.model === model);
  /** The label, else the variable, named at the cursor. */
  const target = (model: any, pos: { lineNumber: number; column: number }) => {
    const f = fileOf(model);
    if (!f || f.kind === 'rig') return undefined;
    return labelAt(projectFiles(), f.name, pos.lineNumber, pos.column - 1) ?? variableAt(projectFiles(), f.name, pos.lineNumber, pos.column - 1);
  };
  const provider = {
    resolveRenameLocation(model: any, pos: { lineNumber: number; column: number }) {
      const ref = target(model, pos);
      if (!ref) return { rejectReason: 'Put the cursor on a label or variable name to rename it', range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: '' };
      return { range: new monaco.Range(ref.line, ref.col + 1, ref.line, ref.col + 1 + ref.length), text: ref.name };
    },
    async provideRenameEdits(model: any, pos: { lineNumber: number; column: number }, newName: string) {
      const ref = target(model, pos);
      if (!ref) return { edits: [], rejectReason: 'Put the cursor on a label or variable name to rename it' };
      let locales: ProjectFile[] = [];
      if (!('kind' in ref)) {
        try { locales = Object.entries(await (await fetch('/api/locales')).json() as Record<string, string>).map(([name, text]) => ({ name, text })); } catch { /* no translations to keep in step */ }
      }
      const res = 'kind' in ref ? renameLabel(projectFiles(), ref.name, newName) : renameVariable([...projectFiles(), ...locales], ref, newName);
      if (!res.ok) return { edits: [], rejectReason: res.error };
      // The translation tables are not editor tabs: rewrite them on disk (no undo), the scripts go through the models. Monaco
      // tells a provider nothing about whether it applies the edits, so the tables wait until the first edited model has changed.
      const rewrites = locales.flatMap(l => {
        const mine = res.edits.filter(e => e.file === l.name);
        return mine.length ? [{ name: l.name, body: applyTextEdits(l.text, mine) }] : [];
      });
      const probe = res.edits.find(e => files.has(e.file));
      if (rewrites.length && probe) {
        const model = files.get(probe.file)!.model;
        const done = () => { sub.dispose(); clearTimeout(timer); };
        const sub = model.onDidChangeContent(() => {
          if (!model.getLineContent(probe.line).includes(probe.text)) return; // some other edit
          done();
          for (const w of rewrites) {
            void fetch(`/api/locale?file=${encodeURIComponent(w.name.replace(/^locale\//, ''))}`, { method: 'PUT', headers: { 'X-VN-Editor': '1', 'Content-Type': 'text/plain' }, body: w.body })
              .then(r => { if (!r.ok) console.warn(`could not rewrite ${w.name}: ${r.status}`); }, e => console.warn(`could not rewrite ${w.name}:`, e));
          }
        });
        const timer = setTimeout(done, 5000); // the rename was discarded
      }
      return {
        edits: res.edits.filter(e => files.has(e.file)).map(e => ({
          resource: files.get(e.file)!.model.uri, versionId: undefined,
          textEdit: { range: new monaco.Range(e.line, e.col + 1, e.line, e.col + 1 + e.length), text: e.text },
        })),
      };
    },
  };
  monaco.languages.registerRenameProvider('vn', provider);
  monaco.languages.registerRenameProvider('json', provider);
  // Shift+F12: every use of the label or variable under the cursor, the same set F2 would rename.
  const references = {
    provideReferences(model: any, pos: { lineNumber: number; column: number }) {
      const ref = target(model, pos);
      if (!ref) return [];
      const all = projectFiles();
      const uses = 'kind' in ref ? labelRefs(all).filter(r => r.name === ref.name) : variableUses(all, ref);
      return uses.filter(r => files.has(r.file)).map(r => ({
        uri: files.get(r.file)!.model.uri, range: new monaco.Range(r.line, r.col + 1, r.line, r.col + 1 + r.length),
      }));
    },
  };
  monaco.languages.registerReferenceProvider('vn', references);
  monaco.languages.registerReferenceProvider('json', references);
}

/** Color swatches and the picker for hex colors in scripts and game.json (`findColors` decides where one is valid). */
export function registerColors() {
  for (const lang of ['vn', 'json'] as const) {
    monaco.languages.registerColorProvider(lang, {
      provideDocumentColors(model: any) {
        return findColors(model.getValue(), lang).map(c => ({
          color: { red: c.r, green: c.g, blue: c.b, alpha: c.a },
          range: new monaco.Range(c.line, c.col + 1, c.line, c.col + 1 + c.length),
        }));
      },
      provideColorPresentations(_model: any, info: any) {
        const label = formatHex({ r: info.color.red, g: info.color.green, b: info.color.blue, a: info.color.alpha });
        return [{ label, textEdit: { range: info.range, text: label } }];
      },
    });
  }
}

export function openFind() {
  const sel = S.editor.getSelection(), model = S.editor.getModel();
  const word = model && sel?.isEmpty() ? model.getWordAtPosition(sel.getPosition())?.word : undefined;
  S.findDialog.open(sel && model && !sel.isEmpty() ? model.getValueInRange(sel) : word ?? '');
}
