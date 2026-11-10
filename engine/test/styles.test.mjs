import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, assignIds, existingIds, resolveScreen, interpolate, checkAssets, themeCss, resolveTheme, getCompletions } from '../../dist/engine/src/index.js';
import { errors } from './helpers.mjs';

const fromFile = theme => resolveTheme('t', { t: theme });

const build = text => compile([{ file: 't.vn', text }]);

const script = [
  'define alice "Alice" color=#ff6fa5 style=soft',
  'label start:',
  '  alice: "Hush." style=whisper #aa01',
  '  alice: "Plain."',
  '  "Narration." style=whisper #aa02',
  '  menu "Quick!" #pr01 style=urgent timeout 5s:',
  '    "Run" #op01:',
  '      jump out',
  '    on timeout:',
  '      jump out',
  'label out:',
  '  menu:',
  '    "Stay" #op02:',
  '      end',
].join('\n');

test('style= on a line, a menu and a define reaches the renderer', async () => {
  const p = build(script);
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  await new Runtime(p, r).start();
  assert.deepEqual(r.says.map(s => s.look), ['whisper', undefined, 'whisper']);
  assert.equal(r.says[0].style.box, 'soft', 'the speaker keeps its own style');
  assert.deepEqual(r.menuStyles, ['urgent', null]);
  assert.equal(p.strings.aa01, '"Hush."', 'the style is not part of the text');
});

test('style= does not disturb ids: assignIds keeps it before the new id', () => {
  const text = 'label start:\n  alice: "Hi" style=whisper\n  "Hmm" style=soft\n  menu "Q" style=urgent timeout 3s:\n    "A":\n      end\n    on timeout:\n      end\n';
  const out = assignIds(text, existingIds([text]), () => 0.5).text.split('\n');
  assert.match(out[1], /^  alice: "Hi" style=whisper #\w{4,8}$/);
  assert.match(out[2], /^  "Hmm" style=soft #\w{4,8}$/);
  assert.match(out[3], /^  menu "Q" #\w{4,8} style=urgent timeout 3s:$/);
  assert.deepEqual(existingIds([out.join('\n')]).size, 3 + 1); // three lines, plus the option
});

test('define accepts style=', () => {
  const p = build('define a "A" style=one\ndefine c "C" style=a-b\nlabel start:\n  end\n');
  assert.equal(p.characters.a.style.box, 'one');
  assert.ok(p.diagnostics.some(d => /style= needs a style name/.test(d.message)));
});

test('style= on screen buttons and texts; other elements refuse it', () => {
  const p = build([
    'screen s:',
    '  text at 10,10 "Hi" style=big',
    '  button go at 20,20 "Go" style=urgent',
    '  default go',
    'label start:',
    '  end',
  ].join('\n'));
  assert.deepEqual(errors(p), []);
  const v = resolveScreen(p.screens.s, {}, { items: {}, text: (_id, raw, vars) => interpolate(raw, vars) });
  assert.equal(v.parts.find(x => x.kind === 'text').style, 'big');
  assert.equal(v.parts.find(x => x.kind === 'button').style, 'urgent');
  const bad = build('screen s:\n  hotspot h at 0,0 size 5,5 "H" style=x\n  button b at 1,1 "B" style=\nlabel start:\n  end\n');
  assert.ok(errors(bad).some(m => /style= goes on a button or a text, not on hotspot/.test(m)));
  assert.ok(errors(bad).some(m => /style= needs a style name/.test(m)));
});

test('an unknown style is reported by the asset check, a known one is not', () => {
  const p = build(script.replace('style=soft', 'style=whisper') + '\nscreen s:\n  button go at 20,20 "Go" style=nope\n  default go\n');
  const msgs = idx => checkAssets(p, { files: [], ...idx }).map(d => d.message).filter(m => m.startsWith('No style'));
  assert.deepEqual(msgs({ skins: ['whisper', 'urgent'] }), ['No style "nope" (add it to the theme\'s styles)']);
  assert.equal(msgs({}).length, 5, 'whisper three times, urgent and nope');
});

test('a style missing from a theme the player can pick is reported', () => {
  const p = build(script.replace('style=soft', 'style=whisper') + '\nscreen s:\n  button go at 20,20 "Go" style=nope\n  default go\n');
  const msgs = idx => checkAssets(p, { files: [], ...idx }).map(d => d.message).filter(m => m.startsWith('Style '));
  const skins = ['whisper', 'urgent', 'nope'];
  assert.deepEqual(msgs({ skins, themeSkins: { paper: skins, bare: ['urgent'] } }).filter((m, i, a) => a.indexOf(m) === i).sort(),
    ['Style "nope" is missing from the selectable theme bare', 'Style "whisper" is missing from the selectable theme bare']);
  assert.deepEqual(msgs({ skins, themeSkins: { paper: skins } }), []);
});

test('a style gives menu, button and text rules without placement', () => {
  const theme = fromFile({
    styles: {
      urgent: {
        choice: { background: '#400', width: 900, hover: { background: '#600' } },
        button: { background: '#a00', width: 300, hover: { background: '#c00' } },
        text: { color: '#fcc', size: 30 },
        textbox: { x: 5, y: 5, width: 700, background: '#111' },
      },
    },
  }, {});
  const css = themeCss(theme);
  assert.match(css, /#stage #menu\[data-style="urgent"\] button \{[^}]*background: [^;]*#400/);
  assert.match(css, /#stage #menu\[data-style="urgent"\] button:hover:not\(\[aria-disabled="true"\]\) \{[^}]*#600/);
  assert.match(css, /#stage \.sc-btn\[data-style="urgent"\] \{[^}]*background: #a00/);
  assert.match(css, /#stage \.sc-btn\[data-style="urgent"\]:hover:not\(:disabled\) \{[^}]*#c00/);
  assert.match(css, /#stage \.sc-text\[data-style="urgent"\] \{[^}]*color: #fcc[^}]*font-size: 30px/);
  assert.match(css, /#stage\[data-skin="urgent"\] #box \{[^}]*background/);
  assert.doesNotMatch(css, /\[data-(skin|style)="urgent"\][^{]*\{[^}]*(width|left|top):/, 'placement is dropped from styles');
});

test('completions offer style= on menu, button and text', () => {
  const p = build('label start:\n  end\n');
  const labels = (line) => getCompletions(p, line).map(c => c.label);
  assert.ok(labels('  menu "Q" ').includes('style='));
  assert.ok(labels('  button go ').includes('style='));
  assert.ok(labels('  text at 1,1 ').includes('style='));
});
