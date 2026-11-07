// Characterization of the Monaco JSON schemas (editor/json-schemas.ts): updateGameSchema runs against a fixed program, asset
// list and set of open files, and the schemas it hands to Monaco are compared with fixtures/json-schemas.json. It pins the
// output so splitting the big functions (REFACTOR-PLAN step 5.1) shows every change. After a deliberate change to a schema:
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
