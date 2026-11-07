import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeCss, themeStylesheet, isCssColor, resolveTheme, projectFromListing, projectTextFiles, checkGame, renameAssetRefs, newProjectFiles } from '../../dist/engine/src/index.js';

test('theme css: skins, fonts, 9-slice frames; unsafe values are dropped', () => {
  const css = themeCss({
    accent: '#5fd1c3',
    font: 'Georgia',
    textbox: { x: 100, y: 800, width: 1700, background: '#112233', radius: 12 },
    skins: { alice: { text: { color: '#ffe6f0', size: 50 } }, bob: { text: { lines: 0 } } },
    text: { lines: 2 },
    choices: { image: 'choice', slice: 24, gap: 18 },
  }, [{ file: 'fonts/Mono.ttf', v: 3 }, { file: 'bg/park.png', v: 1 }]);
  assert.match(css, /#stage #text \{[^}]*--text-lines: 2/);
  assert.doesNotMatch(css, /data-skin="bob"/, 'a page of no lines is dropped');
  assert.match(css, /@font-face \{ font-family: "Mono"; src: url\("assets\/fonts\/Mono\.ttf\?v=3"\)/);
  assert.doesNotMatch(css, /bg\/park/);
  assert.match(css, /#stage \{[^}]*--vn-accent: #5fd1c3/);
  assert.match(css, /#stage #box \{[^}]*left: 100px[^}]*top: 800px[^}]*width: 1700px/);
  assert.match(css, /#stage\[data-skin="alice"\] #text \{[^}]*--text-size: 50px[^}]*color: #ffe6f0/);
  assert.match(css, /border-image: url\("assets\/ui\/choice\.png"\) 24 fill \/ 24px/);
  const evil = themeCss({ accent: 'red; } body { display: none', textbox: { background: 'url(x)' }, skins: { 'a"]{x': { text: { size: 1 } } } });
  assert.doesNotMatch(evil, /display: none|url\(x\)|a"\]/);
});

test('theme css: a color that is not one is left out, so the stock look stays', () => {
  const css = themeCss({ accent: 'blu', textbox: { background: 'rgb(1,2', border: 'oklch(70% 0.1 200)' } });
  assert.doesNotMatch(css, /--vn-accent/);
  assert.doesNotMatch(css, /background/);
  assert.match(css, /border-color: oklch\(70% 0\.1 200\)/);
});

test('isCssColor: hex, named and function colors; rejects typos and broken functions', () => {
  for (const c of ['#fff', '#5fd1c3', '#11223344', 'red', 'Transparent', 'currentColor', 'rgba(255,255,255,.2)',
    'rgb(10 20 30 / 50%)', 'hsl(200deg 50% 40%)', 'oklch(70% 0.1 200)', 'color-mix(in srgb, #5fd1c3 20%, transparent)']) {
    assert.ok(isCssColor(c), c);
  }
  for (const c of ['', 'blu', '#ff000', 'rgb(1,2', 'rgb(1,2))(', 'foo(1,2,3)', 'rgb(var(--x))x', 'red blue', 'url(x)']) {
    assert.ok(!isCssColor(c), c);
  }
});

test('theme files: a name picks themes/<name>.json, extends is followed, layered keys map onto the flat theme', () => {
  const warns = [];
  const warn = m => warns.push(m);
  const files = {
    night: { extends: 'base', tokens: { accent: '#e0a050', font: 'Lora' }, components: { textbox: { radius: 4, background: '#111' }, hotspot: { border: '#fff' } }, styles: { alice: { text: { size: 50 } } } },
    dusk: { extends: 'night', tokens: { accent: '#ff8800' }, components: { textbox: { radius: 9 } } },
    a: { extends: 'b' }, b: { extends: 'a', tokens: { accent: '#123456' } },
  };
  assert.deepEqual(resolveTheme('night', files, warn), {
    accent: '#e0a050', font: 'Lora', textbox: { radius: 4, background: '#111' }, hotBorder: '#fff', skins: { alice: { text: { size: 50 } } },
  });
  assert.deepEqual(resolveTheme('dusk', files, warn), {
    accent: '#ff8800', font: 'Lora', textbox: { radius: 9, background: '#111' }, hotBorder: '#fff', skins: { alice: { text: { size: 50 } } },
  });
  assert.deepEqual(warns, []);
  assert.equal(resolveTheme('a', files, warn).accent, '#123456');
  assert.match(warns.pop(), /extends itself/);
  assert.deepEqual(resolveTheme('nope', files, warn), {});
  assert.match(warns.pop(), /No theme "nope"/);
  assert.deepEqual(resolveTheme({ accent: '#fff' }, files, warn), { accent: '#fff' }, 'the inline form still works');
  assert.deepEqual(resolveTheme(undefined, files, warn), {});
  assert.deepEqual(resolveTheme('toString', files, warn), {}, 'prototype names are not themes');
});

test('built-in themes: paper and high-contrast can be named or extended, and override by the project', () => {
  const warns = [];
  const warn = m => warns.push(m);
  assert.equal(resolveTheme('paper', {}, warn).tokens.surface, '#f3ead8');
  const hc = resolveTheme('high-contrast', {}, warn);
  assert.equal(hc.tokens.borderWidth, 3);
  assert.equal(hc.accent, '#ffff00');
  const mine = resolveTheme('mine', { mine: { extends: 'high-contrast', tokens: { accent: '#00ffff' } } }, warn);
  assert.equal(mine.accent, '#00ffff');
  assert.equal(mine.tokens.text, '#ffffff');
  assert.equal(resolveTheme('paper', { paper: { tokens: { accent: '#111111' } } }, warn).accent, '#111111', 'a project file wins');
  assert.deepEqual(warns, []);
});

test('project data: game.json themes are resolved by name for the player to pick', () => {
  const texts = { 'game.json': '{"theme":"night","themes":["night","paper",7]}', 'themes/night.json': '{"tokens":{"accent":"#abcdef"}}' };
  const listing = { files: Object.keys(texts).map(path => ({ path, mtime: 1 })), dirs: [], text: p => texts[p] ?? null };
  const { game } = projectFromListing(listing);
  assert.deepEqual(game.themes, ['night', 'paper']);
  assert.equal(game.themeLooks.night.accent, '#abcdef');
  assert.equal(game.themeLooks.paper.tokens.surface, '#f3ead8', 'a built-in theme needs no file');
  assert.equal(game.theme.accent, '#abcdef');
});

test('theme.css: themes/<name>.css joins the theme, parents first; network loads are removed', () => {
  const texts = {
    'game.json': '{"theme":"night","themes":["night","paper"]}',
    'themes/night.json': '{"extends":"paper"}',
    'themes/night.css': '#stage #box { outline: 1px solid red; }',
    'themes/paper.css': '@import url(https://x.test/a.css);\n#stage { background: url(https://x.test/b.png), url("assets/bg/p.png"), url(data:image/png;base64,AA==); }',
  };
  const listing = { files: Object.keys(texts).map(path => ({ path, mtime: 1 })), dirs: [], text: p => texts[p] ?? null };
  const { game } = projectFromListing(listing);
  assert.match(game.theme.css, /^@import[^]*#stage #box/, 'the parent comes first');
  assert.equal(game.themeLooks.paper.css, texts['themes/paper.css']);
  const css = themeCss(game.theme);
  assert.doesNotMatch(css, /@import|x\.test/);
  assert.match(css, /url\("assets\/bg\/p\.png"\)/);
  assert.match(css, /url\(data:image\/png/);
  assert.match(css, /#stage #box \{ outline/);
  assert.deepEqual(projectTextFiles(['themes/night.css', 'themes/x/y.css']), ['themes/night.css']);
  assert.equal(themeStylesheet('a', { a: { extends: 'b' }, b: { extends: 'a' } }, { a: '1', b: '2' }), '2\n1', 'a cycle stops');
});

test('project data: game.json theme name resolves to the theme file', () => {
  const texts = { 'game.json': '{"theme":"night"}', 'themes/night.json': '{"tokens":{"accent":"#abcdef"}}' };
  const listing = { files: Object.keys(texts).map(path => ({ path, mtime: 1 })), dirs: [], text: p => texts[p] ?? null };
  assert.deepEqual(projectFromListing(listing).game.theme, { accent: '#abcdef' });
  assert.deepEqual(projectFromListing(listing).themeTexts, { night: '{"tokens":{"accent":"#abcdef"}}' }, 'the editor gets the raw text');
  assert.deepEqual(projectTextFiles(['themes/night.json', 'themes/x/y.json']), ['themes/night.json']);
  const withCss = { ...texts, 'themes/night.css': '#box { outline: 1px solid red }' };
  const listed = { files: Object.keys(withCss).map(path => ({ path, mtime: 1 })), dirs: [], text: p => withCss[p] ?? null };
  assert.deepEqual(projectFromListing(listed).themeSheets, { night: '#box { outline: 1px solid red }' }, 'the editor gets the raw stylesheet');
  assert.deepEqual(projectFromListing(listing).themeSheets, {});
});

test('theme checks: bad colors and missing ui images are reported; asset renames follow theme files', () => {
  const msgs = checkGame({ theme: { accent: 'tealish', textbox: { image: 'gone', background: 'url(x)' }, skins: { a: { namebox: { border: 'blu' } } } } },
    { files: ['ui/box.png'], rigs: {}, blips: [], skins: ['a'] }, '').map(d => d.message);
  assert.equal(msgs.filter(m => /theme\./.test(m)).length, 4, msgs.join('\n'));
  const text = '{"extends":"base","components":{"textbox":{"image":"box"}},"styles":{"a":{"textbox":{"image":"box"}}},"textbox":{"image":"box"},"tokens":{"font":"box"}}';
  const res = renameAssetRefs([{ name: 'themes/night.json', text }], 'assets/ui/box.png', 'assets/ui/frame.png');
  assert.equal(res.edits.length, 3);
  assert.ok(res.edits.every(e => e.text === 'frame'));
});

test('a new project gets themes/default.json and names it in game.json', () => {
  const files = newProjectFiles({ title: 'T', engineVersion: '0.2.1', kind: 'studio' });
  assert.equal(JSON.parse(files['game.json']).theme, 'default');
  assert.equal(JSON.parse(files['themes/default.json']).tokens.accent, '#5fd1c3');
});

test('theme components: tokens and button/panel/tab/toast looks with variants and states', () => {
  const theme = resolveTheme({
    tokens: { accent: '#e0a050', surface: '#201810', danger: 'nope', text: 'red; } x {' },
    components: {
      button: { radius: 2, hover: { border: '#fff' }, disabled: { opacity: 0.2 } },
      'button.primary': { background: '#e0a050', color: '#111', hover: { background: '#f0b060' } },
      tab: { selected: { background: 'rgba(224,160,80,.15)' } },
      toast: { shadow: '0 2px 4px #000' },
      'button.huge': { radius: 99 }, nope: { radius: 1 },
    },
  }, {});
  const css = themeCss(theme);
  assert.match(css, /#stage \{[^}]*--vn-surface: #201810/);
  assert.doesNotMatch(css, /--vn-danger|--vn-text|huge|nope|99px/);
  assert.match(css, /#stage \.screen button, #stage \.screen select, #stage \.sc-btn:not\(#quickui \.sc-btn\) \{ border-radius: 2px; \}/);
  assert.match(css, /#stage \.screen button:hover:not\(:disabled\)[^{]*\{ border-color: #fff; \}/);
  assert.match(css, /#stage \.screen button:disabled[^{]*\{ opacity: 0\.2; \}/);
  assert.match(css, /#stage \.screen button\[data-variant="primary"\][^{]*\{ background: #e0a050; color: #111; \}/);
  assert.ok(css.indexOf('border-radius: 2px') < css.indexOf('data-variant="primary"'), 'variants come after their component');
  assert.match(css, /#stage \.sc-btn\[role="tab"\]\[aria-selected="true"\] \{ background: rgba\(224,160,80,\.15\); \}/);
  assert.match(css, /#stage #toast, #stage #achtoastui \.sc-panel \{ box-shadow: 0 2px 4px #000; \}/);
});

test('theme components: field and quickmenu', () => {
  const css = themeCss(resolveTheme({ components: { field: { border: '#fff' }, quickmenu: { selected: { color: '#f00' } } } }, {}));
  assert.match(css, /#stage #menu input, #stage \.save-name input \{ border-color: #fff; \}/);
  assert.match(css, /#stage #quickui \.sc-btn\[aria-pressed="true"\] \{ color: #f00; \}/);
});

test('theme components: slider, title and choice states', () => {
  const css = themeCss(resolveTheme({ components: {
    slider: { color: '#f80', size: 40 }, title: { color: '#eee', size: 130 },
    choice: { hover: { border: '#fff' }, disabled: { opacity: 0.3 } },
  } }, {}));
  assert.match(css, /#stage \.sc-slider \{ accent-color: #f80; height: 40px; \}/);
  assert.match(css, /#stage \.sc-text\[data-style="title"\] \{ color: #eee; font-size: 130px; \}/);
  assert.match(css, /#stage #menu button:hover:not\(\[aria-disabled="true"\]\) \{ border-color: #fff; \}/);
  assert.match(css, /#stage #menu button\[aria-disabled="true"\] \{ opacity: 0\.3; \}/);
});

test('theme tokens: gap, uiSize and uiFont become variables', () => {
  const css = themeCss(resolveTheme({ tokens: { borderWidth: 3, gap: 24, uiSize: 36, uiFont: 'Lora', radius: 4 } }, {}));
  assert.match(css, /--vn-border-width: 3px;/);
  assert.match(css, /--vn-gap: 24px;/);
  assert.match(css, /--vn-ui-size: 36px;/);
  assert.match(css, /--vn-ui-font: "Lora", /);
  assert.doesNotMatch(themeCss(resolveTheme({ tokens: { gap: -1, uiSize: 0 } }, {})), /--vn-gap|--vn-ui-size/);
});

test('theme screens: a component override scoped to one built-in screen', () => {
  const css = themeCss(resolveTheme({ screens: { options: { panel: { width: 1300 }, 'button.primary': { color: '#000' }, nope: { width: 1 } }, bogus: { panel: { width: 5 } } } }, {}));
  assert.match(css, /#stage #options \.panel \{ width: 1300px; \}/);
  assert.match(css, /#stage #options button\[data-variant="primary"\][^{]*\{ color: #000; \}/);
  assert.doesNotMatch(css, /bogus|5px|nope/);
});

test('theme token radius reaches the stage as --vn-radius; a negative one is left out', () => {
  assert.match(themeCss(resolveTheme({ tokens: { radius: 2 } }, {})), /#stage \{ --vn-radius: 2px; \}/);
  assert.doesNotMatch(themeCss(resolveTheme({ tokens: { radius: -1 } }, {})), /--vn-radius/);
});

test('theme tokens.fonts: a font per language through :lang(); bad codes and fonts are dropped', () => {
  const css = themeCss(resolveTheme({ tokens: { font: 'Lora', fonts: { ja: 'Noto Sans JP', 'zh-Hans': 'Noto "Sans" SC', 'x){y': 'Evil', fi: 'a; } b' } } }, {}));
  assert.match(css, /#stage:lang\(ja\) \{ --vn-font: "Noto Sans JP", [^}]*--vn-ui-font: "Noto Sans JP"/);
  assert.match(css, /#stage:lang\(zh-Hans\) \{[^}]*"Noto Sans SC"/);
  assert.doesNotMatch(css, /Evil|x\)|b;/);
  assert.equal(resolveTheme({ tokens: { fonts: 'ja' } }, {}).tokens, undefined, 'a non-object is ignored');
});

test('theme panel: set, remove and trace values in a theme file', async () => {
  const { setThemeValue, getThemeValue, themeValueSource, componentStates, componentKeys, componentFields } = await import('../../dist/engine/src/index.js');
  const text = setThemeValue('{"extends":"base"}', ['components', 'button', 'hover', 'border'], '#fff');
  assert.deepEqual(JSON.parse(text), { extends: 'base', components: { button: { hover: { border: '#fff' } } } });
  assert.equal(getThemeValue(JSON.parse(text), ['components', 'button', 'hover', 'border']), '#fff');
  assert.deepEqual(JSON.parse(setThemeValue(text, ['components', 'button', 'hover', 'border'], undefined)), { extends: 'base' }, 'empty parents go');
  assert.equal(setThemeValue('{ nope', ['tokens', 'gap'], 1), null);
  assert.equal(setThemeValue('{}', ['tokens', '__proto__', 'x'], undefined), '{}', 'removing what is not there changes nothing');
  const files = { night: { extends: 'base', tokens: { accent: '#111' } }, dusk: { extends: 'night', tokens: { gap: 4 } } };
  assert.deepEqual(themeValueSource('dusk', ['tokens', 'accent'], files), { value: '#111', from: 'night' });
  assert.deepEqual(themeValueSource('dusk', ['tokens', 'gap'], files), { value: 4, from: 'dusk' });
  assert.deepEqual(themeValueSource('dusk', ['tokens', 'warn'], files), { value: undefined, from: null });
  assert.ok(componentKeys().includes('button.primary') && componentStates('tab').includes('selected') && !componentStates('panel').includes('selected'));
  assert.deepEqual(componentFields('row', 'selected')[0].path, ['components', 'row', 'selected', 'background']);
  // The in-game text parts have their own fields; only the choice has states.
  assert.ok(['textbox', 'namebox', 'text', 'choice'].every(k => componentKeys().includes(k)));
  assert.deepEqual(componentStates('text'), ['']);
  assert.deepEqual(componentStates('choice'), ['', 'hover', 'focus', 'disabled']);
  assert.deepEqual(componentFields('text').map(f => f.label), ['size', 'color', 'lineHeight', 'lines']);
  assert.deepEqual(componentFields('choice', 'hover')[0].path, ['components', 'choice', 'hover', 'background']);
});

test('contrast: WCAG ratios, translucent colors, unparsable colors', async () => {
  const { contrast, parseColor } = await import('../../dist/engine/src/index.js');
  assert.equal(Math.round(contrast('#000', '#fff') * 10) / 10, 21);
  assert.equal(contrast('#777', '#777'), 1);
  assert.ok(contrast('rgba(255,255,255,.5)', '#000') < contrast('#fff', '#000'), 'a translucent text color is mixed over the background');
  assert.equal(contrast('color-mix(in oklab, #fff, #000)', '#000'), undefined, 'other color spaces are not parsed');
  assert.equal(contrast('oklch(0.5 0.1 200)', '#000'), undefined);
  assert.deepEqual(parseColor('hsl(0 100% 50%)'), { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('hsla(120, 100%, 25%, .5)').a, 0.5);
  assert.deepEqual(parseColor('hwb(0 0% 0%)'), { r: 1, g: 0, b: 0, a: 1 });
  const grey = parseColor('hwb(0 50% 50%)');
  assert.ok(Math.abs(grey.r - 0.5) < 1e-9 && Math.abs(grey.g - 0.5) < 1e-9);
  const m = parseColor('color-mix(in srgb, #fff, #000)');
  assert.ok(Math.abs(m.r - 0.5) < 1e-9 && m.a === 1);
  assert.ok(Math.abs(parseColor('color-mix(in srgb, #fff 25%, rgb(0 0 0))').g - 0.25) < 1e-9);
  assert.deepEqual(parseColor('RebeccaPurple'), parseColor('#663399'));
  assert.deepEqual(parseColor('darkslategrey'), parseColor('#2f4f4f'), 'grey spells like gray');
  assert.equal(parseColor('color-mix(in srgb, red, #000)').r, 0.5);
  assert.equal(parseColor('blu'), undefined);
  assert.deepEqual(parseColor('rgb(255 0 0 / 50%)'), { r: 1, g: 0, b: 0, a: 0.5 });
  assert.equal(parseColor('rgb(1,2)'), undefined);
});

test('font notes: project and common system fonts are fine, others warn', async () => {
  const { fontNote, COMMON_FONTS } = await import('../../dist/engine/src/index.js');
  assert.ok(COMMON_FONTS.includes('Georgia'));
  assert.equal(fontNote('', []), null);
  assert.equal(fontNote('Georgia', []), null);
  assert.equal(fontNote('Lora', ['Lora']), null);
  assert.match(fontNote('Comic Neue', ['Lora']), /"Comic Neue" is not in assets\/fonts\//);
});

test('theme panel: contrast notes for tokens and components', async () => {
  const { contrastNote, themeValueSource } = await import('../../dist/engine/src/index.js');
  const files = { t: { tokens: { surface: '#ffffff' }, components: { tab: { color: '#eeeeee', selected: { background: '#222222' } }, slider: { color: '#fff' } } } };
  const get = p => themeValueSource('t', p, files).value;
  assert.match(contrastNote(['tokens', 'text'], get), /^Contrast 1\.\d:1 with surface \(aim for 4\.5:1\)$/, 'default light text on a white surface');
  assert.match(contrastNote(['tokens', 'surface'], get), /text color/);
  assert.equal(contrastNote(['tokens', 'radius'], get), null);
  const box = o => p => o[p.join('.')];
  assert.match(contrastNote(['components', 'text', 'color'], box({ 'components.text.color': '#111111' })), /^Contrast 1\.\d:1 with the box behind it/, 'dark text on the default dark text box');
  assert.equal(contrastNote(['components', 'text', 'color'], box({ 'components.text.color': '#111111', 'components.textbox.background': '#ffffff' })), null);
  assert.match(contrastNote(['components', 'textbox', 'background'], box({ 'components.textbox.background': '#ffffff', 'tokens.text': '#ffffff' })), /with its text color/);
  assert.match(contrastNote(['components', 'namebox', 'background'], box({ 'components.namebox.background': '#ffffff' })), /with its text color/);
  assert.match(contrastNote(['components', 'tab', 'color'], get), /with its background/);
  assert.equal(contrastNote(['components', 'tab', 'selected', 'background'], get), null, 'selected state: the resting light text on a dark selected background is fine');
  assert.match(contrastNote(['components', 'tab', 'selected', 'background'], p => (p.join('.') === 'components.tab.selected.background' ? '#eeeeee' : get(p))), /with its text color/);
  assert.equal(contrastNote(['components', 'slider', 'color'], get), null, 'a slider color is not text');
  assert.equal(contrastNote(['components', 'row', 'color'], get), null, 'unset fields have no note');
  assert.match(contrastNote(['tokens', 'text'], p => (p[1] === 'text' ? '#000' : undefined)), /^Contrast 1\.\d:1/, 'black text on the default dark surface');
});

test('token references: $name is the token, $name/N its color at N% opacity; unset tokens drop the value', () => {
  const css = themeCss(resolveTheme({
    tokens: { accent: '#ff0000', surface: 'rgb(0, 0, 255)' },
    components: { button: { hover: { border: '$accent' } }, tab: { selected: { background: '$accent/50' } }, panel: { background: '$danger' } },
  }, {}));
  assert.match(css, /border-color: #ff0000/);
  assert.match(css, /background: #ff000080/);
  assert.doesNotMatch(css, /\$/);
  const problems = checkGame({ theme: { accent: '#ff0000', textbox: { background: '$accent' }, namebox: { background: '$nope' } } }, { files: [] }).map(p => p.message);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /namebox\.background/);
});
