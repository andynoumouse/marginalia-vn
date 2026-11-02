// Project maintenance commands (run after "npm run build"):
//   node tools/vn-tool.mjs ids       add localization ids (#abcd) to lines that lack one
//   node tools/vn-tool.mjs strings   write locale/<source language>.json (en.json unless game.json sets "language") and report gaps in other languages
//   node tools/vn-tool.mjs voice [accept <name>...|all]   report voice recordings of reworded lines (updates voice.lock.json)

import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './paths.mjs';
import { checkVoiceFiles, describeOutdated, readLocale } from './voice-check.mjs';

const root = projectRoot(); // script/ and locale/ belong to the game project (tools/paths.mjs)
const { sourceLanguage, compile, assignIds, existingIds, stringRows, outdatedIds, namedPositions, namedAnchors, stageSize } = await import(
  new URL('../dist/engine/src/index.js', import.meta.url).href
).catch(() => { console.error('Engine not built. Run "npm run build" first.'); process.exit(1); });

const scriptDir = path.join(root, 'script');
const localeDir = path.join(root, 'locale');

const scriptFiles = () => fs.existsSync(scriptDir)
  ? fs.readdirSync(scriptDir, { recursive: true }).filter(f => f.endsWith('.vn')).sort().map(f => path.join(scriptDir, f))
  : [];

const cmd = process.argv[2];

if (cmd === 'ids') {
  const files = scriptFiles();
  const texts = files.map(f => fs.readFileSync(f, 'utf8'));
  const taken = existingIds(texts);
  let total = 0;
  files.forEach((f, i) => {
    const { text, added } = assignIds(texts[i], taken);
    if (added) { fs.writeFileSync(f, text); total += added; console.log(`${path.relative(root, f)}: +${added} ids`); }
  });
  console.log(total ? `Added ${total} ids.` : 'Every line already has an id.');
} else if (cmd === 'strings') {
  const sources = scriptFiles().map(f => ({ file: path.relative(scriptDir, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }));
  let game = null;
  try { game = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8')); } catch { /* no game.json, or the editor shows its error */ }
  const program = compile(sources, namedPositions(game), namedAnchors(game), stageSize(game));
  for (const d of program.diagnostics.filter(d => d.severity === 'error')) console.warn(`error ${d.file}:${d.line} ${d.message}`);
  fs.mkdirSync(localeDir, { recursive: true });
  const ids = Object.keys(program.strings);
  const sourceFile = `${sourceLanguage(game)}.json`; // the export of the script, named after game.json "language"
  fs.writeFileSync(path.join(localeDir, sourceFile), JSON.stringify(program.strings, null, 2) + '\n');
  console.log(`locale/${sourceFile}: ${ids.length} strings`);
  for (const f of fs.readdirSync(localeDir).filter(f => f.endsWith('.json') && f !== sourceFile)) {
    const table = JSON.parse(fs.readFileSync(path.join(localeDir, f), 'utf8'));
    const missing = ids.filter(id => !table[id]);
    const unused = Object.keys(table).filter(id => !(id in program.strings) && !id.startsWith('ui.')); // ui.* = menu labels
    // locale/<lang>.src: the source text each translation was made against (written by the editor's Translations dialog)
    const snapFile = path.join(localeDir, f.replace(/\.json$/, '.src'));
    const snap = fs.existsSync(snapFile) ? JSON.parse(fs.readFileSync(snapFile, 'utf8')) : {};
    const outdated = outdatedIds(stringRows(program), table, snap);
    console.log(`${f}: ${missing.length} untranslated, ${unused.length} unused${outdated.length ? `, ${outdated.length} with changed source (${outdated.slice(0, 8).join(' ')}${outdated.length > 8 ? ' ...' : ''})` : ''}`);
    if (missing.length) {
      for (const id of missing) table[id] = '';
      fs.writeFileSync(path.join(localeDir, f), JSON.stringify(table, null, 2) + '\n');
    }
  }
} else if (cmd === 'voice') {
  const sources = scriptFiles().map(f => ({ file: path.relative(scriptDir, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }));
  let game = null;
  try { game = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8')); } catch { /* no game.json */ }
  const program = compile(sources, namedPositions(game), namedAnchors(game), stageSize(game));
  const locale = readLocale(root);
  const [sub, ...names] = process.argv.slice(3);
  let accept = [];
  if (sub === 'accept') {
    // `accept all` takes every outdated recording; a name is `<id>` or `<lang>/<id>`
    accept = names.includes('all') ? checkVoiceFiles(root, program, locale).outdated.map(o => o.name) : names;
    if (!accept.length) console.log('Nothing to accept. Use: voice accept <name>... | all');
  }
  const { outdated, recordings } = checkVoiceFiles(root, program, locale, accept);
  console.log(outdated.length ? describeOutdated(outdated, 1000) : `${recordings} voice recording(s), none of reworded lines.`);
  if (accept.length) console.log(`Accepted ${accept.length}.`);
} else {
  console.log('Usage: node tools/vn-tool.mjs <ids|strings|voice>');
}
