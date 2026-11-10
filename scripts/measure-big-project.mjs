// Measure how the editor and the dev server scale with the number of asset files (docs/design/editor-asset-scaling.md,
// step 0). For each count it makes a synthetic project (make-big-project.mjs), starts the dev server on it and opens the
// editor in a real browser (system Edge or Chrome through playwright-core, VN_BROWSER=<exe> overrides), then measures:
//   - GET /api/project from node: the median time of 5 requests and the response size;
//   - the Assets panel's redraw, timed around the filter's input handler (which redraws both panels synchronously): with
//     no filter (folders closed, as they start) and filtered to "bg_" (every match shown, so the bg folder is open);
//   - a change from outside the editor (park.vn rewritten unchanged on disk) and the editor's own autosave (a character
//     typed into park.vn): from the reload event until the editor settled (its last /api/project answer or panel change),
//     how long its /api/project request and the preview's took, and how many requests the editor made after a typed save;
//   - the page's element count and JS heap after loading.
// Uses the build in dist/ (run `npm run build` or `npm test` first) and leaves the sample alone: the project is a temp copy.
//
//   node scripts/measure-big-project.mjs [<count>...]    (default: 500 5000 20000)

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, startDevServer } from '../engine/test/helpers.mjs';
import { makeBigProject } from './make-big-project.mjs';

const counts = process.argv.slice(2).map(Number);
if (!counts.length) counts.push(500, 5000, 20000);

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function measure(browser, count) {
  const project = makeBigProject(count);
  const { origin: base, server } = await startDevServer({ env: { VN_PROJECT: project }, tries: 200 }); // a big project takes a while to index
  try {
    // The API from node.
    await (await fetch(`${base}/api/project`)).text();
    const apiTimes = [];
    let bytes = 0;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      bytes = (await (await fetch(`${base}/api/project`)).arrayBuffer()).byteLength;
      apiTimes.push(performance.now() - t);
    }

    // The editor.
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    // VN_PROFILE=1: a CPU profile of the editor's load, summed by function (self time).
    const cdp = process.env.VN_PROFILE ? await context.newCDPSession(page) : null;
    if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
    const loadStart = performance.now();
    await page.goto(`${base}/editor/`);
    await page.waitForFunction(() => !document.getElementById('sidebar').hidden && document.querySelectorAll('#sidebar details').length > 0, null, { timeout: 180000 });
    await page.waitForLoadState('networkidle', { timeout: 180000 }).catch(() => {});
    const loadMs = performance.now() - loadStart;
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
      const dt = profile.timeDeltas;
      profile.samples.forEach((id, i) => {
        const f = byId.get(id).callFrame;
        const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
        self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
      });
      console.log(`CPU self time while loading the editor with ${count} extra assets (ms):`);
      for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${Math.round(v)}\t${k}`);
    }
    const size = await page.evaluate(() => ({ elements: document.getElementsByTagName('*').length, heap: performance.memory?.usedJSHeapSize ?? 0 }));

    const redraw = filter => page.evaluate(f => {
      const el = document.getElementById('sbFilter');
      const t = performance.now();
      el.value = f;
      el.dispatchEvent(new Event('input'));
      return performance.now() - t;
    }, filter);
    const closed = [], open = [];
    for (let i = 0; i < 3; i++) { closed.push(await redraw('')); open.push(await redraw('bg_')); }
    await redraw('');

    // A save as the editor's autosave makes it: the file rewritten with the same text.
    await page.evaluate(() => {
      const w = window;
      w.__m = { event: [], mutation: 0 };
      for (const win of [w, ...[...document.querySelectorAll('iframe')].map(f => f.contentWindow)]) { // a full timing buffer drops new entries
        win.performance.clearResourceTimings();
        win.performance.setResourceTimingBufferSize(10000);
      }
      new EventSource('/__events').onmessage = () => w.__m.event.push(performance.now());
      // Requests in flight: resource timing lists a request only once it has finished.
      w.__m.inFlight = 0;
      const fetch0 = w.fetch;
      w.fetch = (...a) => { w.__m.inFlight++; return fetch0(...a).finally(() => { w.__m.inFlight--; }); };
      new MutationObserver(() => { w.__m.mutation = performance.now(); }).observe(document.getElementById('sidebar'), { childList: true, subtree: true });
    });
    await sleep(500); // the EventSource connects
    // After the reload event: wait until neither the panel nor the network has moved for 1.5 s, then report how long the
    // editor took to settle (its last /api/project answer or panel change, from the event) and what it fetched.
    const settle = async t0 => {
      await page.waitForFunction(t => window.__m.event.some(e => e > t), t0, { timeout: 60000 });
      await page.waitForFunction(() => {
        const last = Math.max(window.__m.mutation, ...window.__m.event, ...performance.getEntriesByType('resource').map(r => r.responseEnd));
        return window.__m.inFlight === 0 && performance.now() - last > 1500;
      }, null, { timeout: 120000, polling: 100 });
      return page.evaluate(t0 => {
        const event = window.__m.event.find(e => e > t0);
        const mine = performance.getEntriesByType('resource').filter(r => r.name.endsWith('/api/project') && r.startTime > t0);
        // The frames' clocks start at their own load: shift t0 into each frame's time.
        const frames = [...document.querySelectorAll('iframe')].map(f => f.contentWindow);
        const inFrame = win => win.performance.getEntriesByType('resource')
          .filter(r => r.name.endsWith('/api/project') && r.startTime + win.performance.timeOrigin > t0 + performance.timeOrigin).map(r => r.duration);
        return {
          settled: Math.max(0, window.__m.mutation - event, ...mine.map(r => r.responseEnd - event)),
          editorFetches: mine.length,
          editorFetch: Math.max(0, ...mine.map(r => r.duration)),
          previewFetch: Math.max(0, ...frames.flatMap(inFrame)),
        };
      }, t0);
    };
    // A change from outside the editor: park.vn rewritten unchanged on disk.
    const park = path.join(project, 'script', 'park.vn'), text = fs.readFileSync(park);
    const outside = [];
    for (let i = 0; i < 3; i++) {
      const t0 = await page.evaluate(() => performance.now());
      fs.writeFileSync(park, text);
      outside.push(await settle(t0));
    }
    // The editor's own autosave: a character typed at the end of the open script.
    const typed = [];
    await page.locator('.monaco-editor').first().click();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Control+End');
      const t0 = await page.evaluate(() => performance.now());
      await page.keyboard.type('#');
      typed.push(await settle(t0));
    }
    await context.close();
    const pick = (list, k) => median(list.map(s => s[k]));
    return {
      count, apiMs: median(apiTimes), apiKB: bytes / 1024, loadMs, ...size,
      redrawClosed: median(closed), redrawOpen: median(open),
      outsideSettled: pick(outside, 'settled'), editorFetch: pick(outside, 'editorFetch'), previewFetch: pick(outside, 'previewFetch'),
      typedSettled: pick(typed, 'settled'), typedFetches: pick(typed, 'editorFetches'),
    };
  } finally {
    server.kill();
    fs.rmSync(project, { recursive: true, force: true });
  }
}

const { browser, skip } = await launchBrowser();
if (!browser) throw new Error(skip);
const rows = [];
try {
  for (const n of counts) {
    console.log(`measuring ${n} extra assets...`);
    rows.push(await measure(browser, n));
  }
} finally {
  await browser.close();
}
const ms = x => `${Math.round(x)}`;
console.log('\n| Extra assets | /api/project (ms) | Size (KB) | Editor load (ms) | Elements | JS heap (MB) | Redraw, closed (ms) | Redraw, bg open (ms) | Outside change: settled (ms) | Editor fetch (ms) | Preview fetch (ms) | Typed save: settled (ms) | Typed save: editor fetches |');
console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) {
  console.log(`| ${r.count} | ${ms(r.apiMs)} | ${ms(r.apiKB)} | ${ms(r.loadMs)} | ${r.elements} | ${(r.heap / 2 ** 20).toFixed(1)} | ${ms(r.redrawClosed)} | ${ms(r.redrawOpen)} | ${ms(r.outsideSettled)} | ${ms(r.editorFetch)} | ${ms(r.previewFetch)} | ${ms(r.typedSettled)} | ${r.typedFetches} |`);
}
