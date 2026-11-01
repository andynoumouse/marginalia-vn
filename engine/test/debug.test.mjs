import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDebugCommand, formatDebugValue, RESET_TARGETS } from '../../dist/engine/src/index.js';

const p = parseDebugCommand;

test('blank input is no command', () => {
  assert.equal(p(''), null);
  assert.equal(p('   '), null);
});

test('commands without arguments', () => {
  for (const c of ['help', 'clear', 'vars', 'labels', 'flags', 'persistent']) assert.deepEqual(p(c), { cmd: c });
  assert.equal(p('vars x').cmd, 'error');
});

test('set takes a name and an expression', () => {
  assert.deepEqual(p('set trust = 3'), { cmd: 'set', name: 'trust', expr: '3' });
  assert.deepEqual(p('set persistent.deaths=trust + 1'), { cmd: 'set', name: 'persistent.deaths', expr: 'trust + 1' });
  assert.equal(p('set trust').cmd, 'error');
  assert.equal(p('set 9x = 1').cmd, 'error');
  assert.equal(p('set a = 1 +').cmd, 'error');
});

test('jump, unlock and lock', () => {
  assert.deepEqual(p('jump town_square'), { cmd: 'jump', label: 'town_square' });
  assert.equal(p('jump').cmd, 'error');
  assert.deepEqual(p('unlock good_ending'), { cmd: 'unlock', flag: 'good_ending' });
  assert.deepEqual(p('lock good_ending'), { cmd: 'lock', flag: 'good_ending' });
  assert.equal(p('unlock').cmd, 'error');
});

test('reset takes targets and groups, in a fixed order, without repeats', () => {
  assert.deepEqual(p('reset gallery'), { cmd: 'reset', targets: ['gallery'] });
  assert.deepEqual(p('reset seen gallery gallery'), { cmd: 'reset', targets: ['gallery', 'seen'] });
  assert.deepEqual(p('reset all').targets, [...RESET_TARGETS]);
  assert.ok(!p('reset progress').targets.includes('saves'));
  assert.equal(p('reset progress').targets.length, RESET_TARGETS.length - 1);
  assert.equal(p('reset').cmd, 'error');
  assert.equal(p('reset nothing').cmd, 'error');
});

test('anything else is an expression, or an error that says so', () => {
  assert.deepEqual(p('trust + 1'), { cmd: 'eval', expr: 'trust + 1' });
  const bad = p('frobnicate the thing');
  assert.equal(bad.cmd, 'error');
  assert.match(bad.message, /Unknown command "frobnicate"/);
});

test('values print like script values', () => {
  assert.equal(formatDebugValue(3), '3');
  assert.equal(formatDebugValue('hi'), '"hi"');
  assert.equal(formatDebugValue(true), 'true');
  assert.equal(formatDebugValue(['a', 2]), '["a", 2]');
});
