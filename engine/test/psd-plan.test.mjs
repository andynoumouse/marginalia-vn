import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCharacter, prefixFrom } from '../../tools/psd-plan.mjs';

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
  assert.deepEqual(shape(plan(top, { prefix: '+' }).entries), ['slot:~shell']);
  assert.deepEqual(shape(plan([group('+x', [layer('a')])], { prefix: '' }).entries), ['slot:+x']);
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

test('psd plan: invalid or duplicate variant names warn and are skipped', () => {
  const { entries, warnings } = plan([group('eyes', [layer('open'), layer('open'), layer('bad name!')])]);
  assert.deepEqual(entries[0].variants.map(v => v.name), ['open']);
  assert.equal(warnings.length, 2);
});

test('psd plan: prefixFrom reads game.json', () => {
  assert.equal(prefixFrom({}), '+');
  assert.equal(prefixFrom(undefined), '+');
  assert.equal(prefixFrom({ psdPrefix: '~' }), '~');
  assert.equal(prefixFrom({ psdPrefix: '' }), '');
});
