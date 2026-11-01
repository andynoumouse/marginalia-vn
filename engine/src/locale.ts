import type { Program } from './types.js';

export type StringTable = Record<string, string>;

/**
 * Per-language string tables keyed by line id.
 * The script itself is the source language, so it is always authoritative for `source`
 * (en.json is just an export). Other languages look up their table and fall back to the
 * script text when an entry is missing or empty.
 */
export class Locale {
  constructor(
    public tables: Record<string, StringTable> = {},
    public lang = 'en',
    public source = 'en',
  ) {}

  languages(): string[] {
    return Object.keys(this.tables);
  }

  t(id: string | null, original: string): string {
    if (!id || this.lang === this.source) return original;
    return this.tables[this.lang]?.[id] || original;
  }

  /** Ids present in the script but untranslated in `lang`. */
  missing(program: Program, lang = this.lang): string[] {
    const table = this.tables[lang] ?? {};
    return Object.keys(program.strings).filter(id => !table[id]);
  }
}
