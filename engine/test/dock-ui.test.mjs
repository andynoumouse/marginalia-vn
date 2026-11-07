// The docking layer (editor/dock-ui.ts) in a real browser, on its own test bench (editor/dock-sandbox.html), with no game project and no
// studio. Not in the fast set (it needs a browser): `npm run test:dock`. Skipped without playwright-core or a Chrome/Edge.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { /* optional */ }

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }).on('error', reject);
});

let server, browser, url, skip;
before(async () => {
  if (!chromium) { skip = 'playwright-core is not installed'; return; }
  for (const opts of process.env.VN_BROWSER ? [{ executablePath: process.env.VN_BROWSER }] : [{ channel: 'msedge' }, { channel: 'chrome' }]) {
    try { browser = await chromium.launch(opts); break; } catch { /* next */ }
  }
  if (!browser) { skip = 'no Chrome or Edge found (set VN_BROWSER)'; return; }
  const port = await freePort();
  url = `http://localhost:${port}/editor/dock-sandbox.html`;
  server = spawn(process.execPath, ['preview/dev-server.mjs', '--studio-only', '--no-build'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not listening yet */ }
    if (i > 100) throw new Error('dev server did not start');
    await new Promise(r => setTimeout(r, 100));
  }
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(t, fn) {
  if (skip) return t.skip(skip);
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  try { const page = await ctx.newPage(); await page.goto(url); await page.waitForFunction(() => window.vnDock); await fn(page); } finally { await ctx.close(); }
}
const layout = page => page.evaluate(() => window.vnDock.layout);
const domOrder = (page, zone) => page.$$eval(`#z-${zone} > .panel`, els => els.map(e => e.id.slice(2)));
const centre = async (page, sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };

async function drag(page, from, to) {
  const a = await centre(page, `#p-${from} h2`);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  return async () => { await page.mouse.up(); };
}

test('panels start in their zones in spec order', async t => open(t, async page => {
  assert.deepEqual(await domOrder(page, 'left'), ['tree', 'params']);
  assert.deepEqual(await domOrder(page, 'center'), ['stage']);
  assert.deepEqual(await domOrder(page, 'right'), ['sel', 'warp']);
}));

test('dragging a title to the top half of another panel drops it before that panel, in the DOM and in the saved layout', async t => open(t, async page => {
  const tree = await centre(page, '#p-tree');
  const up = await drag(page, 'sel', { x: tree.x, y: tree.b.y + 4 });
  assert.equal(await page.locator('.dock-drop-line').isVisible(), true, 'a drop line shows while dragging');
  await up();
  assert.deepEqual(await domOrder(page, 'left'), ['sel', 'tree', 'params']);
  assert.deepEqual(await domOrder(page, 'right'), ['warp']);
  assert.deepEqual((await layout(page)).left, ['sel', 'tree', 'params']);
  await page.reload();
  await page.waitForFunction(() => window.vnDock);
  assert.deepEqual(await domOrder(page, 'left'), ['sel', 'tree', 'params'], 'kept across a reload');
  assert.equal(await page.locator('.dock-drop-line').isVisible(), false);
}));

test('a panel is not dropped where it may not go, and Escape cancels a drag', async t => open(t, async page => {
  const mid = await centre(page, '#z-center');
  let up = await drag(page, 'warp', mid);
  assert.equal(await page.locator('.dock-drop-line').isVisible(), false, 'no line over a zone the panel may not enter');
  await up();
  assert.deepEqual(await domOrder(page, 'right'), ['sel', 'warp']);
  const left = await centre(page, '#z-left');
  up = await drag(page, 'sel', left);
  await page.keyboard.press('Escape');
  await up();
  assert.deepEqual(await domOrder(page, 'left'), ['tree', 'params'], 'cancelled');
  assert.ok(await page.evaluate(() => window.vnDock.isDefault()));
}));

test('a click on a title without moving changes nothing', async t => open(t, async page => {
  await page.click('#p-tree h2');
  assert.ok(await page.evaluate(() => window.vnDock.isDefault()));
}));

test('Alt+arrows move the focused panel, and the focus stays on its title', async t => open(t, async page => {
  await page.focus('#p-tree h2');
  await page.keyboard.press('Alt+ArrowDown');
  assert.deepEqual(await domOrder(page, 'left'), ['params', 'tree']);
  await page.keyboard.press('Alt+ArrowRight');
  assert.deepEqual(await domOrder(page, 'center'), ['stage', 'tree'], 'the tree has no zone limit, so it joins the center');
  assert.equal(await page.evaluate(() => document.activeElement?.parentElement?.id), 'p-tree');
}));

test('Reset layout puts everything back, and hiding a panel keeps it in the DOM, in its place, with the hidden attribute', async t => open(t, async page => {
  await page.focus('#p-sel h2');
  await page.keyboard.press('Alt+ArrowLeft');
  assert.ok(!(await page.evaluate(() => window.vnDock.isDefault())));
  await page.click('#reset');
  assert.ok(await page.evaluate(() => window.vnDock.isDefault()));
  assert.deepEqual(await domOrder(page, 'right'), ['sel', 'warp']);
  await page.click('#hide');
  assert.deepEqual(await page.$$eval('#z-right > .panel:not([hidden])', els => els.map(e => e.id.slice(2))), ['sel']);
  assert.deepEqual(await domOrder(page, 'right'), ['sel', 'warp'], 'still in the DOM, in its place');
  assert.equal(await page.locator('#p-warp').getAttribute('hidden') !== null, true);
  await page.click('#hide');
  assert.deepEqual(await domOrder(page, 'right'), ['sel', 'warp']);
}));
