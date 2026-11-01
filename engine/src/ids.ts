import { RE_DEFINE_ITEM, RE_INPUT, RE_INPUT_ID, RE_MENU, RE_NARR, RE_OPT, RE_SAY } from './parser.js';
import { RE_ELEMENT, elementString, splitElementLine } from './screen-syntax.js';

/** `define item key "Key" [#id] [image=...]`: the quoted name and the id after it, if any. */
const RE_ITEM_NAME = /^(define[ \t]+item[ \t]+[A-Za-z_]\w*[ \t]+"(?:[^"\\]|\\.)*")(?:[ \t]+#([A-Za-z0-9]{4,8}))?/;

/** The localizable string of a `define item` line, a hotspot, a button or a text element: its id (or null) and where an id goes. */
function stringOf(t: string): { id: string | null; insertAt: number } | null {
  if (RE_DEFINE_ITEM.test(t)) {
    const m = RE_ITEM_NAME.exec(t);
    return m ? { id: m[2] ?? null, insertAt: m[1].length } : null;
  }
  if (!RE_ELEMENT.test(t)) return null;
  const s = elementString(splitElementLine(t).head);
  return s ? { id: s.id, insertAt: s.quoteEnd } : null;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ALPHABET = LETTERS + '0123456789';

/** All localization ids already used in the given script texts. */
export function existingIds(texts: string[]): Set<string> {
  const ids = new Set<string>();
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.trim();
      if (!t || t.startsWith('#')) continue;
      const o = RE_OPT.exec(t);
      if (o?.[5]) ids.add(o[5]);
      const m = o?.[2] ?? RE_MENU.exec(t)?.[2] ?? RE_NARR.exec(t)?.[2] ?? RE_SAY.exec(t)?.[3]
        ?? (RE_INPUT.test(t) ? RE_INPUT_ID.exec(t)?.[1] : undefined) ?? stringOf(t)?.id ?? undefined;
      if (m) ids.add(m);
    }
  }
  return ids;
}

/** Append a stable id (" #ab12") to every dialogue, narration, menu and `input` prompt line that lacks one. */
export function assignIds(text: string, taken: Set<string>, rng: () => number = Math.random): { text: string; added: number } {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  let added = 0;
  // Four characters first; after a few hundred clashes (a crowded id space, or a stuck rng) the id grows by one
  // character (the parser accepts 4 to 8), so this always ends.
  const newId = () => {
    for (let len = 4; len <= 8; len++) {
      for (let tries = 0; tries < 300; tries++) {
        let s = LETTERS[Math.floor(rng() * LETTERS.length)];
        for (let k = 1; k < len; k++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
        if (!taken.has(s)) { taken.add(s); return s; }
      }
    }
    throw new Error('assignIds: could not find a free id');
  };
  const out = text.split(/\r?\n/).map(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    const indent = line.slice(0, line.length - line.trimStart().length);
    let m: RegExpExecArray | null;
    if ((m = RE_MENU.exec(t))) {
      if (m[1] === undefined || m[2]) return line;
      added++;
      return `${indent}menu "${m[1]}" #${newId()}${m[3] !== undefined ? ` timeout ${m[3]}` : ''}:`;
    }
    if ((m = RE_OPT.exec(t))) {
      const needOpt = !m[2], needReason = m[4] !== undefined && !m[5];
      if (!needOpt && !needReason) return line;
      added += (needOpt ? 1 : 0) + (needReason ? 1 : 0);
      const reason = m[4] !== undefined ? ` else "${m[4]}" #${m[5] ?? newId()}` : '';
      return `${indent}"${m[1]}" #${m[2] ?? newId()}${m[3] ? ` if ${m[3]}${reason}` : ''}:`;
    }
    if ((m = RE_NARR.exec(t))) {
      if (m[2]) return line;
      added++;
      return `${indent}"${m[1]}" #${newId()}`;
    }
    if ((m = RE_SAY.exec(t))) {
      if (m[3]) return line;
      added++;
      return `${indent}${m[1]}: ${m[2]} #${newId()}`;
    }
    if (RE_INPUT.test(t) && !RE_INPUT_ID.test(t)) {
      added++;
      return `${line.trimEnd()} #${newId()}`;
    }
    const str = stringOf(t);
    if (str && !str.id) {
      added++;
      return `${indent}${t.slice(0, str.insertAt)} #${newId()}${t.slice(str.insertAt)}`;
    }
    return line;
  });
  return { text: out.join(nl), added };
}
