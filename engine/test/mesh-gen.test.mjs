import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMesh, triangulate, MESH_DETAIL, MESH_MAX_VERTS } from '../../dist/engine/src/index.js';

const DETAILS = ['low', 'medium', 'high', 'veryhigh'];

function shape(w, h, inside) {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x + 0.5, y + 0.5)) a[y * w + x] = 255;
  return a;
}
const cross = (v, a, b, c) => (v[2 * b] - v[2 * a]) * (v[2 * c + 1] - v[2 * a + 1]) - (v[2 * b + 1] - v[2 * a + 1]) * (v[2 * c] - v[2 * a]);
const area = m => { let s = 0; for (let i = 0; i < m.tris.length; i += 3) s += cross(m.verts, m.tris[i], m.tris[i + 1], m.tris[i + 2]) / 2; return s; };
function hullArea(v) {
  const p = []; for (let i = 0; i < v.length; i += 2) p.push([v[i], v[i + 1]]);
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = pts => {
    const h = [];
    for (const q of pts) {
      while (h.length > 1 && (h.at(-1)[0] - h.at(-2)[0]) * (q[1] - h.at(-2)[1]) - (h.at(-1)[1] - h.at(-2)[1]) * (q[0] - h.at(-2)[0]) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  const hull = [...half(p), ...half([...p].reverse())];
  let s = 0;
  for (let i = 0; i < hull.length; i++) { const q = hull[(i + 1) % hull.length]; s += hull[i][0] * q[1] - q[0] * hull[i][1]; }
  return Math.abs(s) / 2;
}
/** How many triangles contain the point strictly (not on an edge). */
function covers(m, x, y) {
  let n = 0;
  const v = m.verts;
  for (let i = 0; i < m.tris.length; i += 3) {
    const [a, b, c] = [m.tris[i], m.tris[i + 1], m.tris[i + 2]];
    const A = cross(v, a, b, c);
    const l1 = ((v[2 * b] - x) * (v[2 * c + 1] - y) - (v[2 * b + 1] - y) * (v[2 * c] - x)) / A;
    const l2 = ((v[2 * c] - x) * (v[2 * a + 1] - y) - (v[2 * c + 1] - y) * (v[2 * a] - x)) / A;
    const l3 = 1 - l1 - l2;
    if (l1 > 1e-9 && l2 > 1e-9 && l3 > 1e-9) n++;
  }
  return n;
}
/** True when the point is inside or on some triangle. */
function touches(m, x, y) {
  const v = m.verts;
  for (let i = 0; i < m.tris.length; i += 3) {
    const t = [m.tris[i], m.tris[i + 1], m.tris[i + 2]];
    if (t.every((a, k) => {
      const b = t[(k + 1) % 3];
      return (v[2 * b] - v[2 * a]) * (y - v[2 * a + 1]) - (v[2 * b + 1] - v[2 * a + 1]) * (x - v[2 * a]) >= -1e-6;
    })) return true;
  }
  return false;
}
function checkValid(m, cap = MESH_MAX_VERTS) {
  assert.ok(m.verts.length / 2 <= cap, `${m.verts.length / 2} verts > ${cap}`);
  assert.equal(m.tris.length % 3, 0);
  const used = new Set(m.tris);
  for (let i = 0; i < m.verts.length / 2; i++) assert.ok(used.has(i), `vertex ${i} unused`);
  for (const i of m.tris) assert.ok(Number.isInteger(i) && i >= 0 && i < m.verts.length / 2);
  for (let i = 0; i < m.tris.length; i += 3) assert.ok(cross(m.verts, m.tris[i], m.tris[i + 1], m.tris[i + 2]) > 1e-9, `triangle ${i / 3} not positive`);
}
function noOverlap(m, w, h, probes = 400) {
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < probes; i++) assert.ok(covers(m, rnd() * w, rnd() * h) <= 1, 'overlapping triangles');
}
function coversOpaque(m, a, w, h) {
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if (a[y * w + x] >= 128) assert.ok(touches(m, x + 0.5, y + 0.5), `opaque pixel ${x},${y} not covered`);
  }
}
const bbox = v => {
  let a = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 2) a = [Math.min(a[0], v[i]), Math.min(a[1], v[i + 1]), Math.max(a[2], v[i]), Math.max(a[3], v[i + 1])];
  return a;
};

test('rectangle: valid, convex fill, margin reached, opaque covered', () => {
  const w = 120, h = 80;
  const a = shape(w, h, (x, y) => x > 20 && x < 100 && y > 15 && y < 65);
  for (const detail of DETAILS) {
    const m = generateMesh(a, w, h, { detail, margin: 6 });
    checkValid(m);
    assert.ok(Math.abs(area(m) - hullArea(m.verts)) < 1e-6 * hullArea(m.verts), 'convex region is filled exactly');
    noOverlap(m, w, h);
    coversOpaque(m, a, w, h);
    const [x0, y0, x1, y1] = bbox(m.verts);
    assert.ok(x0 <= 20 - 6 * 0.9 && y0 <= 15 - 6 * 0.9 && x1 >= 100 + 6 * 0.9 && y1 >= 65 + 6 * 0.9, `margin ${[x0, y0, x1, y1]}`);
  }
});

test('art touching the image edge: the mesh stays inside the image box (a texture has no pixels outside it)', () => {
  const w = 120, h = 80;
  const a = shape(w, h, (x, y) => (x - 60) ** 2 / 3600 + (y - 40) ** 2 / 1600 <= 1); // an ellipse that touches all four edges
  for (const detail of DETAILS) {
    const m = generateMesh(a, w, h, { detail, margin: 6 });
    checkValid(m);
    noOverlap(m, w, h);
    const [x0, y0, x1, y1] = bbox(m.verts);
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= w && y1 <= h, `${detail} reaches outside the image: ${[x0, y0, x1, y1]}`);
  }
});

test('circle: higher detail gives more vertices, cap respected', () => {
  const w = 200, h = 200;
  const a = shape(w, h, (x, y) => Math.hypot(x - 100, y - 100) < 80);
  const counts = DETAILS.map(detail => {
    const m = generateMesh(a, w, h, { detail });
    checkValid(m);
    noOverlap(m, w, h);
    coversOpaque(m, a, w, h);
    assert.ok(Math.abs(area(m) - hullArea(m.verts)) < 0.02 * hullArea(m.verts));
    return m.verts.length / 2;
  });
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1], `counts ${counts}`);
  for (const cap of [20, 60, 120]) for (const detail of DETAILS) {
    const m = generateMesh(a, w, h, { detail, maxVerts: cap });
    assert.ok(m.tris.length > 0);
    checkValid(m, cap);
  }
});

test('ring keeps its hole; L-shape is valid', () => {
  const w = 200, h = 200;
  const ring = shape(w, h, (x, y) => { const d = Math.hypot(x - 100, y - 100); return d < 85 && d > 40; });
  for (const detail of DETAILS) {
    const m = generateMesh(ring, w, h, { detail });
    checkValid(m);
    noOverlap(m, w, h);
    coversOpaque(m, ring, w, h);
    assert.equal(covers(m, 100, 100), 0, 'hole centre is empty');
  }
  const L = shape(w, h, (x, y) => (x > 30 && x < 80 && y > 20 && y < 180) || (x > 30 && x < 170 && y > 130 && y < 180));
  for (const detail of DETAILS) {
    const m = generateMesh(L, w, h, { detail });
    checkValid(m);
    noOverlap(m, w, h);
    coversOpaque(m, L, w, h);
    assert.equal(covers(m, 140, 60), 0, 'concave corner is empty');
  }
});

test('two islands give two separate meshes', () => {
  const w = 240, h = 100;
  const a = shape(w, h, (x, y) => (x > 10 && x < 90 && y > 10 && y < 90) || Math.hypot(x - 180, y - 50) < 45);
  const m = generateMesh(a, w, h, { detail: 'medium' });
  checkValid(m);
  noOverlap(m, w, h);
  coversOpaque(m, a, w, h);
  assert.equal(covers(m, 112, 50), 0);
  for (let i = 0; i < m.verts.length; i += 2) assert.ok(m.verts[i] < 100 || m.verts[i] > 125);
});

test('fully transparent and degenerate input give an empty mesh', () => {
  assert.deepEqual(generateMesh(new Uint8Array(50 * 50), 50, 50, { detail: 'high' }), { verts: [], tris: [] });
  assert.deepEqual(generateMesh(new Uint8Array(0), 0, 0, { detail: 'high' }), { verts: [], tris: [] });
  assert.throws(() => generateMesh(new Uint8Array(4), 2, 2, { detail: 'nope' }), /detail/);
});

test('a single opaque pixel and a thin line still mesh', () => {
  const a = new Uint8ClampedArray(30 * 30); a[15 * 30 + 15] = 255;
  checkValid(generateMesh(a, 30, 30, { detail: 'veryhigh' }));
  const line = shape(100, 20, (x, y) => y > 9 && y < 11 && x > 5 && x < 95);
  const m = generateMesh(line, 100, 20, { detail: 'high' });
  checkValid(m);
  noOverlap(m, 100, 20);
});

test('large images are meshed on a reduced grid but in the image own pixels', () => {
  const w = 2000, h = 1500;
  const a = shape(w, h, (x, y) => Math.hypot((x - 1000) / 900, (y - 750) / 600) < 1);
  const m = generateMesh(a, w, h, { detail: 'high' });
  checkValid(m);
  const [x0, y0, x1, y1] = bbox(m.verts);
  assert.ok(x0 < 100 && x1 > 1900 && y0 < 150 && y1 > 1350 && x0 > -100 && y1 < 1600);
});

test('detail constants are ordered', () => {
  for (let i = 1; i < DETAILS.length; i++) {
    assert.ok(MESH_DETAIL[DETAILS[i]].tol < MESH_DETAIL[DETAILS[i - 1]].tol);
    assert.ok(MESH_DETAIL[DETAILS[i]].spacing < MESH_DETAIL[DETAILS[i - 1]].spacing);
  }
});

test('triangulate: random point sets are valid Delaunay fills', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let round = 0; round < 25; round++) {
    const n = 3 + Math.floor(rnd() * 120), pts = [];
    for (let i = 0; i < n; i++) pts.push(rnd() * 100, rnd() * 100);
    const m = triangulate(pts);
    checkValid(m, n);
    assert.equal(m.verts.length, pts.length);
    const hull = hullArea(pts), got = area(m);
    assert.ok(got <= hull + 1e-6 && got >= hull * 0.999, `area ${got} vs hull ${hull}`);
    const v = m.verts;
    for (let i = 0; i < m.tris.length; i += 3) {
      const [a, b, c] = [m.tris[i], m.tris[i + 1], m.tris[i + 2]];
      for (let p = 0; p < n; p++) {
        if (p === a || p === b || p === c) continue;
        const ax = v[2 * a] - v[2 * p], ay = v[2 * a + 1] - v[2 * p + 1], bx = v[2 * b] - v[2 * p], by = v[2 * b + 1] - v[2 * p + 1], cx = v[2 * c] - v[2 * p], cy = v[2 * c + 1] - v[2 * p + 1];
        const det = (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
        assert.ok(det < 1e-6, 'point inside circumcircle');
      }
    }
  }
});

test('triangulate: constraint edges survive on a concave polygon', () => {
  const poly = [0, 0, 100, 0, 100, 100, 55, 100, 55, 10, 45, 10, 45, 100, 0, 100];
  const segs = [];
  for (let i = 0; i < 8; i++) segs.push(i, (i + 1) % 8);
  const m = triangulate(poly, segs);
  const edges = new Set();
  for (let i = 0; i < m.tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = m.tris[i + k], b = m.tris[i + (k + 1) % 3];
      edges.add(`${a}-${b}`); edges.add(`${b}-${a}`);
    }
  }
  for (let s = 0; s < segs.length; s += 2) {
    const [a, b] = [segs[s], segs[s + 1]];
    if (edges.has(`${a}-${b}`)) continue;
    // Split by Steiner points (indices >= 8) lying on the segment.
    const ax = poly[2 * a], ay = poly[2 * a + 1], bx = poly[2 * b], by = poly[2 * b + 1];
    let mids = 0;
    for (let i = 8; i < m.verts.length / 2; i++) {
      const x = m.verts[2 * i], y = m.verts[2 * i + 1];
      const onLine = Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) < 1e-6;
      if (onLine && x >= Math.min(ax, bx) - 1e-9 && x <= Math.max(ax, bx) + 1e-9 && y >= Math.min(ay, by) - 1e-9 && y <= Math.max(ay, by) + 1e-9) mids++;
    }
    assert.ok(mids > 0, `constraint ${a}-${b} lost`);
  }
});

test('triangulate: a thin outline whose long sides a plain Delaunay misses is conformed in a bounded number of splits', () => {
  // The outline of the sample robo's legs at medium detail with no margin: two near-vertical sides a few pixels apart, each a chain of almost collinear
  // segments. Splitting a segment that cannot become an edge used to go on for ever (the process ran out of memory); now the depth is capped.
  const pts = [9, 0, 57, 0, 61, 7, 61.5, 57.833333, 62, 108.666667, 62.5, 159.5, 63, 210.333333, 63.5, 261.166667, 64, 312, 70, 304, 69.8, 244.6, 69.6, 185.2, 69.4, 125.8, 69.2, 66.4, 69, 7,
    73, 0, 121, 0, 125, 7, 125, 65.6, 125, 124.2, 125, 182.8, 125, 241.4, 125, 300, 130, 304, 126, 338, 73, 338, 66, 326, 57, 338, 0, 334, 0, 304, 5, 300, 5.8, 240, 6.6, 180, 7.4, 120, 8.2, 60];
  const n = pts.length / 2, segs = [];
  for (let i = 0; i < n; i++) segs.push(i, (i + 1) % n);
  const m = triangulate(pts, segs);
  assert.ok(m.tris.length > 0, 'it triangulates');
  assert.ok(m.verts.length / 2 <= n + 3 + 20 * n + 1000, `the extra points stay bounded (${m.verts.length / 2})`);
  assert.deepEqual(m.verts.slice(0, 2 * n), pts, 'the input points come first, unchanged');
  for (let i = 0; i < m.tris.length; i += 3) {
    const [a, b, c] = [m.tris[i], m.tris[i + 1], m.tris[i + 2]], v = m.verts;
    assert.ok((v[2 * b] - v[2 * a]) * (v[2 * c + 1] - v[2 * a + 1]) - (v[2 * b + 1] - v[2 * a + 1]) * (v[2 * c] - v[2 * a]) > 0, 'every triangle has a positive area');
  }
});

test('a margin below 2 px is taken as 2: with none the outline follows every pixel step (SD-14)', () => {
  const w = 40, h = 60, a = new Uint8Array(w * h);
  for (let y = 5; y < 55; y++) for (let x = 10 + (y % 3); x < 30 - (y % 2); x++) a[y * w + x] = 255; // a jagged edge
  const zero = generateMesh(a, w, h, { detail: 'medium', margin: 0 }), two = generateMesh(a, w, h, { detail: 'medium', margin: 2 });
  assert.deepEqual(zero, two);
});
