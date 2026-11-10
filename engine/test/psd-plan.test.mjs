import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCharacter, prefixFrom, scriptName } from '../../tools/psd-plan.mjs';

const layer = (name, extra = {}) => ({ name, left: 0, top: 0, right: 1, bottom: 1, ...extra });
const group = (name, children, extra = {}) => ({ name, children, ...extra });
const plan = (top, opts) => {
  const warnings = [];
  return { entries: planCharacter(top, { ...opts, warn: m => warnings.push(m) }), warnings };
};
const shape = entries => entries.map(e => (e.type === 'part' ? `part:${e.name}` : `slot:${e.slot}`));

test('psd plan: top-level groups are slots, layers are parts, bottom to top', () => {
  const { entries } = plan([layer('body'), group('eyes', [layer('closed', { hidden: true }), layer('open')]), layer('hair')]);
  assert.deepEqual(shape(entries), ['part:body', 'slot:eyes', 'part:hair']);
});

test('psd plan: a slot defaults to its top visible child and keeps pose aliases', () => {
  const { entries } = plan([group('eyes', [layer('closed'), layer('open, neutral'), layer('wide', { hidden: true })])]);
  const eyes = entries[0];
  assert.equal(eyes.default, 'open');
  assert.deepEqual(eyes.variants.map(v => v.name), ['wide', 'open', 'closed']);
  assert.deepEqual(eyes.variants[1].aliases, ['neutral']);
});

test('psd plan: a + group is not a slot and its layers stay in place', () => {
  const { entries, warnings } = plan([
    layer('body'),
    group('+arms', [layer('sleeve'), group('glove', [layer('x')])]),
    layer('hair'),
  ]);
  assert.deepEqual(shape(entries), ['part:body', 'part:sleeve', 'slot:glove', 'part:hair']);
  assert.deepEqual(warnings, []);
});

test('psd plan: + folders nest, and hidden or _ folders are skipped', () => {
  const { entries } = plan([
    group('+a', [group('+b', [layer('deep')])]),
    group('+off', [layer('gone')], { hidden: true }),
    group('_notes', [layer('sketch')]),
  ]);
  assert.deepEqual(shape(entries), ['part:deep']);
});

test('psd plan: the prefix is configurable and "" turns folders off', () => {
  const top = [group('~shell', [layer('inner')])];
  assert.deepEqual(shape(plan(top, { prefix: '~' }).entries), ['part:inner']);
  assert.deepEqual(shape(plan(top, { prefix: '+' }).entries), ['slot:shell'], 'a slot, named as scripts can say it');
  assert.deepEqual(shape(plan([group('+x', [layer('a')])], { prefix: '' }).entries), ['slot:x']);
});

test('psd plan: clipped layers join their base, also inside a folder', () => {
  const { entries } = plan([group('+f', [layer('base'), layer('shade', { clipping: true })])]);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].layers.map(l => l.name), ['base', 'shade']);
});

test('psd plan: two layers that write one image warn', () => {
  const { warnings } = plan([layer('shading'), group('+f', [layer('shading')])]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /shading/);
});

test('psd plan: a variant name scripts cannot say is renamed, a duplicate warns and is skipped', () => {
  const { entries, warnings } = plan([group('eyes', [layer('open'), layer('open'), layer('bad name!')])]);
  assert.deepEqual(entries[0].variants.map(v => v.name), ['bad_name', 'open']);
  assert.equal(warnings.length, 2);
});

test('psd plan: prefixFrom reads game.json', () => {
  assert.equal(prefixFrom({}), '+');
  assert.equal(prefixFrom(undefined), '+');
  assert.equal(prefixFrom({ psdPrefix: '~' }), '~');
  assert.equal(prefixFrom({ psdPrefix: '' }), '');
});

test('psd plan: a + folder names the group of what it holds, nested folders make a path', () => {
  const { entries } = plan([
    layer('body'),
    group('+head', [layer('face'), group('eyes', [layer('open')]), group('+  hat ', [layer('brim')])]),
    group('+arm', [group('+forearm', [layer('hand')])]),
  ]);
  assert.deepEqual(entries.map(e => [e.type === 'part' ? e.name : e.slot, e.group]), [
    ['body', undefined], ['face', 'head'], ['eyes', 'head'], ['brim', 'head/hat'], ['hand', 'arm/forearm'],
  ]);
});

test('psd plan: Photoshop default names become script names, so a "Group 1" keeps its layers (ES-8)', () => {
  assert.equal(scriptName('Group 1'), 'Group_1');
  assert.equal(scriptName('Layer 2 copy'), 'Layer_2_copy');
  assert.equal(scriptName(' (eyes) '), 'eyes');
  assert.equal(scriptName('1st'), '_1st');
  assert.equal(scriptName('目'), '');
  const { entries, warnings } = plan([group('Group 1', [layer('Layer 3')])]);
  assert.deepEqual(entries.map(e => [e.slot, e.variants.map(v => v.name)]), [['Group_1', ['Layer_3']]], 'the slot and its variant, renamed');
  assert.ok(warnings.some(w => /"Group 1" is called "Group_1"/.test(w)) && warnings.some(w => /"Layer 3" in "Group_1" is called "Layer_3"/.test(w)));
  const odd = plan([group('目', [layer('a')]), group('eyes', [layer('閉'), layer('open')])]);
  assert.deepEqual(shape(odd.entries), ['slot:eyes'], 'a group with no usable name is skipped');
  assert.deepEqual(odd.entries[0].variants.map(v => v.name), ['open'], 'and so is such a variant');
  assert.equal(odd.warnings.filter(w => /no letters or digits/.test(w)).length, 2);
});
