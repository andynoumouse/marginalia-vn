import type { Value } from './expr.js';

export type TextFx = 'shake' | 'wave';
export type Segment =
  | { kind: 'text'; text: string; italic: boolean; bold: boolean; color?: string; size?: number; fx?: TextFx; ruby?: string }
  | { kind: 'pause'; seconds: number }
  | { kind: 'wait' }  // {wait}: stop typing until the player clicks
  | { kind: 'next' }; // {nw}: go on to the next line by itself once the text is shown

/**
 * Replace [name] with the variable's value (also [persistent.name]). Unknown names are left as written. A list shows its
 * entries joined with commas; `itemNames` (item id -> display name, from `define item`) swaps the entries that are items.
 * `lang` picks the plural rules for keyed plural forms (`[n:one=...|few=...|other=...]`).
 */
export function interpolate(text: string, vars: Record<string, Value>, itemNames: Record<string, string> = {}, lang = 'en'): string {
  return text.replace(/\[([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)(?::([^\][]+))?\]/g, (m, n: string, fmt?: string) => {
    if (!(n in vars)) return m;
    const v = vars[n];
    if (fmt !== undefined) return formatValue(v, fmt, lang) ?? m;
    return Array.isArray(v) ? v.map(x => (typeof x === 'string' && Object.hasOwn(itemNames, x) ? itemNames[x] : String(x))).join(', ') : String(v);
  });
}

/**
 * `[n:2]` shows a number with 2 decimals (0-8), `[n:,]` groups thousands, `[n:,2]` both, and `[n:coin|coins]` picks a
 * plural form: one `|` means 1 / other, two mean 0 / 1 / other. Keyed forms (`one=coin|few=coins|other=coins`, plus
 * exact counts like `0=none`) follow the language's plural rules, falling back to `other`. A list counts as its length.
 * Returns null for a format it does not know, so the tag stays as written.
 */
function formatValue(v: Value, fmt: string, lang: string): string | null {
  const count = Array.isArray(v) ? v.length : Number(v);
  if (fmt.includes('|')) {
    const forms = fmt.split('|');
    const keyed = forms.map(f => PLURAL_KEY.exec(f));
    if (keyed.every(k => k)) {
      if (Number.isNaN(count)) return null;
      const table = new Map(keyed.map(k => [k![1], k![2]]));
      return table.get(String(count)) ?? table.get(pluralCategory(count, lang)) ?? table.get('other') ?? null;
    }
    if (forms.length > 3 || Number.isNaN(count)) return null;
    return forms.length === 2 ? forms[count === 1 ? 0 : 1] : forms[count === 0 ? 0 : count === 1 ? 1 : 2];
  }
  const num = /^(,)?(\d)?$/.exec(fmt);
  if (!num || (!num[1] && !num[2]) || typeof v === 'string' || Array.isArray(v) || Number.isNaN(count)) return null;
  const digits = num[2] === undefined ? undefined : Number(num[2]);
  if (digits !== undefined && digits > 8) return null;
  return count.toLocaleString('en-US', { useGrouping: !!num[1], minimumFractionDigits: digits ?? 0, maximumFractionDigits: digits ?? 20 });
}

const PLURAL_KEY = /^(zero|one|two|few|many|other|\d+)=(.*)$/s;

/** The CLDR plural category of `count` in `lang` ('other' when the language is unknown to Intl). */
function pluralCategory(count: number, lang: string): string {
  try {
    return new Intl.PluralRules(lang).select(count);
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

const COLOR = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;

/**
 * Split text into styled runs and timing marks:
 *   {i}{/i} {b}{/b} {color=#ff6fa5}{/color} {size=1.4}{/size} {shake}{/shake} {wave}{/wave} {ruby=reading}base{/ruby}
 *   {pause=0.5} {wait} (until click) {nw} (continue without a click)
 * Anything else in braces is shown as written.
 */
export function parseRich(text: string): Segment[] {
  const segs: Segment[] = [];
  let italic = false, bold = false, buf = '', last = 0;
  let color: string | undefined, size: number | undefined, fx: TextFx | undefined, ruby: string | undefined;
  const flush = () => {
    if (!buf) return;
    const seg: Segment = { kind: 'text', text: buf, italic, bold };
    if (color) seg.color = color;
    if (size) seg.size = size;
    if (fx) seg.fx = fx;
    if (ruby) seg.ruby = ruby;
    segs.push(seg);
    buf = '';
  };
  const re = /\{(?:(\/?)(i|b|color|size|shake|wave|ruby)(?:=([^{}]*))?|pause=([0-9]*\.?[0-9]+)|(wait|nw))\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [all, close, tag, arg, pause, mark] = m;
    const bad = tag && !close && (tag === 'color' ? !COLOR.test(arg ?? '') : tag === 'size' ? !(Number(arg) > 0) : tag === 'ruby' ? !arg : arg !== undefined);
    const stray = tag && close && arg !== undefined;
    if (bad || stray) continue; // not a tag we know: stays in the text
    buf += text.slice(last, m.index);
    last = re.lastIndex;
    flush();
    if (pause !== undefined) segs.push({ kind: 'pause', seconds: Number(pause) });
    else if (mark) segs.push({ kind: mark === 'wait' ? 'wait' : 'next' });
    else if (tag === 'i') italic = !close;
    else if (tag === 'b') bold = !close;
    else if (tag === 'color') color = close ? undefined : arg;
    else if (tag === 'size') size = close ? undefined : Number(arg);
    else if (tag === 'ruby') ruby = close ? undefined : arg;
    else fx = close ? undefined : (tag as TextFx);
  }
  buf += text.slice(last);
  flush();
  return segs;
}
