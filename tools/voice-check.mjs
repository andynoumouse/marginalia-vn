// Voice recordings against their lines: hashes assets/voice/*, compares with voice.lock.json and reports
// recordings whose line was reworded since they were made (engine/src/voice.ts has the rules).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { checkVoice, acceptVoice, voiceText, AUDIO_FILE: AUDIO } = await import(new URL('../dist/engine/src/index.js', import.meta.url).href);

const lockPath = root => path.join(root, 'voice.lock.json');

/** `name -> checksum` for the recordings directly under assets/voice (name = file name without extension, `ab12` or `ab12.fi`; one file per name, the first by file name). */
export function readRecordings(root) {
  const voiceDir = path.join(root, 'assets', 'voice');
  const found = {};
  if (!fs.existsSync(voiceDir)) return found;
  for (const f of fs.readdirSync(voiceDir).filter(f => AUDIO.test(f)).sort()) {
    const name = f.replace(AUDIO, '');
    if (!(name in found)) found[name] = crypto.createHash('sha1').update(fs.readFileSync(path.join(voiceDir, f))).digest('hex');
  }
  return found;
}

/** The lock as saved ({} when there is none yet). */
export function readLock(root) {
  try { return JSON.parse(fs.readFileSync(lockPath(root), 'utf8')); } catch { return {}; }
}

export function writeLock(root, lock) {
  const json = JSON.stringify(lock, null, 2) + '\n';
  if (!fs.existsSync(lockPath(root)) || fs.readFileSync(lockPath(root), 'utf8') !== json) fs.writeFileSync(lockPath(root), json);
}

/**
 * Updates `voice.lock.json`; returns the outdated recordings as `{ name, recorded, current }` (the line's wording when it was
 * recorded, and now). `program` is the compiled game; `locale` maps a language to its string table, since a recording in
 * `<id>.<lang>.<ext>` is of that language's text. `accept` lists names to mark as still matching.
 */
export function checkVoiceFiles(root, program, locale, accept = []) {
  const found = readRecordings(root);
  if (!Object.keys(found).length && !fs.existsSync(lockPath(root))) return { outdated: [], recordings: 0 };
  const textOf = name => voiceText(name, program.strings, locale);
  let old = readLock(root);
  if (accept.length) old = acceptVoice(old, accept, textOf);
  const { lock, outdated } = checkVoice(found, textOf, old);
  writeLock(root, lock);
  return { outdated: outdated.map(name => ({ name, recorded: lock[name].text, current: textOf(name) })), recordings: Object.keys(found).length };
}

export function readLocale(root) {
  const dir = path.join(root, 'locale');
  const tables = {};
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try { tables[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { /* the editor shows a broken table */ }
  }
  return tables;
}

const quote = s => JSON.stringify(s.length > 70 ? s.slice(0, 69) + '…' : s);

/** One line per outdated recording (at most `lines`): its name, the wording it was recorded against and the wording now. */
export const describeOutdated = (outdated, lines = 8) =>
  `${outdated.length} voice recording(s) of reworded lines:\n` +
  outdated.slice(0, lines).map(o => `  ${o.name}: ${quote(o.recorded)} -> ${quote(o.current)}`).join('\n') +
  (outdated.length > lines ? `\n  ... and ${outdated.length - lines} more (run "vn voice" for all)` : '');

/** `name -> file name` of the recordings (`ab12` -> `ab12.mp3`), by the same one-file-per-name rule as `readRecordings`. */
export function readVoiceFiles(root) {
  const voiceDir = path.join(root, 'assets', 'voice');
  const found = {};
  if (!fs.existsSync(voiceDir)) return found;
  for (const f of fs.readdirSync(voiceDir).filter(f => AUDIO.test(f)).sort()) {
    const name = f.replace(AUDIO, '');
    if (!(name in found)) found[name] = f;
  }
  return found;
}
