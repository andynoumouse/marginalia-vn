// Player data of the desktop build: one file per storage key in a folder (the key is the URL-encoded file name).
// Writes go to a temp file first and are renamed over the target, so a crash never leaves half a save.

const fs = require('node:fs');
const path = require('node:path');

const encode = key => encodeURIComponent(key).replace(/[*!'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const fileOf = (dir, key) => path.join(dir, encode(key));

/** Every stored key and value. Unreadable files and leftover temp files are skipped. */
function loadAll(dir) {
  const out = {};
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (name.endsWith('.tmp')) continue;
    try { out[decodeURIComponent(name)] = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { /* skip */ }
  }
  return out;
}

function writeKey(dir, key, value) {
  fs.mkdirSync(dir, { recursive: true });
  const file = fileOf(dir, key);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, String(value), 'utf8');
  fs.renameSync(tmp, file);
}

function removeKey(dir, key) {
  try { fs.unlinkSync(fileOf(dir, key)); } catch { /* already gone */ }
}

module.exports = { loadAll, writeKey, removeKey };
