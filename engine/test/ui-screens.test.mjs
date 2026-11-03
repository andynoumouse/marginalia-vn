import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UI_SCREENS, overriddenScreens, compile, shellVars } from '../../dist/engine/src/index.js';

test('every built-in screen has a starter that compiles without errors or warnings', () => {
  for (const u of UI_SCREENS) {
    const p = compile([{ file: 'park.vn', text: 'label start:\n  end\n' }, { file: u.file, text: u.starter }]);
    const bad = p.diagnostics.filter(d => d.severity !== 'info');
    assert.deepEqual(bad.map(d => d.message), [], u.name);
    assert.ok(u.name in p.screens, `${u.name} is declared`);
  }
});

test('overriddenScreens finds reserved screens by name and ignores others', () => {
  const files = [
    { file: 'a.vn', text: 'label start:\n  show screen map\n' },
    { file: 'ui/title.vn', text: 'screen title:\n  button go "Go" action start\n' },
    { file: 'b.vn', text: 'screen map:\n  button x "X"\nscreen quickmenu\n  button b "B" action back\n' },
  ];
  assert.deepEqual(overriddenScreens(files), { title: 'ui/title.vn', quickmenu: 'b.vn' });
  assert.deepEqual(overriddenScreens([]), {});
});

test('starters only use shell variables that the screen is given', () => {
  assert.ok(UI_SCREENS.every(u => u.file === `ui/${u.name}.vn` && u.starter.startsWith(`screen ${u.name}:`)));
  assert.ok(shellVars('options').includes('tab'));
});

// The unit-test and browser-test project must show the stock screens: a generated starter (the editor's "Override this
// screen") committed into games/sample/script by accident once hid the stock title and options, and the browser tests timed out.
test('the sample project has no script that overrides a built-in screen, nor stray folders of them', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../../games/sample/script/', import.meta.url);
  const walk = (d, rel = '') => readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(new URL(e.name + '/', d), rel + e.name + '/') : e.name.endsWith('.vn') ? [rel + e.name] : []);
  const files = walk(dir).map(file => ({ file, text: readFileSync(new URL(file, dir), 'utf8') }));
  assert.ok(files.length > 0);
  assert.deepEqual(overriddenScreens(files), {});
});
