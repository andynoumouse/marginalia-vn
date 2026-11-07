import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAssets, checkRig, compile, getCompletions, NullRenderer, Runtime, expandShow, mergeRig, orderedParts, rigLayers, rigAnimNames, rigLookNames, rigSkeleton, rigSlotNames, rigPartNames, rigOutline } from '../../dist/engine/src/index.js';

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
  bones: { torso: {}, head: { parent: 'torso', pivot: [50, 40] } },
  parts: { outfit_back: { bone: 'torso' }, outfit_front: { bone: 'torso' }, hair: { bone: 'head' } },
  looks: { shy: { look: 'angry', blush: 'on' }, plain: { outfit_back: 'casual', outfit_front: 'casual' } },
};
const files = m => rigLayers(m, [], {}).map(p => p.file);

test('rig order: listed parts are re-stacked among their own positions', () => {
  assert.deepEqual(orderedParts(manifest({ order: ['hair', 'body'] })).map(p => p.file ?? p.slot), ['hair.png', 'outfit_back', 'body.png', 'outfit_front', 'eyes', 'blush']);
  assert.deepEqual(orderedParts(manifest({ order: ['nope'] })), manifest().parts);
  assert.deepEqual(files(manifest({ order: ['hair', 'body'] })).slice(0, 2), ['hair.png', 'ob_school.png']);
});

test('a group no longer dresses: outfit=casual is a plain (unknown) slot override', () => {
  const m = manifest(rig);
  const x = expandShow(m, [], { outfit: 'casual' });
  assert.deepEqual(x.overrides, { outfit: 'casual' });
  assert.deepEqual(rigSlotNames(m), ['outfit_back', 'outfit_front', 'eyes', 'blush']);
  const index = { files: [], rigs: { al: m } };
  const msgs = checkAssets(compile([{ file: 't.vn', text: 'define al "Al"\nlabel start:\n  show al outfit=casual\n' }]), index).map(d => d.message);
  assert.ok(msgs.some(t => t.includes('has no slot "outfit"')));
});

test('looks: expand into slot overrides, explicit overrides win', () => {
  const m = manifest(rig);
  assert.deepEqual(expandShow(m, ['shy'], {}), { overrides: { eyes: 'narrow', blush: 'on' }, unknown: [], problems: [] });
  assert.deepEqual(expandShow(m, ['shy'], { blush: 'none', eyes: 'down' }).overrides, { eyes: 'down', blush: 'none' });
  assert.deepEqual(expandShow(m, ['plain'], {}).overrides, { outfit_back: 'casual', outfit_front: 'casual' });
  assert.deepEqual(files(m), ['body.png', 'ob_school.png', 'hair.png', 'of_school.png', 'e_open.png']);
  const warned = [];
  const shy = rigLayers(m, ['shy'], {}, w => warned.push(w)).map(p => p.file);
  assert.deepEqual(shy, ['body.png', 'ob_school.png', 'hair.png', 'of_school.png', 'e_narrow.png', 'blush.png']);
  assert.deepEqual(warned, []);
  assert.deepEqual(rigLayers(m, ['plain'], {}).map(p => p.file).slice(1, 4), ['ob_casual.png', 'hair.png', 'of_casual.png']);
});

test('looks: several bare words apply left to right, the last wins per slot', () => {
  const m = manifest(rig);
  assert.deepEqual(expandShow(m, ['shy', 'plain'], {}).overrides, { eyes: 'narrow', blush: 'on', outfit_back: 'casual', outfit_front: 'casual' });
  const mixed = manifest({ looks: { a: { eyes: 'down', blush: 'on' }, b: { eyes: 'open' } } });
  assert.deepEqual(expandShow(mixed, ['a', 'b'], {}).overrides, { eyes: 'open', blush: 'on' });
  assert.deepEqual(expandShow(mixed, ['b', 'a'], {}).overrides, { eyes: 'down', blush: 'on' });
  assert.deepEqual(expandShow(mixed, ['a', 'b'], { eyes: 'narrow' }).overrides, { eyes: 'narrow', blush: 'on' }, 'the line beats every look');
});

test('looks: the look key applies another look first; none hides a slot; cycles are cut and rejected', () => {
  const m = manifest({ looks: {
    base: { eyes: 'down', blush: 'on' },
    child: { look: 'base', eyes: 'open', outfit_back: 'none' },
    a: { look: 'b', eyes: 'down' }, b: { look: 'a', blush: 'on' },
    ghost: { look: 'nobody' }, odd: { hat: 'x', eyes: 'closed' },
  } });
  const child = expandShow(m, ['child'], {});
  assert.deepEqual(child.overrides, { eyes: 'open', blush: 'on', outfit_back: 'none' });
  assert.deepEqual(child.problems, []);
  assert.deepEqual(rigLayers(m, ['child'], {}).map(l => l.file), ['body.png', 'hair.png', 'of_school.png', 'e_open.png', 'blush.png']);
  assert.match(expandShow(m, ['a'], {}).problems[0], /refers back to itself/);
  assert.match(expandShow(m, ['ghost'], {}).problems[0], /"nobody", which is no look/);
  assert.equal(expandShow(m, ['odd'], {}).problems.length, 2);
  const bad = checkRig(m).map(p => p.message);
  for (const want of ['looks.a: look references form a cycle', 'looks.b: look references form a cycle', 'looks.ghost: look "nobody" is no look', 'looks.odd: no slot "hat"', 'looks.odd: slot "eyes" has no variant "closed"']) {
    assert.ok(bad.some(t => t.includes(want)), want);
  }
  assert.ok(!bad.some(t => t.startsWith('looks.child') || t.startsWith('looks.base')));
});

test('looks: a bare word is a look, then an implicit look from PSD names and tags, else unknown', () => {
  const m = manifest({ looks: { angry: { blush: 'on' } } });
  assert.deepEqual(expandShow(m, ['casual'], {}).overrides, { outfit_back: 'casual', outfit_front: 'casual' }, 'a variant name picks it in every slot that has it');
  assert.deepEqual(expandShow(manifest(), ['angry'], {}).overrides, { eyes: 'narrow' }, 'a tag on a variant');
  assert.deepEqual(expandShow(m, ['angry'], {}).overrides, { blush: 'on' }, 'a looks entry of the same name wins');
  const u = expandShow(m, ['zzz', 'casual'], {});
  assert.deepEqual(u.unknown, ['zzz']);
  assert.deepEqual(u.overrides, { outfit_back: 'casual', outfit_front: 'casual' });
  const warned = [];
  rigLayers(m, ['zzz'], {}, w => warned.push(w));
  assert.deepEqual(warned, ['no layer is named or aliased "zzz"']);
  assert.ok(checkRig(m).some(p => p.message.includes('"angry" is also a variant or pose name in the PSD; the look wins')));
});

test('show parses several bare words and runs them left to right', async () => {
  const src = 'define al "Al"\nlabel start:\n  show al shy plain eyes=down\n  end\n';
  const p = compile([{ file: 't.vn', text: src }]);
  const show = p.ops.find(o => o.op === 'show');
  assert.equal(show.pose, 'shy');
  assert.deepEqual(show.more, ['plain']);
  assert.deepEqual(show.overrides, { eyes: 'down' });
  const rt = new Runtime(p, new NullRenderer());
  await rt.start();
  const s = rt.state.sprites[0];
  assert.deepEqual([s.pose, s.more, s.overrides], ['shy', ['plain'], { eyes: 'down' }]);
  assert.deepEqual(checkAssets(p, { files: [], rigs: { al: manifest(rig) } }).map(d => d.message), []);
});

test('rig: without rig.json nothing changes', () => {
  const m = manifest();
  assert.deepEqual(expandShow(m, ['angry'], { eyes: 'down' }), { overrides: { eyes: 'down' }, unknown: [], problems: [] });
});

test('checkAssets understands looks', () => {
  const index = { files: [], rigs: { al: manifest(rig) } };
  const program = src => compile([{ file: 't.vn', text: `define al "Al"\nlabel start:\n  ${src}\n` }]);
  const msgs = src => checkAssets(program(src), index).map(d => d.message);
  assert.deepEqual(msgs('show al shy'), []);
  assert.deepEqual(msgs('show al angry outfit_back=casual'), []);
  assert.deepEqual(msgs('show al shy plain'), []);
  assert.ok(msgs('show al zzz').some(m => m.includes('no layer named or aliased "zzz"')));
  assert.ok(msgs('show al angry outfit_back=wizard').some(m => m.includes('has no variant "wizard"')));
  assert.ok(msgs('show al angry hat=red').some(m => m.includes('has no slot "hat"')));
});

test('checkRig reports problems in rig.json', () => {
  assert.deepEqual(checkRig(manifest(rig)), []);
  const found = checkRig(manifest({
    order: ['body', 'ghost'],
    groups: { outfit: ['outfit_back'] },
    looks: { open: {}, odd: { look: 'zzz', hat: 'x', eyes: 'closed' } },
  }));
  const bad = found.map(p => p.message);
  assert.deepEqual(found.find(p => p.message.includes('ghost')).at, 'ghost');
  assert.deepEqual(found.find(p => p.message.includes('no slot "hat"')).at, 'hat');
  assert.deepEqual(rigLookNames(manifest(rig)), ['angry', 'casual', 'down', 'narrow', 'on', 'open', 'plain', 'school', 'shy']);
  assert.deepEqual(rigSlotNames(manifest(rig)), ['outfit_back', 'outfit_front', 'eyes', 'blush']);
  for (const part of ['no part named "ghost"', 'groups was replaced by bones', '"open" is also a variant', 'look "zzz" is no look', 'no slot "hat"', 'slot "eyes" has no variant "closed"']) {
    assert.ok(bad.some(m => m.includes(part)), part);
  }
});

test('rig skeleton and merge', () => {
  const m = manifest();
  const sk = rigSkeleton(m);
  assert.deepEqual(sk.order, ['body', 'outfit_back', 'hair', 'outfit_front', 'eyes', 'blush']);
  assert.deepEqual(sk.looks, {});

  const updated = { ...m, parts: [...m.parts.slice(0, 3), { file: 'scarf.png' }, ...m.parts.slice(3)] };
  const merged = mergeRig({ order: ['body', 'hair', 'old'], looks: { a: {} } }, updated);
  assert.deepEqual(merged.added, ['outfit_back', 'scarf', 'outfit_front', 'eyes', 'blush']);
  assert.deepEqual(merged.missing, ['old']);
  assert.deepEqual(merged.rig.looks, { a: {} });
  assert.ok(merged.rig.order.indexOf('scarf') === merged.rig.order.indexOf('hair') + 1);
});

test('completions after "show <char>" offer rig looks, PSD names and slots', () => {
  const p = compile([{ file: 't.vn', text: 'define al "Al"\nlabel start:\n  show al\n' }]);
  const labels = getCompletions(p, '  show al ', { al: manifest(rig) }).map(s => s.label);
  for (const want of ['shy', 'angry', 'school', 'eyes=', 'at']) assert.ok(labels.includes(want), want);
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
  assert.deepEqual(rigLayers(m, [], {}).map(l => l.part), ['hair', 'outfit_back', 'body', 'outfit_front', 'eyes']);
  const msgs = rig => checkRig(manifest(rig)).map(p => p.message);
  assert.deepEqual(msgs({ pivots: { hair: [10, 20], eyes: [0, 0] } }), []);
  assert.match(msgs({ pivots: { tail: [1, 2] } })[0], /no part named "tail"/);
  assert.match(msgs({ pivots: { hair: [1] } })[0], /use \[x, y\]/);
  assert.match(msgs({ pivots: { hair: ['a', 2] } })[0], /use \[x, y\]/);
  const anim = key => ({ animations: { wave: { keys: [key] } } });
  assert.deepEqual(msgs(anim({ t: 0.5, part: 'hair', rot: 5 })), []);
  assert.match(msgs(anim({ t: 0.5, part: 'tail', rot: 5 }))[0], /no part or bone named "tail"/);
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

test('rigOutline: parts top first with what is shown, bones, and the variants each look picks', () => {
  const m = manifest(rig);
  const o = rigOutline(m, [], {});
  assert.deepEqual(o.parts.map(p => `${p.kind}:${p.name}`), ['slot:blush', 'slot:eyes', 'slot:outfit_front', 'layer:hair', 'slot:outfit_back', 'layer:body']);
  const part = (x, n) => x.parts.find(p => p.name === n);
  assert.deepEqual(part(o, 'eyes'), {
    name: 'eyes', kind: 'slot', file: 'e_open.png', shown: 'open', bone: null,
    variants: [
      { name: 'open', file: 'e_open.png', poses: [], isDefault: true },
      { name: 'down', file: 'e_down.png', poses: [], isDefault: false },
      { name: 'narrow', file: 'e_narrow.png', poses: ['angry'], isDefault: false },
    ],
  });
  assert.equal(part(o, 'blush').shown, null, 'a slot without a default shows nothing');
  assert.deepEqual(part(o, 'hair'), { name: 'hair', kind: 'layer', file: 'hair.png', variants: [], shown: null, bone: 'head' });
  assert.equal(part(o, 'outfit_front').bone, 'torso');
  assert.deepEqual(o.bones, [{ name: 'torso', parent: null, parts: ['outfit_back', 'outfit_front', 'hair'] }, { name: 'head', parent: 'torso', parts: ['hair'] }]);
  assert.deepEqual(o.looks, [
    { name: 'shy', from: 'rig', picks: { blush: 'on', eyes: 'narrow' } },
    { name: 'plain', from: 'rig', picks: { outfit_front: 'casual', outfit_back: 'casual' } },
    { name: 'angry', from: 'art', picks: { eyes: 'narrow' } },
  ]);
  const dressed = rigOutline(m, ['shy'], { eyes: 'down', outfit_front: 'none', outfit_back: 'none' });
  assert.deepEqual(['blush', 'eyes', 'outfit_front'].map(n => part(dressed, n).shown), ['on', 'down', null]);
  assert.equal(part(dressed, 'outfit_back').file, null);
});

test('folderBones, rigSkeleton and mergeRig: PSD folders become bones, nothing the author has is changed', () => {
  const m = {
    width: 100, height: 100,
    parts: [
      { file: 'body.png' },
      { file: 'face.png', group: 'head' },
      { slot: 'eyes', default: 'open', variants: { open: { file: 'e.png' } }, group: 'head' },
      { file: 'hand.png', group: 'arm/forearm' },
      { file: 'cuff.png', group: 'forearm' },
    ],
  };
  const sk = rigSkeleton(m);
  assert.deepEqual(sk.bones, { head: {}, forearm: { parent: 'arm' }, arm: {}, forearm_2: {} });
  assert.deepEqual(sk.parts, { face: { bone: 'head' }, eyes: { bone: 'head' }, hand: { bone: 'forearm' }, cuff: { bone: 'forearm_2' } });
  assert.deepEqual(checkRig({ ...m, rig: sk }).map(p => p.message), []);
  assert.deepEqual(rigSkeleton({ parts: [{ file: 'a.png' }] }).bones, undefined, 'no folders, no bones');

  // a reconvert adds bones only for new parts, and never changes what is there
  const mine = { order: ['body', 'face'], bones: { head: { pivot: [5, 5] } }, parts: { face: { bone: 'head', pivot: [1, 2] } } };
  const merged = mergeRig(mine, m);
  assert.deepEqual(merged.added, ['eyes', 'hand', 'cuff']);
  assert.deepEqual(merged.bonesAdded, ['arm', 'forearm', 'forearm_2']);
  assert.deepEqual(merged.rig.bones.head, { pivot: [5, 5] });
  assert.deepEqual(merged.rig.parts.face, { bone: 'head', pivot: [1, 2] });
  assert.deepEqual(merged.rig.parts.eyes, { bone: 'head' });
  // a folder whose parts are all already in order adds no empty bone
  assert.deepEqual(mergeRig({ order: ['body', 'face', 'eyes', 'hand', 'cuff'] }, m).bonesAdded, []);
});

test('checkRig: deformers', () => {
  const params = [{ id: 'sway', min: -1, max: 1, default: 0 }, { id: 'tilt', min: 0, max: 1, default: 0 }];
  const ok = { id: 'hw', part: 'hair', grid: [2, 2], keyforms: [{ param: 'sway', keys: [{ at: -1, pts: { 0: [0.1, 0] } }, { at: 1, pts: { 8: [0, 0.1] } }] }] };
  const msgs = (deformers, extra = {}) => checkRig(manifest({ parameters: params, deformers, ...extra })).map(p => p.message);
  assert.deepEqual(msgs([ok]), []);
  assert.ok(msgs([ok, ok]).some(m => m.includes('"hw" is defined twice')));
  assert.ok(msgs([{ ...ok, part: 'nope' }]).some(m => m.includes('no part named "nope"')));
  assert.ok(msgs([{ ...ok, part: 'torso' }], { bones: { torso: {} } }).some(m => m.includes('"torso" is a bone')));
  assert.ok(msgs([ok, { ...ok, id: 'hw2' }]).some(m => m.includes('already has deformer "hw"')));
  for (const grid of [[0, 2], [13, 2], [2.5, 2], [2], 'x']) assert.ok(msgs([{ ...ok, grid }]).some(m => m.includes('grid: use [cols, rows]')), String(grid));
  assert.ok(msgs([{ ...ok, keyforms: 'x' }]).some(m => m.includes('keyforms: needs a list')));
  assert.ok(msgs([{ ...ok, keyforms: [{}] }]).some(m => m.includes('use either param + keys')));
  assert.ok(msgs([{ ...ok, keyforms: [{ param: 'nope', keys: [{ at: 0 }] }] }]).some(m => m.includes('no parameter "nope"')));
  assert.ok(msgs([{ ...ok, keyforms: [{ param: 'sway', keys: [{ at: -2 }, { at: 1 }] }] }]).some(m => m.includes('outside "sway"')));
  assert.ok(msgs([{ ...ok, keyforms: [{ param: 'sway', keys: [{ at: 0 }, { at: 0 }] }] }]).some(m => m.includes('two keys at the same value')));
  assert.ok(msgs([{ ...ok, keyforms: [{ param: 'sway', keys: [{ at: 0, pts: { 9: [0, 0] } }] }] }]).some(m => m.includes('point "9" is outside the lattice (0 to 8)')));
  assert.ok(msgs([{ ...ok, keyforms: [{ param: 'sway', keys: [{ at: 0, pts: { 1: [0] } }] }] }]).some(m => m.includes('use [dx, dy]')));
  const two = (patch) => [{ ...ok, grid: [1, 1], keyforms: [{ params: ['sway', 'tilt'], grid: { x: [-1, 1], y: [0, 1] }, forms: [{}, {}, {}, {}], ...patch }] }];
  assert.deepEqual(msgs(two({})), []);
  assert.ok(msgs(two({ forms: [{}] })).some(m => m.includes('needs 4 forms')));
  assert.ok(msgs(two({ params: ['sway', 'sway'] })).some(m => m.includes('must differ')));
  assert.ok(msgs(two({ grid: { x: [1, -1], y: [0, 1] } })).some(m => m.includes('ascending')));
  assert.ok(msgs(two({ grid: { x: [-1, 2], y: [0, 1] } })).some(m => m.includes('outside "sway"')));
  assert.ok(msgs('x').some(m => m.includes('deformers: needs a list')));
  const framed = { animations: { a: { dur: 1, keys: [], frames: [{ slot: 'eyes', frames: ['open', 'down'] }] } } };
  assert.deepEqual(msgs([{ ...ok, part: 'hair' }], framed), []);
  assert.ok(msgs([{ ...ok, part: 'eyes' }], framed).some(m => m.includes('has a frame track')));
});
