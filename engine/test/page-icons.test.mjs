import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = file => readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8');

const BLANK = '<link rel="icon" href="data:,">';

test('every page a browser loads names an icon, so none asks for /favicon.ico', () => {
  for (const page of ['preview/index.html', 'editor/index.html', 'editor/help.html', 'editor/studio.html', 'online/index.html']) {
    assert.ok(read(page).includes(BLANK), `${page} has no <link rel="icon">`);
  }
});

test('the web export swaps the preview page\'s blank icon for the game\'s own, and keeps it when there is none', () => {
  assert.ok(read('tools/export-web.mjs').includes(`.replace('${BLANK}', icon ? `), 'tools/export-web.mjs no longer swaps the blank icon');
});
