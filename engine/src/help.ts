/**
 * Help for the editor: docs/commands.md rendered to HTML, and the section that belongs to the statement
 * under the cursor. Editor-agnostic (no DOM), so it can be tested in node.
 */

import { esc } from './util.js';

export interface HelpHeading { id: string; title: string; level: number }
export interface HelpDoc {
  html: string;
  outline: HelpHeading[];           // the ## and ### headings, for navigation
  /** Section id for a topic key: a command word ("hide"), a heading id ("text-tags"); undefined if unknown. */
  find(key: string): string | undefined;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Inline markdown: `code`, **bold**, [text](#anchor | http url). Everything else is plain text. An anchor written for GitHub
 * (`#parameters--pads--keyforms`, a dash per word and per slash) is folded to the heading id `slug` makes (`parameters-pads-keyforms`).
 */
function inline(src: string): string {
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_, c: string) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((#[\w-]+|https?:\/\/[^)\s]+)\)/g, (_, t: string, u: string) =>
      u.startsWith('#') ? `<a href="${u}" data-help="${u.slice(1).replace(/-+/g, '-')}">${t}</a>` : `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}

/** Split a table row on "|" outside `code`. */
function cells(row: string): string[] {
  const out: string[] = [];
  let cur = '', code = false;
  for (const ch of row.trim().replace(/^\|/, '').replace(/\|$/, '')) {
    if (ch === '`') code = !code;
    if (ch === '|' && !code) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** The markdown subset docs/commands.md uses: headings, paragraphs, lists, tables and fenced code. */
export function parseHelp(md: string): HelpDoc {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [], outline: HelpHeading[] = [], topics = new Map<string, string>();
  const used = new Set<string>();
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      html.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
    } else if (/^#{1,3} /.test(line)) {
      const level = line.indexOf(' '), title = line.slice(level + 1).trim();
      let id = slug(title);
      while (used.has(id)) id += '-2';
      used.add(id);
      if (level > 1) outline.push({ id, title, level });
      if (level === 3) for (const part of title.split(' / ')) topics.set(slug(part), id); // "show / hide" -> show, hide
      topics.set(id, id);
      html.push(`<h${level} id="${id}">${inline(title)}</h${level}>`);
      i++;
    } else if (/^\|/.test(line) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
      html.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^[-*] /.test(line)) {
      const items: string[] = [];
      for (; i < lines.length && /^[-*] /.test(lines[i]); i++) items.push(lines[i].slice(2));
      html.push(`<ul>${items.map(t => `<li>${inline(t)}</li>`).join('')}</ul>`);
    } else if (!line.trim()) {
      i++;
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(```|#{1,3} |\||[-*] )/.test(lines[i]); i++) para.push(lines[i].trim());
      html.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return { html: html.join('\n'), outline, find: key => topics.get(key) };
}

const COMMAND_WORD = /^([A-Za-z_]\w*)\b/;

/**
 * The help topic key for the statement at `column` (0-based) of `line`: a command word (`show`, `elif`),
 * `text-tags` inside an open `{` of dialogue text, or `speech-and-narration` / `menu` for story lines.
 * Look the key up with `HelpDoc.find`; elif/else and call/return/end resolve through the shared heading.
 */
export function helpTopicAt(line: string, column = line.length): string | null {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  const speech = t.startsWith('"') || /^[A-Za-z_]\w*:\s/.test(t);
  if (speech) {
    const before = line.slice(0, column), open = before.lastIndexOf('{');
    if (open >= 0 && !before.includes('}', open)) return 'text-tags';
    if (/^"[^"]*(?:\\.[^"]*)*"(?:\s+#\w+)?(?:\s+if\s.+)?\s*:$/.test(t)) return 'menu';
    return 'speech-and-narration';
  }
  return COMMAND_WORD.exec(t)?.[1] ?? null;
}

/** rig.json's top-level keys and the docs/rig-json.md heading (its slug) that explains each. */
const RIG_TOPICS: Readonly<Record<string, string>> = {
  order: 'order', bones: 'bones', parts: 'parts', looks: 'looks', pivots: 'pivots', auto: 'auto', reactions: 'reactions', animations: 'animations',
  categories: 'parameters-pads-keyforms', parameters: 'parameters-pads-keyforms', pads: 'parameters-pads-keyforms', keyforms: 'parameters-pads-keyforms',
  deformers: 'deformers', masks: 'masks', poses: 'poses', physics: 'physics',
};
/** Keys of a deformer and its mesh other than the skin's: above a line, the nearest of these or `weights` says which section the line is in. */
const DEFORMER_KEYS = new Set(['id', 'part', 'members', 'box', 'grid', 'mesh', 'verts', 'tris', 'detail', 'keyforms', 'param', 'keys', 'params', 'forms', 'at', 'pts']);

/**
 * The docs/rig-json.md section for a line (0-based) of a rig.json text: the top-level key (`order`, `bones`, `parts`, `looks`,
 * `animations`, `deformers`, `physics`...) the line sits under, or null above the first one or under an unknown key. A line in a mesh's
 * `weights` or at its `defaultBone` is `skinning`. Look the key up with `HelpDoc.find`.
 */
export function rigHelpTopicAt(lines: readonly string[], line: number): string | null {
  let skin: boolean | undefined; // under deformers: is the nearest deformer key above the line the skin's?
  for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
    const top = /^ {0,2}"(\w+)"\s*:/.exec(lines[i]);
    if (top) return top[1] === 'deformers' && skin ? 'skinning' : RIG_TOPICS[top[1]] ?? null;
    if (skin === undefined) {
      const key = /^\s*"(\w+)"\s*:/.exec(lines[i])?.[1];
      if (key === 'weights' || key === 'defaultBone') skin = true;
      else if (key !== undefined && DEFORMER_KEYS.has(key)) skin = false;
    }
  }
  return null;
}
