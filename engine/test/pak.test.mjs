import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPak, packAssets, pakHeader, pakSeed, scramble } from '../../dist/engine/src/index.js';

const bytes = (n, k) => Uint8Array.from({ length: n }, (_, i) => (i * k + 7) & 255);
const files = [
  { path: 'bg/park.png', data: bytes(1000, 3) },
  { path: 'music/theme.ogg', data: bytes(4099, 5) },
  { path: 'empty.txt', data: new Uint8Array(0) },
];
const reader = pak => (pos, len) => pak.subarray(pos, pos + len);

test('pak: files round trip and the stored bytes are scrambled', async () => {
  const pak = packAssets(files, 'secret');
  const opened = await openPak(reader(pak), 'secret');
  assert.deepEqual(opened.paths().sort(), ['bg/park.png', 'empty.txt', 'music/theme.ogg']);
  for (const f of files) assert.deepEqual(await opened.read(f.path), f.data);
  assert.equal(opened.size('music/theme.ogg'), 4099);
  assert.equal(opened.has('nope.png'), false);
  assert.equal(await opened.read('nope.png'), undefined);
  const needle = files[0].data.subarray(0, 32);
  assert.equal(Buffer.from(pak).includes(Buffer.from(needle)), false);
  assert.equal(Buffer.from(pak).includes('park.png'), false);
});

test('pak: a range read matches the same slice of the whole file, from any start', async () => {
  const opened = await openPak(reader(packAssets(files, 'k')), 'k');
  const whole = await opened.read('music/theme.ogg');
  for (const [a, b] of [[0, 1], [1, 6], [3, 4000], [4095, 4099], [10, 5000], [5000, 6000]]) {
    assert.deepEqual(await opened.read('music/theme.ogg', a, b), whole.subarray(a, Math.min(b, whole.length)));
  }
});

test('pak: wrong key and non-pak files are rejected', async () => {
  const pak = packAssets(files, 'right');
  await assert.rejects(openPak(reader(pak), 'wrong'), /key/);
  await assert.rejects(openPak(reader(new Uint8Array(40)), 'right'), /Not an asset pack/);
});

test('pak: streaming with pakHeader and scramble gives the same bytes as packAssets', () => {
  const { header, offsets, total } = pakHeader(files.map(f => ({ path: f.path, size: f.data.length })), 'k');
  const out = new Uint8Array(total);
  out.set(header);
  for (const f of files) {
    const pos = offsets.get(f.path);
    out.set(scramble(Uint8Array.from(f.data), pos, pakSeed('k')), pos);
  }
  assert.deepEqual(out, packAssets(files, 'k'));
});

test('pak: duplicate paths are refused', () => {
  assert.throws(() => packAssets([{ path: 'a', data: bytes(1, 1) }, { path: 'a', data: bytes(1, 1) }], 'k'), /Duplicate/);
});

test('desktop export: project.json and the translation tables are in the pak, not on disk', async () => {
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '../..');
  const out = path.join(root, 'sample', 'build', 'pak-test');
  try {
    const run = spawnSync(process.execPath, ['bin/vn.mjs', 'export', '--project', 'sample', '--desktop', '--no-build', '--out', 'build/pak-test'], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(path.join(out, 'project.json')), false);
    assert.equal(fs.existsSync(path.join(out, 'locale')), false);
    const { key } = JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8'));
    const pak = fs.readFileSync(path.join(out, 'assets.pak'));
    const opened = await openPak(reader(new Uint8Array(pak)), key);
    const project = JSON.parse(new TextDecoder().decode(await opened.read('.vn/project.json')));
    assert.ok(project.program, 'the compiled program is in the pak');
    assert.ok(project.assets.length > 0);
    assert.equal(opened.paths().filter(p => p.startsWith('.vn/')).every(p => /^\.vn\/(project|locale\/[^/]+)\.json$/.test(p)), true);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
