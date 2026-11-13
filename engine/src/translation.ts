import type { Program } from './types.js';
import type { StringTable } from './locale.js';

/**
 * The strings of a compiled script with the context a translator needs (where it is said, by whom), and how far each
 * language table has got. Pure: the editor's Translations dialog and the CSV export both draw on it.
 */

export type StringKind = 'say' | 'choice' | 'reason' | 'prompt' | 'input' | 'ending' | 'other' | 'label';

export interface StringRow {
  id: string;
  source: string;
  kind: StringKind;
  /** The speaking character (say lines only). */
  who: string | null;
  /** Where the string is in the script; absent for menu labels (and for screen and item strings of a program without `stringSrc`). */
  file?: string;
  line?: number;
  /** The label the string sits under. */
  label?: string;
}

/** Every string of `program` in script order (strings outside the op stream, such as screen texts, come last). */
export function stringRows(program: Pick<Program, 'ops' | 'labels' | 'strings' | 'stringSrc'>): StringRow[] {
  const starts = Object.entries(program.labels).sort((a, b) => a[1] - b[1]);
  const rows: StringRow[] = [];
  const seen = new Set<string>();
  let li = -1;
  const add = (id: string | null, kind: StringKind, who: string | null, file: string, line: number, label?: string) => {
    if (!id || seen.has(id) || !(id in program.strings)) return;
    seen.add(id);
    rows.push({ id, source: program.strings[id], kind, who, file, line, ...(label ? { label } : {}) });
  };
  program.ops.forEach((op, pc) => {
    while (li + 1 < starts.length && starts[li + 1][1] <= pc) li++;
    const label = li >= 0 ? starts[li][0] : undefined;
    const { file, line } = op.src;
    if (op.op === 'say') add(op.id, 'say', op.who, file, line, label);
    else if (op.op === 'input') add(op.id, 'input', null, file, line, label);
    else if (op.op === 'end') add(op.id ?? null, 'ending', null, file, line, label);
    else if (op.op === 'menu') {
      add(op.promptId, 'prompt', null, file, line, label);
      for (const o of op.options) {
        add(o.id, 'choice', null, file, o.from, label);
        add(o.reasonId, 'reason', null, file, o.from, label);
      }
    }
  });
  for (const id of Object.keys(program.strings)) {
    if (seen.has(id)) continue;
    const at = program.stringSrc?.[id];
    rows.push({ id, source: program.strings[id], kind: 'other', who: null, ...(at ? { file: at.file, line: at.line } : {}) });
  }
  return rows;
}

/**
 * The built-in menu labels as translation rows (`ui.<key>`, the entries the player's menus read from the locale table). `defaults` are the
 * texts the game's page ships by key (its `data-ui` elements); game.json `labels` replace them in the source language. Sorted by key.
 */
export function uiLabelRows(defaults: Record<string, string>, labels: Record<string, string> = {}): StringRow[] {
  return Object.keys(defaults).sort().map(key => ({ id: `ui.${key}`, source: labels[key] || defaults[key], kind: 'label' as const, who: null }));
}

export interface TranslationStatus {
  total: number;
  translated: number;
  /** Ids of rows with no (or an empty) entry in the table. */
  missing: string[];
  /** Table ids that match no string of the script (`ui.*` menu labels are not strings of the script and never count). */
  unused: string[];
}

export function translationStatus(rows: Pick<StringRow, 'id'>[], table: StringTable): TranslationStatus {
  const ids = new Set(rows.map(r => r.id));
  const missing = rows.filter(r => !table[r.id]).map(r => r.id);
  return {
    total: rows.length,
    translated: rows.length - missing.length,
    missing,
    unused: Object.keys(table).filter(id => !ids.has(id) && !id.startsWith('ui.')),
  };
}

/** The table and its source snapshot without the entries that match no string (`unused` above); the inputs are left alone. */
export function dropUnused(rows: Pick<StringRow, 'id'>[], table: StringTable, snapshot: SourceSnapshot = {}): { table: StringTable; snapshot: SourceSnapshot; removed: string[] } {
  const removed = new Set(translationStatus(rows, table).unused);
  const keep = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([id]) => !removed.has(id)));
  return { table: keep(table), snapshot: keep(snapshot), removed: [...removed] };
}

/**
 * The source text each translation was made against, by id (`locale/<lang>.src`, next to the table; the game never loads it).
 * A translation whose id now has different source text is outdated: the line was reworded after it was translated.
 */
export type SourceSnapshot = Record<string, string>;

/** Ids with a translation whose source text has changed since the snapshot (translations without a snapshot entry, such as ones written outside the editor, are not judged). */
export function outdatedIds(rows: Pick<StringRow, 'id' | 'source'>[], table: StringTable, snapshot: SourceSnapshot): string[] {
  return rows.filter(r => table[r.id] && r.id in snapshot && snapshot[r.id] !== r.source).map(r => r.id);
}

export const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** One row per string for translators: id, where it is, who says it, the source text, then a column per language. */
export function translatorCsv(rows: StringRow[], tables: Record<string, StringTable>, langs: string[], snapshots: Record<string, SourceSnapshot> = {}): string {
  // A language with a snapshot gets a second column: the old source text of translations that are now outdated.
  const head = ['id', 'file', 'line', 'label', 'kind', 'speaker', 'source', ...langs.flatMap(l => (snapshots[l] ? [l, `${l} previous source`] : [l]))];
  const lines = rows.map(r => [r.id, r.file ?? '', r.line === undefined ? '' : String(r.line), r.label ?? '', r.kind, r.who ?? '', r.source,
    ...langs.flatMap(l => {
      const cell = tables[l]?.[r.id] ?? '';
      if (!snapshots[l]) return [cell];
      return [cell, outdatedIds([r], tables[l] ?? {}, snapshots[l]).length ? snapshots[l][r.id] : ''];
    })]);
  return [head, ...lines].map(cells => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * The cells of a CSV file (RFC 4180: quoted cells may hold commas, quotes and line breaks). A byte-order mark is dropped, and the
 * delimiter is the header line's comma, semicolon or tab, whichever appears (spreadsheets in some locales save with semicolons).
 */
export function parseCsv(text: string): string[][] {
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  const head = text.slice(0, text.search(/\r?\n|$/));
  const sep = head.includes(',') ? ',' : head.includes(';') ? ';' : head.includes('\t') ? '\t' : ',';
  const out: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') quoted = false; else cell += c;
      i++;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\r' || c === '\n') {
      row.push(cell); out.push(row); row = []; cell = '';
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else cell += c;
    i++;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.filter(r => r.some(c => c !== ''));
}

/** The columns of `translatorCsv` that are context, not a language. */
const CONTEXT_COLUMNS = new Set(['id', 'file', 'line', 'label', 'kind', 'speaker', 'source']);
const LANG_CODE = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]+)?$/;

export interface CsvImportLanguage {
  lang: string;
  /** The table with the sheet's translations merged in (a copy; entries the sheet leaves empty are kept). */
  table: StringTable;
  /** The source snapshot to go with it: each imported translation records the source text the sheet showed the translator. */
  snapshot: SourceSnapshot;
  /** Ids that had no translation before. */
  added: string[];
  /** Ids whose translation the sheet replaces. */
  changed: string[];
  /** Imported ids whose sheet source differs from the script's: the line was reworded after the sheet was exported. */
  outdated: string[];
  /** The language has no table yet. */
  isNew: boolean;
}

export interface CsvImport {
  languages: CsvImportLanguage[];
  /** Ids in the sheet that match no string (with a translation in some language column), in sheet order. */
  unknown: string[];
  /** Header cells that are neither context nor a language code (or are the source language), left alone. */
  ignored: string[];
  /** Why nothing could be read (no `id` column, no language column); the rest is empty then. */
  error?: string;
}

/**
 * Reads a translators' sheet back (the `translatorCsv` layout, or any sheet with an `id` column and a column per language code): what
 * it would change in each language's table, without changing the inputs. An empty cell keeps the current translation, so a partly
 * filled sheet removes nothing; `<lang> previous source` columns are only for reading and are skipped.
 */
export function importTranslatorCsv(csv: string, rows: Pick<StringRow, 'id' | 'source'>[], tables: Record<string, StringTable>,
  snapshots: Record<string, SourceSnapshot> = {}, sourceLang = 'en'): CsvImport {
  const [head = [], ...body] = parseCsv(csv);
  const names = head.map(h => h.trim());
  const idCol = names.findIndex(h => h.toLowerCase() === 'id');
  const srcCol = names.findIndex(h => h.toLowerCase() === 'source');
  const ignored: string[] = [];
  const langCols: [string, number][] = [];
  names.forEach((h, i) => {
    if (CONTEXT_COLUMNS.has(h.toLowerCase()) || / previous source$/i.test(h)) return;
    if (LANG_CODE.test(h) && h.toLowerCase() !== sourceLang.toLowerCase() && !langCols.some(([l]) => l === h)) langCols.push([h, i]);
    else if (h) ignored.push(h);
  });
  if (idCol < 0) return { languages: [], unknown: [], ignored, error: 'The sheet has no "id" column.' };
  if (!langCols.length) return { languages: [], unknown: [], ignored, error: 'The sheet has no language column (a header such as "fi" or "pt-BR").' };
  const source = new Map(rows.map(r => [r.id, r.source]));
  const unknown = new Set<string>();
  const languages = langCols.map(([lang, col]): CsvImportLanguage => {
    const before = tables[lang] ?? {};
    const table = { ...before }, snapshot = { ...(snapshots[lang] ?? {}) };
    // Sets, in sheet order: a sheet can hold tens of thousands of rows, and a repeated id counts once (its last cell wins).
    const added = new Set<string>(), changed = new Set<string>(), outdated = new Set<string>();
    for (const cells of body) {
      const id = (cells[idCol] ?? '').trim().replace(/^#/, '');
      const text = cells[col] ?? '';
      if (!id || !text) continue;
      const now = source.get(id);
      if (now === undefined) { unknown.add(id); continue; }
      const seen = srcCol >= 0 ? cells[srcCol] ?? now : now;
      if (table[id] === text) continue;
      if (!added.has(id) && !changed.has(id)) (before[id] ? changed : added).add(id);
      table[id] = text;
      snapshot[id] = seen;
      if (seen !== now) outdated.add(id); else outdated.delete(id);
    }
    return { lang, table, snapshot, added: [...added], changed: [...changed], outdated: [...outdated], isNew: !tables[lang] };
  });
  return { languages, unknown: [...unknown], ignored };
}
