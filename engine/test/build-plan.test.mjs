import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlan, distEntry } from '../../tools/build-plan.mjs';

const found = () => '/x/typescript/bin/tsc';
const notFound = () => { throw new Error('Cannot find module'); };

function tempRoot(withDist) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-build-plan-'));
  if (withDist) {
    fs.mkdirSync(path.dirname(distEntry(root)), { recursive: true });
    fs.writeFileSync(distEntry(root), '');
  }
  return root;
}

test('buildPlan builds when TypeScript resolves', () => {
  assert.deepEqual(buildPlan(tempRoot(false), { resolve: found }), { mode: 'build', tsc: '/x/typescript/bin/tsc' });
});

test('buildPlan uses dist/ without TypeScript, with a note', () => {
  const plan = buildPlan(tempRoot(true), { resolve: notFound });
  assert.equal(plan.mode, 'prebuilt');
  assert.match(plan.note, /prebuilt/);
});

test('buildPlan with --no-build uses dist/ quietly, even with TypeScript', () => {
  assert.deepEqual(buildPlan(tempRoot(true), { noBuild: true, resolve: found }), { mode: 'prebuilt', note: null });
});

test('buildPlan fails clearly with neither TypeScript nor dist/', () => {
  const plan = buildPlan(tempRoot(false), { resolve: notFound });
  assert.equal(plan.mode, 'missing');
  assert.match(plan.message, /TypeScript not found/);
  assert.match(buildPlan(tempRoot(false), { noBuild: true, resolve: found }).message, /--no-build/);
});

test('buildPlan finds TypeScript in the engine repo', () => {
  assert.equal(buildPlan(tempRoot(false)).mode, 'build');
});
