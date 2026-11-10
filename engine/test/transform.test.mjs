import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMS, addOffset, scaleOffset, NO_OFFSET, autoAnimations, checkAssets, compile, parseTransformLine, transformToAnim, checkTransform, resolveAnim, resolveTransform, Runtime, NullRenderer } from '../../dist/engine/src/index.js';
import { errors } from './helpers.mjs';

const src = { file: 't.vn', line: 1 };
const def = (steps, repeat = null) => ({ name: 'tf', src, steps: steps.map(s => parseTransformLine(s, src)), repeat });

test('a step line: tween fields, seconds and ease in any order', () => {
  assert.deepEqual(parseTransformLine('rot=-2 0.15s ease=out', src), { kind: 'tween', rot: -2, dur: 0.15, ease: 'out', src });
  assert.deepEqual(parseTransformLine('0.4s alpha=0.5 scale=1.1', src), { kind: 'tween', alpha: 0.5, scale: 1.1, dur: 0.4, ease: null, src });
  assert.deepEqual(parseTransformLine('wait 0.3s', src), { kind: 'wait', dur: 0.3, src });
  assert.deepEqual(parseTransformLine('repeat', src), { repeat: 'forever' });
  assert.deepEqual(parseTransformLine('repeat 3', src), { repeat: 3 });
});

test('bad step lines say what is wrong', () => {
  for (const [line, re] of [['0.4', /needs its unit: write 0.4s/], ['0.4s ease=out', /A transform step is/], ['rot=2+ 1', /rot=2\+/], ['rot=1 ease=zig', /Unknown ease/], ['spin=1', /Unknown property/], ['wait', /Use: wait/], ['repeat 0', /Use: repeat/], ['rot=1 1s 2s', /A transform step is/], ['rot=1 1', /needs its unit/], ['wait 1', /needs its unit/]]) {
    assert.throws(() => parseTransformLine(line, src), re, line);
  }
});

test('a transform compiles to keys that hold across a wait and ease into each tween', () => {
  const anim = transformToAnim(def(['rot=-2 0.2s', 'wait 0.2s', 'rot=2 0.2s ease=out', 'rot=0 0.4s']));
  assert.equal(anim.dur, 1);
  assert.deepEqual(anim.keys, [{ t: 0.2, rot: -2 }, { t: 0.4, ease: 'linear', rot: -2 }, { t: 0.6, ease: 'out', rot: 2 }, { t: 1, rot: 0 }]);
  const fn = resolveAnim('tf', { tf: anim }).fn;
  assert.equal(fn(0.3).rot, -2); // held through the wait
  assert.equal(fn(1).rot, 0);
});

test('scale is written as a size (1 = as is) and alpha as a factor; unnamed channels stay out of the keys', () => {
  const anim = transformToAnim(def(['scale=1.1 alpha=0.5 0.5s']));
  assert.deepEqual(anim.keys, [{ t: 1, scale: 0.1 }, { t: 1, opacity: 0.5 }]); // one key per channel point
  assert.equal(anim.keys.some(k => Object.hasOwn(k, 'rot')), false);
});

test('repeat n unrolls the steps; the channels carry over from one round to the next', () => {
  const anim = transformToAnim(def(['x=0.02 0.1s', 'x=-0.02 0.1s'], 2));
  assert.equal(anim.dur, 0.4);
  assert.deepEqual(anim.keys.map(k => [k.t, k.x]), [[0.25, 0.02], [0.5, -0.02], [0.75, 0.02], [1, -0.02]]);
});

test('checks: nothing to do, no time, and a forever loop that ends away from rest', () => {
  assert.match(checkTransform(def([]))[0].message, /no steps/);
  assert.match(checkTransform(def(['rot=3']))[0].message, /takes no time/);
  const away = checkTransform(def(['rot=3 0.5s'], 'forever'));
  assert.equal(away[0].severity, 'warning');
  assert.match(away[0].message, /rot away from rest/);
  assert.deepEqual(checkTransform(def(['rot=3 0.5s', 'rot=0 0.5s'], 'forever')), []);
});

test('compile: transforms reach the program; a repeat-forever one loops under a plain animate; misuse is reported', async () => {
  const text = [
    'transform nervous:', '    rot=-2 0.15s', '    rot=2 0.3s', '    rot=0 0.15s', '',
    'transform pace:', '    x=0.05 1s', '    x=0 1s', '    repeat', '',
    'define alice "Alice"',
    'label start:', '  scene a', '  show alice',
    '  animate alice nervous', '  animate alice pace', '  image show lamp prop/lamp', '  animate lamp nervous loop', '',
  ].join('\n');
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(errors(p), []);
  assert.deepEqual(Object.keys(p.transforms), ['nervous', 'pace']);
  const anims = p.ops.filter(o => o.op === 'animate');
  assert.deepEqual(anims.map(o => [o.char, o.name, o.loop]), [['alice', 'nervous', false], ['alice', 'pace', true], ['lamp', 'nervous', true]]);

  const twice = compile([{ file: 't.vn', text: 'transform a:\n    x=1 1s\ntransform a:\n    x=1 1s\nlabel start:\n  "hi"\n' }]);
  assert.ok(errors(twice).some(m => /defined twice/.test(m)));
  const bad = compile([{ file: 't.vn', text: 'transform a:\n    rot=1 1s\n    repeat\n    x=1 1\nlabel start:\n  "hi"\n' }]);
  assert.ok(errors(bad).some(m => /repeat must be the last line/.test(m)));
  const shadow = compile([{ file: 't.vn', text: 'transform sway:\n    rot=5 1s\nlabel start:\n  "hi"\n' }]);
  assert.ok(shadow.diagnostics.some(d => d.severity === 'warning' && /name of a preset/.test(d.message)));
});

test('runtime hands the transforms to the renderer, at construction and when the program is replaced', () => {
  const p = compile([{ file: 't.vn', text: 'transform a:\n    x=1 1s\nlabel start:\n  "hi"\n' }]);
  const seen = [];
  const r = new NullRenderer();
  r.setTransforms = t => seen.push(Object.keys(t));
  const rt = new Runtime(p, r);
  rt.setProgram(compile([{ file: 't.vn', text: 'label start:\n  "hi"\n' }]));
  assert.deepEqual(seen, [['a'], []]);
});

const blockOf = (text, ctx) => { // a parallel step from its branches, each a list of step lines
  return { kind: 'parallel', src, branches: text.map(lines => lines.map(l => parseTransformLine(l, src))) };
};

test('parallel: branches start together, each channel keeps its own track, and the step takes the longest branch', () => {
  const d = { name: 'tf', src, repeat: null, steps: [blockOf([['x=0.1 1s'], ['rot=10 0.4s', 'wait 0.1s', 'rot=0 0.2s']]), parseTransformLine('y=-0.05 0.5s', src)] };
  const anim = transformToAnim(d);
  assert.equal(anim.dur, 1.5);
  const at = (ch, t) => resolveAnim('tf', { tf: anim }).fn(t / 1.5)[{ x: 'dx', y: 'dy', rot: 'rot' }[ch]];
  assert.ok(Math.abs(at('x', 1) - 0.1) < 1e-9, 'x arrives when the longest branch ends');
  assert.ok(Math.abs(at('rot', 0.4) - 10) < 1e-9, 'rot is at its peak when its first tween ends');
  assert.ok(Math.abs(at('rot', 0.5) - 10) < 1e-9, 'and holds through its wait');
  assert.ok(Math.abs(at('rot', 0.7)) < 1e-9, 'and is back at rest after the second tween, while x is still moving');
  assert.ok(Math.abs(at('x', 1.5) - 0.1) < 1e-9, 'x holds after its branch for the steps that follow');
  assert.ok(Math.abs(at('y', 1.5) + 0.05) < 1e-9, 'the step after the block starts when the block ends');
  assert.ok(Math.abs(at('y', 1)) < 1e-9);
});

test('parallel: two branches moving one channel is an error, and a forever loop that ends away from rest is warned about across branches', () => {
  const clash = { name: 'tf', src, repeat: null, steps: [blockOf([['x=1 1s'], ['x=2 1s']])] };
  assert.match(checkTransform(clash).find(d => d.severity === 'error').message, /x is moved by two branches/);
  const away = { name: 'tf', src, repeat: 'forever', steps: [blockOf([['x=1 1s'], ['rot=3 1s']])] };
  assert.match(checkTransform(away)[0].message, /x, rot away from rest/);
});

test('parallel: the script syntax, one branch per parallel: block, consecutive blocks are one step', () => {
  const text = [
    'transform entrance:', '    parallel:', '        x=0.1 0.5s ease=out', '    parallel:', '        alpha=0.5 0.2s', '        alpha=1 0.3s', '    wait 0.2s', '    x=0 0.3s', '',
    'label start:', '  "hi"', '',
  ].join('\n');
  const p = compile([{ file: 't.vn', text }]);
  assert.deepEqual(errors(p), []);
  const anim = p.transforms.entrance;
  assert.equal(anim.dur, 1);
  assert.deepEqual(anim.keys.filter(k => k.x !== undefined).map(k => [k.t, k.x]), [[0.5, 0.1], [0.7, 0.1], [1, 0]]);
  assert.deepEqual(anim.keys.filter(k => k.opacity !== undefined).map(k => [k.t, k.opacity]), [[0.2, 0.5], [0.5, 1], [1, 1]]);

  const script = (...lines) => compile([{ file: 't.vn', text: lines.join(String.fromCharCode(10)) }]);
  const tail = ['label start:', '  "hi"', ''];
  const stray = script('transform a:', '    x=1 1s', '        x=2 1s', ...tail);
  assert.ok(errors(stray).some(m => /indent only under parallel/.test(m)), JSON.stringify(stray.diagnostics));
  const inner = script('transform a:', '    parallel:', '        x=1 1s', '        repeat', ...tail);
  assert.ok(errors(inner).some(m => /not inside a block/.test(m)));
  const empty = script('transform a:', '    parallel:', '    x=1 1s', ...tail);
  assert.ok(errors(empty).some(m => /Expected an indented block/.test(m)));
});

const script = (...lines) => compile([{ file: 't.vn', text: lines.join(String.fromCharCode(10)) }]);
const tail = ['label start:', '  "hi"', ''];
const flatKeys = anim => anim.keys.map(k => [k.t, k.rot ?? k.x]);

test('dynamic: parameters with defaults, expressions in values, if / elif / else and pick parse into the program', () => {
  const p = script(
    'transform nervous(amount=1, speed):',
    '    rot=-2*amount 0.15s',
    '    if trust > 2:',
    '        x=0.1 0.2s',
    '    elif trust > 0:',
    '        x=0.05 0.2s',
    '    else:',
    '        wait 0.2s',
    '    pick:',
    '        choice:',
    '            rot=0 0.1s',
    '        choice:',
    '            wait 0.1s',
    ...tail,
  );
  assert.deepEqual(errors(p), []);
  assert.equal(p.transforms, undefined, 'a dynamic transform is not a ready keyframe animation');
  const d = p.dynamicTransforms.nervous;
  assert.deepEqual(d.params, [{ name: 'amount', def: 1 }, { name: 'speed', def: 0 }]);
  assert.deepEqual(d.steps.map(s => s.kind), ['tween', 'if', 'pick']);
  assert.equal(d.steps[1].branches.length, 3);
  assert.equal(d.steps[1].branches[2].cond, null);
  assert.equal(d.steps[2].branches.length, 2);
});

test('dynamic: resolveTransform binds arguments, picks the first if branch that holds, and pick uses the rng', () => {
  const p = script('transform t(amount=1):', '    rot=-2*amount 0.5s', '    if mood == 1:', '        rot=5 0.5s', '    else:', '        rot=0 0.5s', '    pick:', '        choice:', '            x=0.1 0.5s', '        choice:', '            x=-0.1 0.5s', ...tail);
  const d = p.dynamicTransforms.t;
  const run = (args, scope, r) => resolveTransform(d, args, scope, { next: () => r });
  const a = run([], { mood: 1 }, 0);
  assert.equal(a.dur, 1.5);
  assert.deepEqual(a.keys.filter(k => k.rot !== undefined).map(k => k.rot), [-2, 5, 5], 'amount defaults to 1, the if branch follows, and rot is held through the pick step');
  assert.equal(run([3], { mood: 1 }, 0).keys.find(k => k.rot !== undefined && k.rot < 0).rot, -6, 'an argument replaces the default');
  assert.ok(run([], { mood: 1 }, 0).keys.some(k => k.rot === 5), 'if holds');
  assert.ok(!run([], { mood: 2 }, 0).keys.some(k => k.rot === 5), 'else is played when it does not');
  assert.ok(run([], { mood: 2 }, 0).keys.some(k => k.x === 0.1), 'pick takes the first branch for a low draw');
  assert.ok(run([], { mood: 2 }, 0.9).keys.some(k => k.x === -0.1), 'and the second for a high one');
});

test('dynamic: the runtime resolves it per animate and a looping one keeps the resolved animation in the state', async () => {
  const p = script(
    'define alice "Alice"',
    'transform nervous(amount=1):', '    rot=-2*amount 0.2s', '    rot=0 0.2s', '    repeat', '',
    'label start:', '  scene a', '  show alice', '  set power = 4', '  animate alice nervous(power)', '  "one"', '  animate alice nervous', '  "two"', '');
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const ops = [];
  const apply = r.apply.bind(r);
  r.apply = async (op, state) => { if (op.op === 'animate') ops.push(structuredClone(op)); return apply(op, state); };
  const states = {};
  const rt = new Runtime(p, r);
  r.say = async ev => { states[ev.text] = structuredClone(rt.state.sprites[0].anim); };
  await rt.start();
  assert.equal(ops.length, 2);
  assert.equal(ops[0].loop, true, 'repeat with no count loops it');
  assert.equal(ops[0].def.keys.find(k => k.rot < 0).rot, -8, 'the argument is an expression over the script variables');
  assert.equal(ops[1].def.keys.find(k => k.rot < 0).rot, -2, 'no argument: the default');
  assert.equal(states.one.def.keys.find(k => k.rot < 0).rot, -8, 'the resolved animation is kept with the loop');
  assert.equal(states.two.def.keys.find(k => k.rot < 0).rot, -2);
});

test('dynamic: misuse is reported', () => {
  assert.ok(errors(script('transform t(a):', '    rot=a 1s', 'label start:', '  animate alice t(1, 2)', ...tail.slice(1))).some(m => /takes 1 argument \(a\), but animate gives 2/.test(m)));
  assert.ok(errors(script('transform t:', '    rot=1 1s', 'label start:', '  animate alice t(1)', ...tail.slice(1))).some(m => /takes 0 arguments/.test(m)));
  assert.ok(errors(script('transform t:', '    elif x:', '        rot=1 1s', ...tail)).some(m => /elif needs an if before it/.test(m)));
  assert.ok(errors(script('transform t:', '    if x:', '        rot=1 1s', '    else:', '        rot=2 1s', '    else:', '        rot=3 1s', ...tail)).some(m => /else needs an if before it/.test(m)));
  assert.ok(errors(script('transform t:', '    choice:', '        rot=1 1s', ...tail)).some(m => /choice: belongs inside pick:/.test(m)));
  assert.ok(errors(script('transform t:', '    pick:', '        rot=1 1s', ...tail)).some(m => /pick: holds choice: blocks/.test(m)));
  assert.ok(errors(script('transform t(a, a):', '    rot=1 1s', ...tail)).some(m => /listed twice/.test(m)));
  assert.ok(errors(script('transform t:', '    rot=2+ 1', ...tail)).length > 0, 'a broken expression is a parse error');
  const warn = script('transform t(a):', '    rot=a+ghost 1s', ...tail);
  assert.ok(warn.diagnostics.some(d => /ghost/.test(d.message)), 'unknown variables in an expression are reported like anywhere else');
  assert.ok(!warn.diagnostics.some(d => /"a"/.test(d.message)), 'a parameter is not');
});

test('assets: a character own rig animation shadowing a transform of the same name is warned about, once per line', () => {
  const rig = { parts: [], flat: true, rig: { animations: { nod: { dur: 1, keys: [{ t: 1, y: 0.01 }] } } } };
  const p = script('define bo "Bo"', 'transform nod:', '    rot=3 1s', 'transform sway(a):', '    rot=a 1s', 'label start:', '  show bo', '  animate bo nod', '  animate bo sway(1)', '  animate other nod', ...tail.slice(1));
  const msgs = checkAssets(p, { files: ['char/bo/default.png'], rigs: { bo: rig } }).map(d => d.message);
  assert.equal(msgs.filter(m => /own "nod" animation in rig.json/.test(m)).length, 1, JSON.stringify(msgs));
  assert.ok(!msgs.some(m => /sway/.test(m)));
  assert.ok(!msgs.some(m => /other has its own/.test(m)));
});

test('automatic: every and/or while on the transform line become the AnimDef auto, a rig auto the scheduler reads', () => {
  const p = script(
    'transform fidget every 4s..9s while trust > 2:', '    rot=2 0.2s', '    rot=0 0.2s', '',
    'transform blink every 3s:', '    alpha=0.5 0.1s', '    alpha=1 0.1s', '',
    'transform lean while mood:', '    x=0.01 0.5s', '    x=0 0.5s', '',
    'transform plain:', '    x=0.01 0.5s', ...tail);
  assert.deepEqual(errors(p), []);
  assert.deepEqual(p.transforms.fidget.auto, { every: { min: 4, max: 9 }, while: 'trust > 2' });
  assert.deepEqual(p.transforms.blink.auto, { every: 3 });
  assert.deepEqual(p.transforms.lean.auto, { while: 'mood' });
  assert.equal(Object.hasOwn(p.transforms.plain, 'auto'), false);
  const entries = autoAnimations(p.transforms);
  assert.deepEqual(entries.map(e => e.name), ['fidget', 'blink', 'lean']);
  assert.equal(entries[0].dur, 0.4);
});

test('automatic: bad headers and misuse of animate ... auto are errors', () => {
  const msg = (...lines) => errors(script(...lines)).join('|');
  assert.match(msg('transform t every 0s:', '    x=1 1s', ...tail), /every needs a duration above 0/);
  assert.match(msg('transform t every 5s..2s:', '    x=1 1s', ...tail), /cannot be shorter/);
  assert.match(msg('transform t while trust >:', '    x=1 1s', ...tail), /not a condition/);
  assert.match(msg('transform t(a) every 3s:', '    x=a 1s', ...tail), /cannot have parameters/);
  assert.match(msg('transform t:', '    x=1 1s', 'label start:', '  show bo', '  animate bo t auto', ...tail.slice(1)), /not an automatic transform/);
  assert.match(msg('label start:', '  show bo', '  animate bo sway auto', ...tail.slice(1)), /preset cannot be automatic/);
  assert.match(msg('transform t every 3s:', '    x=1 1s', 'label start:', '  show bo', '  animate bo t auto loop', ...tail.slice(1)), /takes no duration, loop/);
  assert.doesNotMatch(msg('transform t every 3s:', '    x=1 1s', 'label start:', '  show bo', '  animate bo t auto', '  animate bo t auto off', ...tail.slice(1)), /./);
  const warn = script('transform t while ghost > 1:', '    x=1 1s', ...tail);
  assert.ok(warn.diagnostics.some(d => /ghost/.test(d.message)), 'unknown variables in a while condition are reported');
});

test('automatic: animate ... auto attaches to a character or a picture in the state, auto off detaches, hide and scene end it', async () => {
  const p = script(
    'define alice "Alice"', 'transform fidget every 3s:', '    x=0.01 0.2s', '    x=0 0.2s', '',
    'label start:', '  scene a', '  show alice', '  image show lamp prop/lamp keep',
    '  animate alice fidget auto', '  animate lamp fidget auto', '  "one"',
    '  animate alice stop', '  "two"',
    '  animate alice fidget auto off', '  "three"',
    '  animate alice fidget auto', '  scene b', '  "four"', '');
  assert.deepEqual(errors(p), []);
  const r = new NullRenderer();
  const rt = new Runtime(p, r);
  const seen = {};
  r.say = async ev => { seen[ev.text] = structuredClone({ sprites: rt.state.sprites.map(s => s.autos), images: rt.state.images.map(i => i.autos) }); };
  await rt.start();
  assert.deepEqual(seen.one, { sprites: [['fidget']], images: [['fidget']] });
  assert.deepEqual(seen.two, { sprites: [['fidget']], images: [['fidget']] }, 'stop ends loops, not automatic transforms');
  assert.deepEqual(seen.three, { sprites: [undefined], images: [['fidget']] });
  assert.deepEqual(seen.four, { sprites: [], images: [['fidget']] }, 'a kept picture keeps it through scene; the character is gone');
});

test('preset steps: parse with seconds and strength, sample onto the channels, and add to where a tween left them', () => {
  const step = parseTransformLine('hop 0.4s strength=2', src);
  assert.deepEqual([step.kind, step.name, step.dur, step.strength], ['preset', 'hop', 0.4, 2]);
  assert.equal(parseTransformLine('nod', src).dur, ANIMS.nod.dur, 'the preset\'s own length by default');
  assert.throws(() => parseTransformLine('hop fast', src), /Use: hop \[duration like 0.25s\] \[strength=1\]/);
  assert.throws(() => parseTransformLine('hop 0.2s 0.3s', src), /Use: hop/);
  assert.throws(() => parseTransformLine('hop 0.2', src), /needs its unit: write 0.2s/);

  const anim = transformToAnim(def(['y=-0.05 0.2s', 'hop 0.25s', 'wait 0.1s']));
  assert.equal(anim.dur, 0.55);
  const fn = resolveAnim('tf', { tf: anim }).fn, at = s => fn(s / 0.55).dy;
  assert.ok(Math.abs(at(0.2) + 0.05) < 1e-5, 'the tween arrived');
  const n = 8; // a quarter of a second at 30 a second
  for (const i of [2, 4, 6, 8]) assert.ok(Math.abs(at(0.2 + 0.25 * i / n) - (-0.05 + ANIMS.hop.fn(i / n).dy)) < 1e-5, `hop sample ${i}`);
  assert.ok(Math.abs(at(0.55) + 0.05) < 1e-5, 'the channel holds where the tween left it after the preset');
});

test('preset steps: strength scales it, a parameter can give it, and a transform with breathe is refused', () => {
  const weak = transformToAnim(def(['hop 0.25s']));
  const strong = transformToAnim(def(['hop 0.25s strength=2']));
  const peak = a => Math.min(...a.keys.map(k => k.y ?? 0));
  assert.ok(Math.abs(peak(strong) - 2 * peak(weak)) < 1e-5);

  const p = script('transform t(amount=1):', '    hop 0.25s strength=amount', 'label start:', '  "hi"', '');
  assert.deepEqual(errors(p), []);
  const d = p.dynamicTransforms.t;
  const run = args => resolveTransform(d, args, {}, { next: () => 0 });
  assert.ok(Math.abs(peak(run([3])) - 3 * peak(run([1]))) < 1e-5);

  const bad = script('transform t:', '    breathe 2s', ...tail);
  assert.ok(errors(bad).some(m => /breathe stretches x and y by different amounts/.test(m)), JSON.stringify(bad.diagnostics));
  assert.deepEqual(errors(script('transform t:', '    pulse 1s', '    nod', ...tail)), [], 'pulse scales evenly, nod has no scale');
});

test('preset steps: a preset and a tween on the same channel in parallel branches clash', () => {
  const clash = script('transform t:', '    parallel:', '        hop 0.25s', '    parallel:', '        y=0.1 0.25s', ...tail);
  assert.ok(errors(clash).some(m => /y is moved by two branches/.test(m)), JSON.stringify(clash.diagnostics));
  const fine = script('transform t:', '    parallel:', '        hop 0.25s', '    parallel:', '        rot=5 0.25s', ...tail);
  assert.deepEqual(errors(fine), []);
});

test('tint= and flash= steps: parse, compile to keys, and sample as colors on the offset', () => {
  assert.deepEqual(parseTransformLine('tint=#ff8080 0.3s', src), { kind: 'tween', tint: '#ff8080', dur: 0.3, ease: null, src });
  assert.deepEqual(parseTransformLine('tint=none 0.3s', src), { kind: 'tween', tint: null, dur: 0.3, ease: null, src });
  assert.deepEqual(parseTransformLine('flash=#ff0000:0.5 0.1s', src), { kind: 'tween', flash: 0.5, flashColor: '#ff0000', dur: 0.1, ease: null, src });
  assert.deepEqual(parseTransformLine('flash=0.8 0.1s', src), { kind: 'tween', flash: 0.8, dur: 0.1, ease: null, src });
  assert.equal(parseTransformLine('flash=#ff0000 0.1s', src).flash, 1);
  for (const bad of ['tint=red 0.1', 'flash=2 0.1', 'flash=#ff0000:x', 'flash=1:2:3']) assert.throws(() => parseTransformLine(bad, src), bad);

  const anim = transformToAnim(def(['tint=#ff0000 0.2s', 'flash=#00ff00:1 0.1s', 'flash=0 0.3s', 'tint=none 0.2s']));
  assert.ok(anim.keys.some(k => k.tint === '#ff0000') && anim.keys.some(k => k.tint === '#ffffff'));
  assert.ok(anim.keys.some(k => k.flash === 1 && k.flashColor === '#00ff00'));
  assert.ok(anim.keys.some(k => k.flash === 0 && k.flashColor === '#00ff00'), 'the way back keeps the color');
  const fn = resolveAnim('tf', { tf: anim }).fn;
  assert.equal(fn(0).tint, 0xffffff, 'starts white');
  assert.equal(fn(0.2 / 0.8).tint, 0xff0000, 'red at the end of the first step');
  assert.deepEqual(fn(0.3 / 0.8).flash, { color: 0x00ff00, amount: 1 });
  assert.equal(fn(1).flash.amount, 0);
  assert.equal(fn(1).tint, 0xffffff, 'ends back at white');
});

test('tint and flash in an offset: tints multiply, the stronger flash shows, strength scales them', () => {
  const a = { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0, tint: 0xff8080, flash: { color: 0xffffff, amount: 0.3 } };
  const b = { dx: 0, dy: 0, sx: 0, sy: 0, rot: 0, tint: 0x80ffff, flash: { color: 0xff0000, amount: 0.6 } };
  const sum = addOffset(a, b);
  assert.equal(sum.tint, 0x808080);
  assert.deepEqual(sum.flash, { color: 0xff0000, amount: 0.6 });
  assert.deepEqual(scaleOffset(a, 0).tint, 0xffffff);
  assert.equal(scaleOffset(a, 0.5).flash.amount, 0.15);
  assert.equal(addOffset(NO_OFFSET, NO_OFFSET).tint, undefined);
});

test('a transform that loops forever away from white warns with tint=none', () => {
  const w = checkTransform(def(['tint=#ff0000 0.2s'], 'forever')).map(d => d.message).join();
  assert.match(w, /tint=none/);
});
