import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPlan, distEntry, ensureBuilt } from '../../tools/build-plan.mjs';

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

test('ensureBuilt leaves an existing dist/ alone', () => {
  const run = () => assert.fail('must not build');
  assert.equal(ensureBuilt(tempRoot(true), { resolve: found, run, log: run }), null);
});

test('ensureBuilt builds a fresh clone once and reports what happened', () => {
  const root = tempRoot(false), logged = [];
  const built = ensureBuilt(root, {
    resolve: found, log: m => logged.push(m),
    run: tsc => { assert.equal(tsc, '/x/typescript/bin/tsc'); fs.mkdirSync(path.dirname(distEntry(root)), { recursive: true }); fs.writeFileSync(distEntry(root), ''); return 0; },
  });
  assert.equal(built, null);
  assert.match(logged.join('\n'), /Building the engine/);
  // A build that leaves no dist/ behind is an error message, not a crash later.
  assert.match(ensureBuilt(tempRoot(false), { resolve: found, log: () => {}, run: () => 2 }), /did not build/);
  // No TypeScript either: the message says what to install.
  assert.match(ensureBuilt(tempRoot(false), { resolve: notFound }), /Run "npm install"/);
});

test('vn init on a clone with no dist/ and no TypeScript explains itself instead of throwing', () => {
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-fresh-clone-'));
  for (const item of ['bin', 'tools', 'package.json']) fs.cpSync(path.join(repo, item), path.join(clone, item), { recursive: true });
  const r = spawnSync(process.execPath, [path.join(clone, 'bin', 'vn.mjs'), 'init', path.join(clone, 'MyGame')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Run "npm install"/);
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND/);
});
