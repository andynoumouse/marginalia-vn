// The dev server's file routes (rename/move, delete, replace) on a throwaway copy of the sample project.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let project, server, base;

const freePort = () => new Promise(resolve => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  project = mkdtempSync(path.join(tmpdir(), 'vn-files-'));
  for (const d of ['script', 'assets', 'masters']) cpSync(path.join(root, 'games', 'sample', d), path.join(project, d), { recursive: true });
  cpSync(path.join(root, 'games', 'sample', 'game.json'), path.join(project, 'game.json'));
  const port = await freePort();
  base = `http://localhost:${port}`;
  server = spawn(process.execPath, ['preview/dev-server.mjs', '--no-build', '--no-art'], {
    cwd: root, env: { ...process.env, PORT: String(port), VN_PROJECT: project }, stdio: 'ignore',
  });
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/api/project`)).ok) break; } catch { /* not listening yet */ }
    if (i > 100) throw new Error('dev server did not start');
    await new Promise(r => setTimeout(r, 100));
  }
});

after(() => {
  server?.kill();
  if (project) rmSync(project, { recursive: true, force: true });
});

const editor = { 'X-VN-Editor': '1' };
const post = (route, params, headers = editor) => fetch(`${base}/api/${route}?${new URLSearchParams(params)}`, { method: 'POST', headers });
const at = rel => path.join(project, ...rel.split('/'));

test('a script moves into a new folder, and a folder moves with its files', async () => {
  let r = await post('move', { from: 'script/demo.vn', to: 'script/extra/demo2' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, to: 'script/extra/demo2.vn' });
  assert.ok(existsSync(at('script/extra/demo2.vn')) && !existsSync(at('script/demo.vn')));
  r = await post('move', { from: 'script/extra', to: 'script/more/extra', dir: '1' });
  assert.equal(r.status, 200);
  assert.ok(existsSync(at('script/more/extra/demo2.vn')));
});

test('moves refuse other folders, a wrong kind, missing files and existing targets', async () => {
  assert.equal((await post('move', { from: 'script/park.vn', to: 'assets/park.vn' })).status, 400);
  assert.equal((await post('move', { from: 'game.json', to: 'script/game.json' })).status, 400);
  assert.equal((await post('move', { from: 'script/park.vn', to: 'script/x.vn', dir: '1' })).status, 404, 'a file is not a folder');
  assert.equal((await post('move', { from: 'script/nope.vn', to: 'script/x.vn' })).status, 404);
  const { scripts } = await (await fetch(`${base}/api/project`)).json();
  const other = scripts.map(s => `script/${s.file}`).find(f => f !== 'script/park.vn');
  assert.equal((await post('move', { from: 'script/park.vn', to: other })).status, 409);
  assert.equal((await post('move', { from: 'script/park.vn', to: 'script/x.vn' }, {})).status, 403, 'needs the editor header');
});

test('delete moves a file, or a folder only when asked for one, to the trash', async () => {
  const { assets } = await (await fetch(`${base}/api/project`)).json();
  const file = `assets/${assets.find(a => a.file.startsWith('bg/')).file}`;
  const bytes = readFileSync(at(file));
  assert.equal((await post('delete', { path: 'assets/bg', })).status, 404, 'a folder needs dir=1');
  let r = await post('delete', { path: file });
  assert.equal(r.status, 200);
  const { trash } = await r.json();
  assert.ok(!existsSync(at(file)));
  assert.deepEqual(readFileSync(at(`.trash/${trash}/${file}`)), bytes);
  assert.equal((await post('delete', { path: 'script/more', dir: '1' })).status, 200);
  assert.ok(!existsSync(at('script/more')));
  const list = await (await fetch(`${base}/api/trash`)).json();
  assert.deepEqual(list.map(e => [e.action, e.paths]), [['delete', ['script/more']], ['delete', [file]]], 'newest first');
  r = await post('trash/restore', { id: trash });
  assert.equal(r.status, 200);
  assert.deepEqual(readFileSync(at(file)), bytes);
  assert.ok(!existsSync(at(`.trash/${trash}`)));
  assert.equal((await post('trash/restore', { id: trash })).status, 404, 'restored once');
  assert.equal((await post('delete', { path: 'script', dir: '1' })).status, 400, 'never the top folder');
  assert.equal((await post('delete', { path: 'build', dir: '1' })).status, 400);
});

test('replace overwrites an existing asset with a file of the same type', async () => {
  const { assets } = await (await fetch(`${base}/api/project`)).json();
  const file = `assets/${assets.find(a => a.file.endsWith('.png')).file}`;
  const put = (name, body, rel = file) => fetch(`${base}/api/asset?${new URLSearchParams({ replace: rel, name })}`, { method: 'PUT', headers: editor, body });
  const before = readFileSync(at(file));
  const r = await put('new.png', 'png bytes');
  assert.equal(r.status, 200);
  assert.equal(readFileSync(at(file), 'utf8'), 'png bytes');
  // Restoring the replaced file swaps it back; the new one goes to the trash in its place.
  const { trash } = await r.json();
  const back = await (await post('trash/restore', { id: trash })).json();
  assert.deepEqual(readFileSync(at(file)), before);
  assert.equal(readFileSync(at(`.trash/${back.aside}/${file}`), 'utf8'), 'png bytes');
  assert.equal((await put('new.webp', 'x')).status, 400, 'another type');
  assert.equal((await put('new.vn', 'x', 'script/park.vn')).status, 400, 'scripts are saved, not replaced');
  assert.equal((await put('new.png', 'x', 'assets/bg/none.png')).status, 404);
});

test('emptying the trash deletes its entries for good, and only from the editor', async () => {
  assert.ok((await (await fetch(`${base}/api/trash`)).json()).length > 0);
  assert.equal((await post('trash/empty', {}, {})).status, 403);
  assert.equal((await post('trash/empty', { id: '../script' })).status, 400);
  assert.equal((await post('trash/empty', {})).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/trash`)).json(), []);
  assert.ok(!existsSync(at('.trash')));
});

// fetch() cannot set Host, so these go through node:http.
const raw = (pathname, headers, method = 'GET') => new Promise((resolve, reject) => {
  const { port } = new URL(base);
  const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, res => { res.resume(); resolve(res.statusCode); });
  req.on('error', reject);
  req.end();
});

test('a foreign Host is refused on every request, reads too (DNS rebinding)', async () => {
  const { port } = new URL(base);
  for (const p of ['/api/project', '/api/locales', '/api/trash', '/preview/index.html', '/__events'])
    assert.equal(await raw(p, { Host: `evil.example:${port}` }), 403, p);
  assert.equal(await raw('/api/project', { Host: `127.0.0.1:${port}` }), 200);
});

test('a write from another origin is refused even with the editor header', async () => {
  const { port } = new URL(base);
  const r = await raw('/api/trash/empty', { Host: `localhost:${port}`, Origin: 'http://localhost:9999', 'X-VN-Editor': '1' }, 'POST');
  assert.equal(r, 403);
  assert.equal(await raw('/api/trash/empty', { Host: `localhost:${port}`, Origin: 'null', 'X-VN-Editor': '1' }, 'POST'), 403);
});

test('/api/open refuses file types the editor never opens', async () => {
  writeFileSync(at('assets/setup.bat'), 'echo hi\r\n');
  assert.equal((await post('open', { path: 'assets/setup.bat' })).status, 403);
  rmSync(at('assets/setup.bat'));
  assert.equal((await post('open', { path: 'assets/none.psd' })).status, 403, 'missing files are refused as before');
});

const hasGit = spawnSync('git', ['--version']).status === 0;
test('git: the status of a repository, a scoped commit, and the .gitignore fix', { skip: !hasGit && 'git not installed' }, async () => {
  const run = (...args) => {
    const r = spawnSync('git', args, { cwd: project, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const status = async () => (await fetch(`${base}/api/git`)).json();
  assert.equal((await status()).repo, false);
  run('init', '-q', '-b', 'main');
  run('config', 'user.name', 'Test');
  run('config', 'user.email', 'test@example.com');
  const { assets } = await (await fetch(`${base}/api/project`)).json();
  assert.equal((await post('delete', { path: `assets/${assets[0].file}` })).status, 200); // something in the trash, never to be committed
  let s = await status();
  assert.equal(s.repo, true);
  assert.equal(s.branch, 'main');
  assert.deepEqual(s.unignored, ['/build/', '/.trash/']);
  assert.ok(s.changes.some(c => c.path === 'script/park.vn' && c.x === '?'));
  assert.ok(!s.changes.some(c => c.path.startsWith('.trash/')));
  assert.deepEqual(s.blockers, []);
  assert.match(s.suggest, /^Add /);

  assert.equal((await post('git/ignore', {})).status, 200);
  assert.match(readFileSync(at('.gitignore'), 'utf8'), /\/build\/\n\/\.trash\/\n/);
  assert.deepEqual((await status()).unignored, []);

  const commit = message => fetch(`${base}/api/git/commit`, { method: 'POST', headers: editor, body: message });
  assert.equal((await commit('   ')).status, 400);
  assert.equal((await fetch(`${base}/api/git/commit`, { method: 'POST', body: 'x' })).status, 403);
  const r = await commit('First version');
  assert.equal(r.status, 200, await r.clone().text());
  assert.match((await r.json()).hash, /^[0-9a-f]+$/);
  assert.equal(run('log', '--format=%s').trim(), 'First version');
  assert.ok(!run('ls-files').includes('.trash'), 'the trash stays out');
  s = await status();
  assert.deepEqual(s.changes, []);
  assert.deepEqual(s.blockers, ['Nothing to commit.']);
  assert.equal((await commit('again')).status, 409);
});
