import type { Program } from './types.js';
import type { StringTable } from './locale.js';

/**
 * The strings of a compiled script with the context a translator needs (where it is said, by whom), and how far each
 * language table has got. Pure: the editor's Translations dialog and the CSV export both draw on it.
 */

export type StringKind = 'say' | 'choice' | 'reason' | 'prompt' | 'input' | 'other';

export interface StringRow {
  id: string;
  source: string;
  kind: StringKind;
  /** The speaking character (say lines only). */
  who: string | null;
  /** Where the string is in the script; absent for strings from screens, items and other declarations. */
  file?: string;
  line?: number;
  /** The label the string sits under. */
  label?: string;
}

/** Every string of `program` in script order (strings outside the op stream, such as screen texts, come last). */
export function stringRows(program: Pick<Program, 'ops' | 'labels' | 'strings'>): StringRow[] {
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
    else if (op.op === 'menu') {
      add(op.promptId, 'prompt', null, file, line, label);
      for (const o of op.options) {
        add(o.id, 'choice', null, file, o.from, label);
        add(o.reasonId, 'reason', null, file, o.from, label);
      }
    }
  });
  for (const id of Object.keys(program.strings)) if (!seen.has(id)) rows.push({ id, source: program.strings[id], kind: 'other', who: null });
  return rows;
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
