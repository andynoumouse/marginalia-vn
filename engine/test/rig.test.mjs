import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAssets, checkRig, compile, getCompletions, NullRenderer, Runtime, expandShow, mergeRig, orderedParts, rigLayers, rigAnimNames, rigPoseNames, rigSkeleton, rigSlotNames } from '../../dist/engine/src/index.js';

const v = file => ({ file });
const manifest = rig => ({
  width: 100, height: 100,
  parts: [
    { file: 'body.png' },
    { slot: 'outfit_back', default: 'school', variants: { school: v('ob_school.png'), casual: v('ob_casual.png') } },
    { file: 'hair.png' },
    { slot: 'outfit_front', default: 'school', variants: { school: v('of_school.png'), casual: v('of_casual.png') } },
    { slot: 'eyes', default: 'open', variants: { open: v('e_open.png'), down: v('e_down.png'), narrow: { ...v('e_narrow.png'), poses: ['angry'] } } },
    { slot: 'blush', default: null, variants: { on: v('blush.png') } },
  ],
  ...(rig ? { rig } : {}),
});
const rig = {
  order: ['body', 'outfit_back', 'hair', 'outfit_front'],
  groups: { outfit: ['outfit_back', 'outfit_front'] },
  poses: { shy: { pose: 'angry', blush: 'on' }, plain: { outfit: 'casual' } },
};
const files = m => rigLayers(m, null, {}).map(p => p.file);

test('rig order: listed parts are re-stacked among their own positions', () => {
  assert.deepEqual(orderedParts(manifest({ order: ['hair', 'body'] })).map(p => p.file ?? p.slot), ['hair.png', 'outfit_back', 'body.png', 'outfit_front', 'eyes', 'blush']);
  assert.deepEqual(orderedParts(manifest({ order: ['nope'] })), manifest().parts);
  assert.deepEqual(files(manifest({ order: ['hair', 'body'] })).slice(0, 2), ['hair.png', 'ob_school.png']);
});

test('rig groups: one name sets several slots; a missing variant is skipped with a warning', () => {
  const m = manifest(rig);
  const x = expandShow(m, null, { outfit: 'casual' });
  assert.deepEqual(x.overrides, { outfit_back: 'casual', outfit_front: 'casual' });
  assert.deepEqual(x.problems, []);
  const bad = expandShow({ ...m, parts: m.parts.map(p => (p.slot === 'outfit_front' ? { ...p, variants: { school: v('x.png') } } : p)) }, null, { outfit: 'casual' });
  assert.deepEqual(bad.overrides, { outfit_back: 'casual' });
  assert.equal(bad.problems.length, 1);
  assert.deepEqual(expandShow(m, null, { outfit: 'none' }).overrides, { outfit_back: 'none', outfit_front: 'none' });
});

test('rig shorthands: expand to a pose and overrides, explicit overrides win', () => {
  const m = manifest(rig);
  assert.deepEqual(expandShow(m, 'shy', {}), { pose: 'angry', overrides: { blush: 'on' }, problems: [] });
  assert.deepEqual(expandShow(m, 'shy', { blush: 'none', eyes: 'down' }).overrides, { blush: 'none', eyes: 'down' });
  assert.equal(expandShow(m, 'plain', {}).pose, null);
  assert.deepEqual(files(m), ['body.png', 'ob_school.png', 'hair.png', 'of_school.png', 'e_open.png']);
  const warned = [];
  const shy = rigLayers(m, 'shy', {}, w => warned.push(w)).map(p => p.file);
  assert.deepEqual(shy, ['body.png', 'ob_school.png', 'hair.png', 'of_school.png', 'e_narrow.png', 'blush.png']);
  assert.deepEqual(warned, []);
  assert.deepEqual(rigLayers(m, 'plain', {}).map(p => p.file).slice(1, 4), ['ob_casual.png', 'hair.png', 'of_casual.png']);
});

test('rig: without rig.json nothing changes', () => {
  const m = manifest();
  assert.deepEqual(expandShow(m, 'angry', { eyes: 'down' }), { pose: 'angry', overrides: { eyes: 'down' }, problems: [] });
});

test('checkAssets understands shorthands and groups', () => {
  const index = { files: [], rigs: { al: manifest(rig) } };
  const program = src => compile([{ file: 't.vn', text: `define al "Al"\nlabel start:\n  ${src}\n` }]);
  const msgs = src => checkAssets(program(src), index).map(d => d.message);
  assert.deepEqual(msgs('show al shy'), []);
  assert.deepEqual(msgs('show al angry outfit=casual'), []);
  assert.ok(msgs('show al angry outfit=wizard').some(m => m.includes('has no variant "wizard"')));
  assert.ok(msgs('show al angry hat=red').some(m => m.includes('has no slot "hat"')));
});

test('checkRig reports problems in rig.json', () => {
  assert.deepEqual(checkRig(manifest(rig)), []);
  const found = checkRig(manifest({
    order: ['body', 'ghost'],
    groups: { outfit: ['outfit_back', 'nope'], eyes: ['blush'] },
    poses: { open: {}, odd: { pose: 'zzz', hat: 'x', eyes: 'closed' } },
  }));
  const bad = found.map(p => p.message);
  assert.deepEqual(found.find(p => p.message.includes('ghost')).at, 'ghost');
  assert.deepEqual(found.find(p => p.message.includes('no slot or group')).at, 'hat');
  assert.deepEqual(rigPoseNames(manifest(rig)), ['angry', 'casual', 'down', 'narrow', 'on', 'open', 'plain', 'school', 'shy']);
  assert.deepEqual(rigSlotNames(manifest(rig)), ['outfit_back', 'outfit_front', 'eyes', 'blush', 'outfit']);
  for (const part of ['no part named "ghost"', 'names slot "nope"', '"eyes" is also a slot', '"open" is also a variant', 'no layer named or aliased "zzz"', 'no slot or group "hat"', 'slot "eyes" has no variant "closed"']) {
    assert.ok(bad.some(m => m.includes(part)), part);
  }
});

test('rig skeleton and merge', () => {
  const m = manifest();
  const sk = rigSkeleton(m);
  assert.deepEqual(sk.order, ['body', 'outfit_back', 'hair', 'outfit_front', 'eyes', 'blush']);
  assert.deepEqual(sk.groups, { outfit: ['outfit_back', 'outfit_front'] });
  assert.deepEqual(sk.poses, {});

  const updated = { ...m, parts: [...m.parts.slice(0, 3), { file: 'scarf.png' }, ...m.parts.slice(3)] };
  const merged = mergeRig({ order: ['body', 'hair', 'old'], poses: { a: {} } }, updated);
  assert.deepEqual(merged.added, ['outfit_back', 'scarf', 'outfit_front', 'eyes', 'blush']);
  assert.deepEqual(merged.missing, ['old']);
  assert.deepEqual(merged.rig.poses, { a: {} });
  assert.ok(merged.rig.order.indexOf('scarf') === merged.rig.order.indexOf('hair') + 1);
});

test('completions after "show <char>" offer rig poses, shorthands and slots', () => {
  const p = compile([{ file: 't.vn', text: 'define al "Al"\nlabel start:\n  show al\n' }]);
  const labels = getCompletions(p, '  show al ', { al: manifest(rig) }).map(s => s.label);
  for (const want of ['shy', 'angry', 'school', 'eyes=', 'outfit=', 'at']) assert.ok(labels.includes(want), want);
  assert.ok(!getCompletions(p, '  show al ').some(s => s.label === 'shy'));
});

test('checkRig: animations are checked key by key', () => {
  const rig = { parts: [], rig: { animations: {
    ok: { dur: 1, keys: [{ t: 0.5, rot: 5, ease: 'out' }] },
    nokeys: { keys: [] },
    bad: { dur: 0, keys: [{ t: 2, rot: 'x', ease: 'wobble', spin: 1 }, { t: 0.5 }] },
  } } };
  const msgs = checkRig(rig).map(p => p.message);
  assert.deepEqual(checkRig({ parts: [], rig: { animations: { ok: rig.rig.animations.ok } } }), []);
  assert.ok(msgs.some(m => /nokeys: needs a non-empty/.test(m)));
  assert.ok(msgs.some(m => /bad: dur must be more than 0/.test(m)));
  assert.ok(msgs.some(m => /keys\[0\]: t must be/.test(m)));
  assert.ok(msgs.some(m => /keys\[0\]: unknown ease "wobble"/.test(m)));
  assert.ok(msgs.some(m => /keys\[0\]: rot must be a number/.test(m)));
  assert.ok(msgs.some(m => /keys\[0\]: unknown channel "spin"/.test(m)));
  assert.ok(msgs.some(m => /keys\[1\]: sets no channel/.test(m)));
  assert.equal(checkRig(rig).find(p => /nokeys/.test(p.message)).at, 'nokeys');
});

test('animate: names are checked against presets and the character\'s rig.json animations', () => {
  const src = 'define mina "Mina"\ndefine bo "Bo"\nlabel start:\n  show mina\n  animate mina wave\n  animate mina nod\n  animate mina wobble\n  animate bo wave\n  animate bo stop\n  end\n';
  const p = compile([{ file: 't.vn', text: src }]);
  const index = { files: [], rigs: { mina: { parts: [], rig: { animations: { wave: { keys: [{ t: 0.5, rot: 5 }] } } } } } };
  const warns = checkAssets(p, index).map(d => d.message);
  assert.equal(warns.length, 2);
  assert.match(warns[0], /mina has no animation "wobble"/);
  assert.match(warns[0], /nod.*wave/); // lists presets and its own
  assert.match(warns[1], /bo has no animation "wave"/);
  assert.deepEqual(rigAnimNames(index.rigs.mina), ['wave']);
  const labels = getCompletions(p, '  animate mina ', index.rigs).map(s => s.label);
  assert.ok(labels.includes('wave') && labels.includes('nod') && labels.includes('stop'));
  assert.ok(!getCompletions(p, '  animate bo ', index.rigs).some(s => s.label === 'wave'));
});

test('parts: rigLayers names the part of each layer; pivots and key parts are checked', () => {
  const m = manifest({ order: ['hair', 'body'] });
  assert.deepEqual(rigLayers(m, null, {}).map(l => l.part), ['hair', 'outfit_back', 'body', 'outfit_front', 'eyes']);
  const msgs = rig => checkRig(manifest(rig)).map(p => p.message);
  assert.deepEqual(msgs({ pivots: { hair: [10, 20], eyes: [0, 0] } }), []);
  assert.match(msgs({ pivots: { tail: [1, 2] } })[0], /no part named "tail"/);
  assert.match(msgs({ pivots: { hair: [1] } })[0], /use \[x, y\]/);
  assert.match(msgs({ pivots: { hair: ['a', 2] } })[0], /use \[x, y\]/);
  const anim = key => ({ animations: { wave: { keys: [key] } } });
  assert.deepEqual(msgs(anim({ t: 0.5, part: 'hair', rot: 5 })), []);
  assert.match(msgs(anim({ t: 0.5, part: 'tail', rot: 5 }))[0], /no part named "tail"/);
});

test('animate part=: parsed, kept on a loop and checked against the character\'s parts', async () => {
  const src = 'define mina "Mina"\ndefine bo "Bo"\nlabel start:\n  show mina\n  animate mina sway loop part=hair\n  animate mina nod part=tail\n  animate bo bob part=head\n  animate mina wave 2 part=\n  end\n';
  const p = compile([{ file: 't.vn', text: src }]);
  const ops = p.ops.filter(o => o.op === 'animate');
  assert.deepEqual(ops.slice(0, 2).map(o => [o.name, o.loop, o.part]), [['sway', true, 'hair'], ['nod', false, 'tail']]);
  assert.match(p.diagnostics.map(d => d.message).join('|'), /Use: animate/); // a bare `part=` is not an option
  const index = { files: [], rigs: { mina: { parts: [{ file: 'hair.png' }, { slot: 'eyes', variants: {} }], rig: { animations: { wave: { keys: [{ t: 0.5, rot: 1 }] } } } } } };
  const warns = checkAssets(p, index).map(d => d.message);
  assert.equal(warns.length, 2);
  assert.match(warns[0], /mina has no part "tail" \(parts: hair, eyes\)/);
  assert.match(warns[1], /bo has no part "head".*only layered characters/);
  const labels = getCompletions(p, '  animate mina sway ', index.rigs).map(s => s.label);
  assert.ok(labels.includes('part=hair') && labels.includes('part=eyes'));
  const r = new NullRenderer();
  const rt = new Runtime(compile([{ file: 't.vn', text: src.replace(/.*part=\n/, '').replace(/  animate (mina nod|bo bob).*\n/g, '') + '' }]), r);
  await rt.start();
  assert.deepEqual(rt.state.sprites[0].anim, { name: 'sway', dur: null, strength: 1, part: 'hair' });
});
