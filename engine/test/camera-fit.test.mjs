import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overscanZoom } from '../../dist/engine/src/index.js';

const W = 1280, H = 720;

test('overscanZoom: rest is 1, a shift or roll raises it, and the result keeps every corner inside the stage', () => {
  assert.equal(overscanZoom(W, H, W / 2, H / 2, 0, 0, 0), 1);
  assert.ok(Math.abs(overscanZoom(W, H, W / 2, H / 2, 0, 20, 0) - (1 + 20 / (W / 2))) < 1e-9);
  assert.ok(Math.abs(overscanZoom(W, H, 0, 0, 0, 0, 0) - 1) < 1e-9, 'a pivot on the edge does not divide by zero');
  for (const [px, py, r, dx, dy] of [[640, 360, 0.1, 0, 0], [300, 200, -0.2, 15, -9], [1280, 720, 0.05, 0, 0]]) {
    const z = overscanZoom(W, H, px, py, r, dx, dy), cos = Math.cos(r), sin = Math.sin(r);
    const tx = px - z * (cos * px - sin * py) + dx, ty = py - z * (sin * px + cos * py) + dy;
    for (const [sx, sy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
      const ux = sx - tx, uy = sy - ty; // inverse of p -> z R p + t
      const wx = (cos * ux + sin * uy) / z, wy = (-sin * ux + cos * uy) / z;
      assert.ok(wx > -1e-6 && wx < W + 1e-6 && wy > -1e-6 && wy < H + 1e-6, `corner ${sx},${sy} lands inside at ${px},${py},${r}`);
    }
  }
});
