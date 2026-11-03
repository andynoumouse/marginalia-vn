import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkEngineVersion, engineStatus, engineVersion } from '../../tools/paths.mjs';

test('engineStatus compares major.minor', () => {
  assert.deepEqual(engineStatus('0.2', '0.2.1'), { wanted: '0.2', have: '0.2.1', status: 'ok' });
  assert.equal(engineStatus('0.3', '0.2.1').status, 'newer-game');
  assert.equal(engineStatus('1.0', '0.9.0').status, 'newer-game');
  assert.equal(engineStatus('0.1', '0.2.1').status, 'older-game');
  assert.equal(engineStatus('0.9', '1.0.0').status, 'older-game');
  assert.equal(engineStatus('0', '0.2.1').status, 'older-game');
  assert.deepEqual(engineStatus(undefined, '0.2.1'), { wanted: null, have: '0.2.1', status: 'ok' });
});

test('checkEngineVersion reads game.json and warns only for a newer game', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-engine-version-'));
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(checkEngineVersion(dir).status, 'ok');
  fs.writeFileSync(path.join(dir, 'game.json'), JSON.stringify({ engine: '99.0' }));
  assert.deepEqual(checkEngineVersion(dir, { quiet: true }), { wanted: '99.0', have: engineVersion, status: 'newer-game' });
  assert.equal(warn.mock.callCount(), 0);
  checkEngineVersion(dir);
  assert.equal(warn.mock.callCount(), 1);
  fs.writeFileSync(path.join(dir, 'game.json'), JSON.stringify({ engine: '0.0' }));
  assert.equal(checkEngineVersion(dir).status, 'older-game');
  assert.equal(warn.mock.callCount(), 1);
});
