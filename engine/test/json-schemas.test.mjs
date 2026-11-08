// Characterization of the Monaco JSON schemas (editor/json-schemas.ts): updateGameSchema runs against a fixed program, asset
// list and set of open files, and the schemas it hands to Monaco are compared with fixtures/json-schemas.json. It pins the
// output so splitting the big functions shows every change. After a deliberate change to a schema:
//   UPDATE_SNAPSHOT=1 node --test engine/test/json-schemas.test.mjs     and review the fixture diff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

let options;
globalThis.monaco = { languages: { json: { jsonDefaults: { setDiagnosticsOptions: o => { options = o; } } } } };
const { S, files } = await import('../../dist/editor/state.js');
const { updateGameSchema } = await import('../../dist/editor/json-schemas.js');

const FIXTURE = new URL('./fixtures/json-schemas.json', import.meta.url);
const model = text => ({ getValue: () => text });

test('updateGameSchema: the schemas for game.json, themes and rigs are what the fixture says', () => {
  S.assetNames = { bg: ['park', 'cg1'], music: ['theme'], ui: ['frame'], fonts: ['serif'], sound: ['blip1'] };
  S.program = {
    ops: [{ op: 'scene', bg: 'street' }, { op: 'music', name: 'night' }, { op: 'unlock', name: 'ending_a' }, { op: 'say' }],
    labels: { start: 0, second: 5 },
    characters: { alice: { style: { blip: 'high', box: 'bold' } }, bob: { style: {} } },
  };
  S.projectAssets = {
    files: [], masters: [], dirs: [], rigTexts: {},
    rigs: {
      alice: {
        parts: [
          { file: 'body.png' },
          { slot: 'eyes', variants: { open: { poses: ['calm'] }, closed: {} } },
          { slot: 'mouth', variants: { neutral: {}, wide: {} } },
        ],
      },
    },
  };
  files.clear();
  files.set('game.json', { name: 'game.json', kind: 'game', model: model('{}'), saved: '', timer: 0 });
  files.set('themes/night.json', { name: 'themes/night.json', kind: 'theme', char: 'night', model: model('{}'), saved: '', timer: 0 });
  files.set('char/alice/rig.json', { name: 'char/alice/rig.json', kind: 'rig', char: 'alice', model: model('{"bones":{"root":{},"arm":{}}}'), saved: '', timer: 0 });
  files.set('char/bob/rig.json', { name: 'char/bob/rig.json', kind: 'rig', char: 'bob', model: model('{'), saved: '', timer: 0 });
  updateGameSchema();
  const got = JSON.parse(JSON.stringify(options));
  assert.deepEqual(got.schemas.map(s => s.uri), ['vn://schema/game.json', 'vn://schema/rig/alice', 'vn://schema/theme/night']);
  if (process.env.UPDATE_SNAPSHOT) {
    fs.mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(got, null, 1) + '\n');
    return;
  }
  assert.deepEqual(got, JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
});

// UX round ES-1 and EP-1: opening a character's rig.json took Problems from 3 to 29, because the schema (additionalProperties: false)
// knew only seven of the file's keys. The sample rigs are the file as the animation studio writes it: every key in them has a place.
test('the rig.json schema accepts every key the sample characters use, and still refuses an unknown one', () => {
  const dir = new URL('../../games/sample/assets/char/', import.meta.url);
  const who = fs.readdirSync(dir).filter(w => fs.existsSync(new URL(`${w}/rig.json`, dir)) && fs.existsSync(new URL(`${w}/sprite.json`, dir)));
  assert.ok(who.length >= 2, 'the sample has layered characters');
  const text = Object.fromEntries(who.map(w => [w, fs.readFileSync(new URL(`${w}/rig.json`, dir), 'utf8')]));
  // The editor builds a character's schema from its sprite.json (the parts, slots and variants) and the rig.json tab's own text.
  S.projectAssets = { files: [], masters: [], dirs: [], rigTexts: {}, rigs: Object.fromEntries(who.map(w => [w, { ...JSON.parse(fs.readFileSync(new URL(`${w}/sprite.json`, dir), 'utf8')), rig: JSON.parse(text[w]) }])) };
  files.clear();
  for (const w of who) files.set(`char/${w}/rig.json`, { name: `char/${w}/rig.json`, kind: 'rig', char: w, model: model(text[w]), saved: '', timer: 0 });
  updateGameSchema();
  const schemas = JSON.parse(JSON.stringify(options)).schemas;
  const unknown = (schema, value, at, out) => {
    if (!schema || typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) { for (const item of value) unknown(schema.items, item, `${at}[]`, out); return; }
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k] ?? (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null);
      if (!sub && schema.additionalProperties === false) out.push(`${at}.${k}`);
      unknown(sub, v, `${at}.${k}`, out);
    }
  };
  for (const w of who) {
    const out = [];
    unknown(schemas.find(s => s.uri === `vn://schema/rig/${w}`).schema, JSON.parse(text[w]), w, out);
    assert.deepEqual(out, [], `${w}/rig.json has keys the schema refuses`);
  }
  const typo = [];
  unknown(schemas.find(s => s.uri === `vn://schema/rig/${who[0]}`).schema, { bonse: {}, animations: { nod: { keys: [], durr: 1 } } }, 'x', typo);
  assert.deepEqual(typo, ['x.bonse', 'x.animations.nod.durr']);
});
