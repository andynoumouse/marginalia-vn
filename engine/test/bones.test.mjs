import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boneCycles, boneOrder, resolvePivots, composeBones, placeParts, partsUnder, offsetMatrix, applyMatrix, checkRig, NO_OFFSET } from '../../dist/engine/src/index.js';

const off = o => ({ ...NO_OFFSET, ...o });
const near = (got, want) => assert.ok(Math.abs(got[0] - want[0]) < 1e-9 && Math.abs(got[1] - want[1]) < 1e-9, `${got} vs ${want}`);

const bones = {
  root: { pivot: [100, 200] },
  torso: { parent: 'root', pivot: [100, 150] },
  arm: { parent: 'torso', pivot: [150, 100] },
  head: { parent: 'torso' },
};

test('boneOrder puts parents first, whatever the file order', () => {
  assert.deepEqual(boneOrder({ c: { parent: 'b' }, b: { parent: 'a' }, a: {} }), ['a', 'b', 'c']);
  assert.deepEqual(boneOrder(bones), ['root', 'torso', 'arm', 'head']);
});

test('boneCycles lists each loop once; unknown parents are not loops', () => {
  assert.deepEqual(boneCycles({ a: { parent: 'b' }, b: { parent: 'a' }, c: { parent: 'a' }, d: { parent: 'ghost' }, e: { parent: 'e' } }), [['a', 'b'], ['e']]);
  assert.deepEqual(boneCycles(bones), []);
});

test('resolvePivots: own, else the parent\'s, else the middle of the parts below, else the origin', () => {
  const boxes = { head: [{ x: 0, y: 0, w: 100, h: 50 }, { x: 100, y: 50, w: 100, h: 50 }] };
  const p = resolvePivots({ r: {}, k: { parent: 'r' }, own: { parent: 'r', pivot: [1, 2] }, solo: {}, loner: {} }, { k: boxes.head }, [7, 8]);
  assert.deepEqual(p.r, [100, 50]);            // measured from the boxes of its child k
  assert.deepEqual(p.k, [100, 50]);            // the parent's
  assert.deepEqual(p.own, [1, 2]);
  assert.deepEqual(p.solo, [7, 8]);            // nothing to measure: the origin
  assert.deepEqual(resolvePivots(bones).head, [100, 150]);
});

test('offsetMatrix turns about the pivot and moves by dx, dy in pixels', () => {
  const m = offsetMatrix(off({ rot: 90 }), [10, 10], 1000);
  near(applyMatrix(m, 10, 10), [10, 10]);      // the pivot stays
  near(applyMatrix(m, 20, 10), [10, 20]);      // clockwise on a y-down canvas
  near(applyMatrix(offsetMatrix(off({ dx: 0.1, dy: -0.05 }), [0, 0], 1000), 5, 5), [105, -45]);
  near(applyMatrix(offsetMatrix(off({ sx: 1, sy: 1 }), [10, 10], 1), 20, 10), [30, 10]); // doubled about the pivot
});

test('composeBones: rest is the identity, offsets carry the whole subtree and add up', () => {
  const pivots = resolvePivots(bones);
  const rest = composeBones(bones, new Map(), pivots, 1000);
  for (const b of Object.keys(bones)) near(applyMatrix(rest[b], 33, 44), [33, 44]);

  // A turn of the torso carries the arm and head with it; the parent is untouched.
  const torso = composeBones(bones, new Map([['torso', off({ rot: 90 })]]), pivots, 1000);
  near(applyMatrix(torso.head, 200, 150), [100, 250]);   // (200,150) about (100,150) by 90 degrees
  near(applyMatrix(torso.arm, 150, 100), [150, 200]);    // the arm pivot rides along
  near(applyMatrix(torso.root, 200, 150), [200, 150]);

  // The arm's own turn happens about its pivot first, then the torso carries the result: exact composition.
  const both = composeBones(bones, new Map([['torso', off({ rot: 90 })], ['arm', off({ rot: -90 })]]), pivots, 1000);
  near(applyMatrix(both.arm, 150, 100), [150, 200]);     // its pivot only follows the torso
  near(applyMatrix(both.arm, 200, 100), [200, 200]);     // (200,100) -> (150,50) by the arm, then -> (200,200) by the torso
  near(applyMatrix(both.head, 200, 150), [100, 250]);    // a sibling does not feel the arm's turn
});

test('composeBones: a loop or an unknown parent makes a root instead of hanging', () => {
  const m = composeBones({ a: { parent: 'b', pivot: [0, 0] }, b: { parent: 'a', pivot: [0, 0] }, c: { parent: 'ghost', pivot: [0, 0] } }, new Map([['a', off({ dx: 0.01 })]]), { a: [0, 0], b: [0, 0], c: [0, 0] }, 1000);
  near(applyMatrix(m.a, 0, 0), [10, 0]);
  near(applyMatrix(m.b, 0, 0), [0, 0]);
  near(applyMatrix(m.c, 0, 0), [0, 0]);
});

const manifest = rig => ({
  width: 100, height: 100,
  parts: [{ file: 'body.png' }, { file: 'head.png' }, { slot: 'eyes', default: 'open', variants: { open: { file: 'eo.png' } } }],
  rig,
});
const msgs = rig => checkRig(manifest(rig)).map(p => p.message);

test('checkRig: bones and parts', () => {
  const good = { bones: { root: { pivot: [50, 90] }, neck: { parent: 'root' }, skull: { parent: 'neck' } }, parts: { body: { bone: 'root' }, head: { bone: 'skull', pivot: [1, 2] }, eyes: { bone: 'skull' } } };
  assert.deepEqual(msgs(good), []);
  const bad = msgs({
    bones: { a: { parent: 'nope', pivot: [1] }, b: { parent: 'c' }, c: { parent: 'b' }, d: 5, body: {} },
    parts: { ghost: { bone: 'a' }, head: { bone: 'zzz' }, eyes: 3 },
  });
  for (const want of ['bones.a.parent: no bone named "nope"', 'bones.a.pivot: use [x, y]', 'bones: parents form a loop (b > c > b)', 'bones.d: needs an object', 'bones: "body" is also a part name', 'parts.ghost: no part', 'parts.head.bone: no bone named "zzz"', 'parts.eyes: needs an object']) {
    assert.ok(bad.some(m => m.includes(want)), `${want}\n${bad.join('\n')}`);
  }
});

test('checkRig: bones that move nothing or cannot turn are warned about', () => {
  const warn = msgs({ bones: { lone: { pivot: [1, 1] }, root: {}, kid: { parent: 'root' } }, parts: { body: { bone: 'kid' } } });
  assert.deepEqual(warn, ['bones: "lone" has no parts and no children, so it moves nothing']);
  const nopivot = msgs({ bones: { air: {} } });
  assert.deepEqual(nopivot, ['bones: "air" has no parts and no children, so it moves nothing']);
  const stuck = msgs({ bones: { top: {}, mid: { parent: 'top' } } });
  assert.deepEqual(stuck, ['bones: "top" has no pivot (and neither has anything above it) and no parts to measure one from, so it has nothing to turn about', 'bones: "mid" has no parts and no children, so it moves nothing']);
  assert.ok(msgs({ bones: { top: {}, mid: { parent: 'top' } }, parts: { eyes: { bone: 'mid' } } }).length === 0);
});

test('partsUnder lists the parts on a bone and on the bones below it', () => {
  const on = { hair: 'head', face: 'head', hand: 'arm', coat: 'torso', loose: undefined };
  assert.deepEqual(partsUnder(bones, on, 'head'), ['hair', 'face']);
  assert.deepEqual(partsUnder(bones, on, 'torso').sort(), ['coat', 'face', 'hair', 'hand']);
  assert.deepEqual(partsUnder(bones, on, 'hair'), []); // a part is not a bone
});

test('placeParts: a part follows its bone, its own offset goes on top about its pivot, a loose part just moves itself', () => {
  const box = (x, y) => ({ x, y, w: 10, h: 10 });
  const parts = { hand: { box: box(145, 95), bone: 'arm' }, hair: { box: box(0, 0), bone: 'head', pivot: [5, 5] }, loose: { box: box(20, 20) } };
  const rot = r => new Map([['torso', off({ rot: r })]]);
  // the torso turns 90 degrees about (100, 150): the hand at (150, 100) goes to (150, 200)
  const turned = placeParts(bones, parts, rot(90), () => null, [0, 0], 1);
  near(applyMatrix(turned.hand, 150, 100), [150, 200]);
  const rest = placeParts(bones, parts, new Map(), () => null, [0, 0], 1);
  near(applyMatrix(rest.hand, 150, 100), [150, 100]);
  near(applyMatrix(rest.loose, 3, 4), [3, 4]);
  // a key on the part itself turns about the middle of its box (loose), or its own pivot, below the bone
  const own = placeParts(bones, parts, new Map([['loose', off({ rot: 180 })], ['hair', off({ rot: 180 })]]), () => null, [0, 0], 1);
  near(applyMatrix(own.loose, 20, 20), [30, 30]);
  near(applyMatrix(own.hair, 0, 0), [10, 10]);
  // a part pivot wins over everything
  const pivoted = placeParts(bones, parts, new Map([['loose', off({ rot: 180 })]]), n => (n === 'loose' ? [0, 0] : null), [0, 0], 1);
  near(applyMatrix(pivoted.loose, 20, 20), [-20, -20]);
});

test('checkRig: keys may name a bone', () => {
  const m = { width: 10, height: 10, parts: [{ name: 'a', file: 'a.png', x: 0, y: 0 }], rig: { bones: { head: { pivot: [1, 1] } }, parts: { a: { bone: 'head' } }, animations: { nod: { keys: [{ t: 0.5, part: 'head', rot: 5 }] } } } };
  assert.deepEqual(checkRig(m).filter(p => /named/.test(p.message)), []);
});
