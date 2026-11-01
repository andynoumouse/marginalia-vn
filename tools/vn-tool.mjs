// Project maintenance commands (run after "npm run build"):
//   node tools/vn-tool.mjs ids       add localization ids (#abcd) to lines that lack one
//   node tools/vn-tool.mjs strings   write locale/en.json and report gaps in other languages

import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './paths.mjs';

const root = projectRoot(); // script/ and locale/ belong to the game project (tools/paths.mjs)
const { compile, assignIds, existingIds, namedPositions, namedAnchors, stageSize } = await import(
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
  fs.writeFileSync(path.join(localeDir, 'en.json'), JSON.stringify(program.strings, null, 2) + '\n');
  console.log(`locale/en.json: ${ids.length} strings`);
  for (const f of fs.readdirSync(localeDir).filter(f => f.endsWith('.json') && f !== 'en.json')) {
    const table = JSON.parse(fs.readFileSync(path.join(localeDir, f), 'utf8'));
    const missing = ids.filter(id => !table[id]);
    const unused = Object.keys(table).filter(id => !(id in program.strings) && !id.startsWith('ui.')); // ui.* = menu labels
    console.log(`${f}: ${missing.length} untranslated, ${unused.length} unused`);
    if (missing.length) {
      for (const id of missing) table[id] = '';
      fs.writeFileSync(path.join(localeDir, f), JSON.stringify(table, null, 2) + '\n');
    }
  }
} else {
  console.log('Usage: node tools/vn-tool.mjs <ids|strings>');
}
