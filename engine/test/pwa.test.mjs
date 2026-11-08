// The installable web export: manifest, service worker source and the game.json switch (docs/design/mobile.md, step 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pwaEnabled, pwaProblem, webManifest, serviceWorkerSource } from '../../dist/engine/src/index.js';

test('pwaEnabled only for true; pwaProblem for anything else that is not a boolean', () => {
  assert.equal(pwaEnabled({ pwa: true }), true);
  assert.equal(pwaEnabled({ pwa: 'yes' }), false);
  assert.equal(pwaEnabled({}), false);
  assert.equal(pwaEnabled(null), false);
  assert.equal(pwaProblem(undefined), null);
  assert.equal(pwaProblem(false), null);
  assert.match(pwaProblem('yes'), /true or false/);
});

test('webManifest: full screen in the stage orientation, the icon when it is square', () => {
  const landscape = JSON.parse(webManifest({ title: 'Rainy Day Library' }, { width: 1920, height: 1080 }, { width: 512, height: 512 }));
  assert.equal(landscape.name, 'Rainy Day Library');
  assert.equal(landscape.short_name, 'Rainy Day');
  assert.equal(landscape.display, 'fullscreen');
  assert.equal(landscape.orientation, 'landscape');
  assert.equal(landscape.icons[0].sizes, '512x512');
  assert.equal(JSON.parse(webManifest({ title: 'X' }, { width: 1080, height: 1920 }, null)).orientation, 'portrait');
  assert.deepEqual(JSON.parse(webManifest({ title: 'X' }, { width: 1920, height: 1080 }, null)).icons, []);
  assert.deepEqual(JSON.parse(webManifest({ title: 'X' }, { width: 1920, height: 1080 }, { width: 300, height: 200 })).icons, []);
  assert.equal(JSON.parse(webManifest({}, { width: 1920, height: 1080 }, null)).name, 'Untitled');
});

test('serviceWorkerSource: a cache named after the build that holds every file, cache first, old caches removed', () => {
  const source = serviceWorkerSource('abc123', ['index.html', 'assets/bg/a b.png', 'project.json']);
  assert.match(source, /const CACHE = "vn-abc123"/);
  assert.doesNotThrow(() => new Function(source)); // it parses
  const listed = JSON.parse(/const FILES = (\[[\s\S]*?\]);/.exec(source)[1]);
  assert.deepEqual(listed, ['./', 'index.html', 'assets/bg/a b.png', 'project.json']);
  assert.match(source, /ignoreSearch: true/);
  assert.match(source, /caches\.delete/);
});
