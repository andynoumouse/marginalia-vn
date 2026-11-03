import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGame, icoFromPng, iconAsset, iconSizeProblem, packageVersion, pngSize, versionProblem, windowsVersion } from '../../dist/engine/src/index.js';

/** The first bytes of a PNG: the signature and an IHDR chunk with this size (enough for pngSize). */
const png = (width, height) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
};

test('pngSize: reads the IHDR size, null for anything else', () => {
  assert.deepEqual(pngSize(png(256, 512)), { width: 256, height: 512 });
  assert.equal(pngSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), null);
  assert.equal(pngSize(png(256, 256).slice(0, 20)), null);
  assert.equal(pngSize(png(0, 256)), null);
});

test('icoFromPng: one entry wrapping the PNG, 0 for sizes of 256 and up', () => {
  const p = png(256, 256);
  const ico = icoFromPng(p);
  const v = new DataView(ico.buffer);
  assert.deepEqual([v.getUint16(0, true), v.getUint16(2, true), v.getUint16(4, true)], [0, 1, 1]);
  assert.deepEqual([ico[6], ico[7]], [0, 0]);
  assert.equal(v.getUint32(14, true), p.length);
  assert.equal(v.getUint32(18, true), 22);
  assert.deepEqual(ico.slice(22), p);
  const small = icoFromPng(png(48, 48));
  assert.deepEqual([small[6], small[7]], [48, 48]);
  assert.throws(() => icoFromPng(new Uint8Array(30)), /Not a PNG/);
});

test('iconSizeProblem: square and at least 256', () => {
  assert.equal(iconSizeProblem({ width: 256, height: 256 }), null);
  assert.equal(iconSizeProblem({ width: 1024, height: 1024 }), null);
  assert.match(iconSizeProblem({ width: 256, height: 300 }), /square/);
  assert.match(iconSizeProblem({ width: 64, height: 64 }), /256x256 or larger/);
  assert.match(iconSizeProblem(null), /not a PNG/);
});

test('version: checks, Windows four-part and package three-part forms', () => {
  for (const ok of [undefined, '1', '1.2', '1.2.3', '1.2.3.4', '65535.0']) assert.equal(versionProblem(ok), null, String(ok));
  for (const bad of [1, '', 'v1', '1.2.3.4.5', '1..2', '1.2-beta', '70000']) assert.ok(versionProblem(bad), String(bad));
  assert.equal(windowsVersion('1.2'), '1.2.0.0');
  assert.equal(windowsVersion('01.002.3.4'), '1.2.3.4');
  assert.equal(windowsVersion(undefined), '1.0.0.0');
  assert.equal(windowsVersion('nope'), '1.0.0.0');
  assert.equal(packageVersion('1.2.3.4'), '1.2.3');
  assert.equal(packageVersion('2'), '2.0.0');
});

test('checkGame: icon names a PNG in assets/ui, version is checked', () => {
  assert.equal(iconAsset({ icon: 'app' }), 'ui/app.png');
  assert.equal(iconAsset({}), null);
  const msgs = (game, files) => checkGame(game, { files }, JSON.stringify(game, null, 1)).map(d => d.message);
  assert.deepEqual(msgs({ icon: 'app', version: '1.0' }, ['ui/app.png']), []);
  assert.deepEqual(msgs({ icon: 'app' }, ['ui/app.webp']), ['icon: no PNG "app" in assets/ui (an icon must be a .png)']);
  assert.deepEqual(msgs({ icon: 5 }, []), ['icon needs the name of a PNG in assets/ui']);
  assert.equal(msgs({ version: '1.x' }, []).length, 1);
  const [d] = checkGame({ title: 'T', icon: 'gone' }, { files: [] }, '{\n "title": "T",\n "icon": "gone"\n}');
  assert.equal(d.line, 3);
});
