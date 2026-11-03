// The online demo's pieces that run without a browser: its /api routes (online/routes.ts) on an in-memory store, the zip
// format, capabilities and the project listing. The service worker and IndexedDB are only exercised in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { handleApi, readProject, foldersOf, ONLINE_CAPABILITIES } from '../../dist/online/routes.js';
import { writeZip, readZip, commonRoot, readCapabilities, FULL_CAPABILITIES, projectFromListing, projectTextFiles, editorExtras } from '../../dist/engine/src/index.js';
import { projectData, projectListing } from '../../tools/project-data.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();

/** A FileStore on a Map, with a clock that only moves when asked. */
function memoryStore(files = {}) {
  const m = new Map(Object.entries(files).map(([p, t]) => [p, { bytes: typeof t === 'string' ? enc.encode(t) : t, mtime: 1 }]));
  return {
    m,
    async list() { return [...m].map(([path, f]) => ({ path, mtime: f.mtime, size: f.bytes.length })); },
    async read(p) { return m.get(p)?.bytes ?? null; },
    async write(p, bytes) { m.set(p, { bytes, mtime: 2 }); },
    async remove(paths) { for (const p of paths) m.delete(p); },
    async move(pairs) { const got = pairs.map(([a]) => m.get(a)); for (const [a] of pairs) m.delete(a); pairs.forEach(([, b], i) => got[i] && m.set(b, got[i])); },
  };
}

function api(files) {
  const store = memoryStore(files), events = [];
  let clock = Date.parse('2026-11-03T10:00:00Z');
  const ctx = {
    store, changed: (type, file) => events.push(`${type}:${file}`),
    deflate: async b => zlib.deflateSync(b), sha1: async b => crypto.createHash('sha1').update(b).digest('hex'),
    now: () => new Date(clock += 1000),
  };
  const call = async (method, path, body = '') => {
    const res = await handleApi(ctx, method, new URL(path, 'http://x'), async () => (typeof body === 'string' ? enc.encode(body) : body));
    const text = res ? await res.text() : null;
    let json = null;
    try { json = JSON.parse(text); } catch { /* text */ }
    return { status: res?.status ?? null, text, json };
  };
  return { store, events, call, text: p => (store.m.has(p) ? dec.decode(store.m.get(p).bytes) : null) };
}

const SAMPLE = {
  'game.json': '{ "title": "T" }\n',
  'script/a.vn': 'label start:\n  "Hi."\n',
  'script/sub/b.vn': '"B."\n',
  'locale/fi.json': '{"ab12":"Hei."}',
  'assets/bg/park.png': new Uint8Array([1, 2, 3]),
  'assets/char/mina/sprite.json': '{"parts":[],"files":[]}',
  'assets/char/mina/rig.json': '{"z":[]}',
  'masters/char/mina.psd': new Uint8Array([0]),
};

test('the online demo says what it cannot do; a missing or odd answer means the dev server', () => {
  assert.deepEqual(readCapabilities(ONLINE_CAPABILITIES), ONLINE_CAPABILITIES);
  assert.deepEqual(readCapabilities(null), FULL_CAPABILITIES);
  assert.deepEqual(readCapabilities({ git: 'no', tasks: [1] }), FULL_CAPABILITIES);
  assert.deepEqual(readCapabilities({ git: false, tasks: [] }), { ...FULL_CAPABILITIES, git: false, tasks: [] });
});

test('the project from a listing is what the disk version builds, and the dev server serves', () => {
  assert.deepEqual(projectFromListing(projectListing('sample')), projectData('sample'));
  assert.deepEqual(projectTextFiles(['game.json', 'script/a.vn', 'assets/bg/x.png', 'assets/char/m/sprite.json', 'locale/fi.json', 'locale/x/y.json']),
    ['game.json', 'script/a.vn', 'assets/char/m/sprite.json', 'locale/fi.json']);
  assert.deepEqual(editorExtras(['masters/char/m.psd', 'masters/x/y.psd', 'masters/bg/a.PSD'], ['assets/bg', 'assets/bg/sub', 'script/x']),
    { masters: ['bg/a.PSD', 'char/m.psd'], assetDirs: ['bg'] });
  assert.deepEqual(foldersOf(['script/a/b.vn', 'assets/x.png']), ['assets', 'script', 'script/a']);
});

test('/api/project from a store: scripts, folders, rigs, masters and asset folders', async () => {
  const { call } = api(SAMPLE);
  const p = (await call('GET', '/api/project')).json;
  assert.deepEqual(p.scripts.map(s => s.file), ['a.vn', 'sub/b.vn']);
  assert.deepEqual(p.scriptDirs, ['sub']);
  assert.deepEqual(p.locales, { fi: { ab12: 'Hei.' } });
  assert.deepEqual(p.rigs.mina, { parts: [], files: [], rig: { z: [] } });
  assert.equal(p.rigTexts.mina, '{"z":[]}');
  assert.deepEqual(p.masters, ['char/mina.psd']);
  assert.deepEqual(p.assetDirs, ['bg', 'char']);
  assert.equal(p.gameText, '{ "title": "T" }\n');
});

test('saving scripts, game.json and locales checks names and JSON, and reports the change', async () => {
  const { call, text, events } = api(SAMPLE);
  assert.equal((await call('PUT', '/api/script?file=new/c.vn', 'x')).status, 200);
  assert.equal(text('script/new/c.vn'), 'x');
  for (const bad of ['../x.vn', 'a/../x.vn', 'x.txt', '/x.vn', 'a//b.vn']) assert.equal((await call('PUT', `/api/script?file=${encodeURIComponent(bad)}`, 'x')).status, 403, bad);
  assert.equal((await call('PUT', '/api/game', '{ bad')).status, 400);
  assert.equal((await call('PUT', '/api/game', '{"title":"U"}')).status, 200);
  assert.equal((await call('PUT', '/api/locale?file=../x.json', '{}')).status, 403);
  assert.equal((await call('PUT', '/api/locale?file=ja.json', '{}')).status, 200);
  assert.deepEqual(Object.keys((await call('GET', '/api/locales')).json), ['locale/fi.json', 'locale/ja.json']);
  assert.equal((await call('PUT', '/api/rig?char=nobody', '{}')).status, 403);
  assert.equal((await call('PUT', '/api/rig?char=mina', '{"z":[1]}')).status, 200);
  assert.deepEqual(events, ['content:script/new/c.vn', 'content:game.json', 'content:locale/ja.json', 'content:assets/char/mina/rig.json']);
});

test('folders, moves and deletes keep the disk rules: no overwrite, the trash, empty folders kept', async () => {
  const { call, store, text } = api(SAMPLE);
  assert.equal((await call('PUT', '/api/folder?dir=music&in=assets')).status, 200);
  assert.ok(store.m.has('assets/music/.gitkeep'));
  assert.equal((await call('POST', '/api/move?from=script/a.vn&to=script/sub/b.vn')).status, 409);
  assert.equal((await call('POST', '/api/move?from=script/zz.vn&to=script/q.vn')).status, 404);
  assert.deepEqual((await call('POST', '/api/move?from=script/sub&to=script/chapter&dir=1')).json, { ok: true, to: 'script/chapter' });
  assert.equal(text('script/chapter/b.vn'), '"B."\n');
  // Delete moves to the trash; the folder it leaves empty stays (with a .gitkeep), as on disk.
  const del = (await call('POST', '/api/delete?path=script/chapter/b.vn')).json;
  assert.ok(del.ok && /^2026-11-03_10-00-\d\d$/.test(del.trash));
  assert.ok(!store.m.has('script/chapter/b.vn') && store.m.has('script/chapter/.gitkeep'));
  const trash = (await call('GET', '/api/trash')).json;
  assert.deepEqual(trash.map(t => [t.action, t.paths, t.bytes]), [['delete', ['script/chapter/b.vn'], 5 + JSON.stringify({ action: 'delete', paths: ['script/chapter/b.vn'], time: trash[0].time }, null, 2).length]]);
  assert.equal((await call('GET', '/api/project')).json.scripts.length, 1, 'trashed files are not part of the project');
  // Restoring puts it back; something in the way goes to the trash in turn.
  await call('PUT', '/api/script?file=chapter/b.vn', 'new');
  const back = (await call('POST', `/api/trash/restore?id=${del.trash}`)).json;
  assert.ok(back.ok && back.aside);
  assert.equal(text('script/chapter/b.vn'), '"B."\n');
  assert.equal((await call('POST', '/api/trash/empty?id=nope')).status, 400);
  assert.deepEqual((await call('POST', '/api/trash/empty')).json, { ok: true, removed: 1 });
  assert.ok(![...store.m.keys()].some(p => p.startsWith('.trash/')));
});

test('asset drops, Replace and voice takes follow the dev server: 409 on a clash, the old file to the trash', async () => {
  const { call, text, store } = api(SAMPLE);
  assert.deepEqual((await call('PUT', '/api/asset?name=park.png&folder=bg', 'x')).json, { dest: 'assets/bg/park.png' });
  assert.equal((await call('PUT', '/api/asset?name=night.png&folder=bg', 'png')).json.dest, 'assets/bg/night.png');
  assert.equal((await call('PUT', '/api/asset?replace=assets/bg/park.png&name=other.jpg', 'x')).status, 400);
  const rep = (await call('PUT', '/api/asset?replace=assets/bg/park.png&name=other.png', 'new')).json;
  assert.ok(rep.ok && rep.trash);
  assert.equal(text('assets/bg/park.png'), 'new');
  const take = (await call('PUT', '/api/asset?voice=ab12&name=t.ogg', 'ogg')).json;
  assert.equal(take.sum, crypto.createHash('sha1').update('ogg').digest('hex'));
  assert.equal((await call('PUT', '/api/asset?voice=ab12&name=t.mp3', 'mp3')).status, 409);
  assert.equal((await call('PUT', '/api/asset?voice=ab12&name=t.mp3&replace=1', 'mp3')).status, 200);
  assert.ok(!store.m.has('assets/voice/ab12.ogg') && store.m.has('assets/voice/ab12.mp3'));
  const voice = (await call('GET', '/api/voice')).json;
  assert.deepEqual(voice.files, { ab12: 'ab12.mp3' });
  assert.equal((await call('PUT', '/api/voice', '{"ab12":{"sum":1}}')).status, 400);
  assert.equal((await call('PUT', '/api/voice', '{"ab12":{"sum":"s","text":"t"}}')).status, 200);
  assert.deepEqual((await call('GET', '/api/voice')).json.lock, { ab12: { sum: 's', text: 't' } });
});

test('what needs the machine answers like a server without it', async () => {
  const { call } = api(SAMPLE);
  assert.deepEqual((await call('GET', '/api/git')).json, { repo: false, git: false });
  for (const [m, p] of [['POST', '/api/git/commit'], ['POST', '/api/reveal?path='], ['POST', '/api/task?name=export'], ['GET', '/api/build-check']]) {
    assert.equal((await call(m, p)).status, 403, p);
  }
  assert.equal((await call('GET', '/elsewhere')).status, null, 'not an /api route: the worker serves it');
  // Without the PSD reader, a reconvert reports it instead of failing silently.
  assert.match(JSON.parse((await call('POST', '/api/task?name=art')).text.split('\n')[0]).out, /converter is not loaded/);
});

test('a dropped PSD is converted in place, and a reconvert replaces the old parts', async () => {
  const agPsd = await import('ag-psd').catch(() => null);
  if (!agPsd) return; // not installed
  const { readPsd, initializeCanvas } = agPsd.readPsd ? agPsd : agPsd.default;
  initializeCanvas(() => { throw new Error('no canvas'); }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
  const { call, store, events } = api({ 'game.json': '{}', 'assets/char/mina/old.png': 'stale', 'assets/char/mina/sprite.json': '{"files":["old.png"]}' });
  const ctxPsd = b => readPsd(b, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
  const res = await handleApi({ store, changed: (t, f) => events.push(`${t}:${f}`), readPsd: ctxPsd, deflate: async b => zlib.deflateSync(b), sha1: async () => '' },
    'PUT', new URL('http://x/api/asset?name=mina.psd&folder=char'), async () => new Uint8Array(fs.readFileSync('sample/masters/char/mina.psd')));
  const out = await res.json();
  assert.equal(out.dest, 'masters/char/mina.psd');
  assert.match(out.art, /-> assets\/char\/mina \(540x1080, 15 images/);
  assert.ok(!store.m.has('assets/char/mina/old.png'), 'the previous conversion\'s parts are cleared');
  const sprite = JSON.parse(dec.decode(store.m.get('assets/char/mina/sprite.json').bytes));
  assert.equal(sprite.files.length, 15);
  for (const f of sprite.files) assert.deepEqual([...store.m.get(`assets/char/mina/${f}`).bytes.subarray(0, 4)], [137, 80, 78, 71], f);
  assert.ok(events.includes('masters:masters/char/mina.psd') && events.includes('content:assets/char/mina/sprite.json'));
});

test('zips: stored and deflated entries round-trip; a single top folder is the project root', async () => {
  const raw = async b => zlib.deflateRawSync(b), inflate = async b => zlib.inflateRawSync(b);
  const big = enc.encode('word '.repeat(500)), small = enc.encode('hi'), bin = crypto.randomBytes(300);
  const entries = [{ path: 'g/a.txt', bytes: big }, { path: 'g/ä/b.txt', bytes: small }, { path: 'g/c.bin', bytes: new Uint8Array(bin) }];
  for (const deflate of [undefined, raw]) {
    const zip = await writeZip(entries, deflate);
    const back = await readZip(zip, inflate);
    assert.deepEqual(back.map(e => [e.path, Buffer.from(e.bytes).toString('hex')]), entries.map(e => [e.path, Buffer.from(e.bytes).toString('hex')]));
    if (deflate) assert.ok(zip.length < big.length, 'text is compressed');
  }
  assert.equal(commonRoot(entries.map(e => e.path)), 'g/');
  assert.equal(commonRoot(['a/x', 'b/y']), '');
  assert.equal(commonRoot(['game.json']), '');
  await assert.rejects(readZip(enc.encode('not a zip at all, really not'), inflate), /not a zip/);
});
