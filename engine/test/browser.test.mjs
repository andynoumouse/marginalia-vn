// Browser-level tests for the game shell: the dev server runs on the sample project and a real Chromium-family
// browser (driven by playwright-core) plays park.vn and demo.vn through the title screen, the text box, choices,
// skip/auto, rollback, quick save, menus, the name prompt, save/load screens, history, gallery and NVL.
// The browser is the system's Edge or Chrome (set VN_BROWSER to an executable to use another one). Without
// playwright-core or a browser the tests are skipped, so `npm test` still works everywhere.
// Tests hard-code the start of park.vn (see CLAUDE.md), and need the build in dist/ (`npm test` does that).
import { before, after, describe, test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = fileURLToPath(new URL('../..', import.meta.url));

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { /* optional */ }

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }).on('error', reject);
  });
}

let server, browser, base, skipReason, snapshot, sampleCopy;

// Every test has its own browser context (own localStorage, own mocked /api routes) and the dev server is read-only here,
// so they do not interact: they are collected and run VN_BROWSER_JOBS at a time (default 6; 1 runs them in order) by the suite at the
// end of the file. 6 jobs take ~32 s against ~150 s for 1 and passed 6 runs out of 6 (also with tsc running alongside), but
// an earlier 4-job run failed one pointer/timing test once, so if a test fails only in a full run, retry it with VN_BROWSER_JOBS=1.
const queued = [];
const test = (...args) => { queued.push(args); };

before(async () => {
  if (!chromium) { skipReason = 'playwright-core is not installed'; return; }
  const launch = process.env.VN_BROWSER ? [{ executablePath: process.env.VN_BROWSER }] : [{ channel: 'msedge' }, { channel: 'chrome' }];
  for (const opts of launch) {
    try { browser = await chromium.launch(opts); break; } catch { /* try the next one */ }
  }
  if (!browser) { skipReason = 'no Chrome or Edge found (set VN_BROWSER)'; return; }
  // The dev server serves PixiJS and Monaco from the project's own node_modules. A fresh git worktree has none (node
  // still finds playwright-core in a parent folder, so the tests do not skip): fail now, not 30 s per test later.
  for (const dep of ['pixi.js', 'monaco-editor']) {
    if (!existsSync(path.join(root, 'node_modules', dep))) {
      throw new Error(`${dep} is missing from ${path.join(root, 'node_modules')}: run \`npm install\` here (a new git worktree has no node_modules)`);
    }
  }
  // Serve a frozen copy of dist/: a tsc run in the checkout meanwhile rewrites dist/ in place, which broke running tests
  // (half-written files, and the server's watcher reloading every page).
  snapshot = mkdtempSync(path.join(tmpdir(), 'vn-browser-'));
  cpSync(path.join(root, 'dist'), path.join(snapshot, 'dist'), { recursive: true });
  // Likewise a temp copy of the sample project (without its build/ output, ~500 MB): a stray PUT /api/... from a test
  // that went wrong (autosave typing into the editor, say) lands in the copy, not in games/sample.
  const sampleSrc = path.join(root, 'games', 'sample');
  sampleCopy = path.join(snapshot, 'sample');
  cpSync(sampleSrc, sampleCopy, { recursive: true, filter: src => path.relative(sampleSrc, src) !== 'build' });
  const port = await freePort();
  base =`http://localhost:${port}/`;
  server = spawn(process.execPath, ['preview/dev-server.mjs', '--no-build', '--no-art'], {
    cwd: root, env: { ...process.env, PORT: String(port), VN_DIST_ROOT: snapshot, VN_PROJECT: sampleCopy }, stdio: 'ignore',
  });
  for (let i = 0; ; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* not listening yet */ }
    if (i > 100) throw new Error('dev server did not start');
    await new Promise(r => setTimeout(r, 100));
  }
});

after(async () => {
  await browser?.close();
  server?.kill();
  if (snapshot) rmSync(snapshot, { recursive: true, force: true });
});

// A fresh browser context per test: empty localStorage, so no saves or settings leak between tests.
function play(name, fn, setup) {
  test(name, async t => {
    if (skipReason) { t.skip(skipReason); return; }
    const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    await setup?.(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(base);
      await page.getByRole('button', { name: 'New game' }).waitFor();
      await fn(page);
      assert.deepEqual(errors, [], 'the page threw errors');
    } finally {
      await context.close();
    }
  });
}

const text = page => page.locator('#text').innerText();
const status = page => page.locator('#status').innerText();
// A generous wait: it costs time only when a test is failing anyway, and a machine that is busy with something else
// (another build, a virus scan) stalled the typing timers past the old 8 s now and then, in a different test each time.
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 });
const newGame = async page => {
  await page.getByRole('button', { name: 'New game' }).click();
  await until(page, () => document.getElementById('box').dataset.visible === 'true');
};
const textDone = page => until(page, () => document.getElementById('box').dataset.done === 'true');
const menuOpen = page => until(page, () => document.getElementById('menu').dataset.visible === 'true');
// Press Space until the choice menu is up: finishes the typing and moves through the lines before it.
async function toChoice(page) {
  for (let i = 0; i < 12; i++) {
    if (await page.locator('#menu[data-visible="true"]').count()) return;
    await textDone(page).catch(() => {});
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
  }
  await menuOpen(page);
}

play('title screen offers the configured buttons and New game starts the story', async page => {
  const buttons = await page.locator('#titleui [data-act]').allInnerTexts();
  assert.deepEqual(buttons, ['New game', 'Continue', 'Load', 'Gallery', 'Music', 'Chapters', 'Achievements', 'Options']);
  await newGame(page);
  assert.match(await status(page), /^park\.vn:\d+$/);
  await textDone(page);
  assert.match(await text(page), /^The park was nearly/);
});

play('a click finishes the typing, the next click advances to the next line', async page => {
  await newGame(page);
  const stage = page.locator('#stage');
  await stage.click();
  await textDone(page);
  assert.equal(await text(page), 'The park was nearly empty. Only one bench was occupied.');
  await stage.click();
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  assert.equal(await page.locator('#name').innerText(), 'Alice');
});

// ---- a line longer than the text box holds is split into pages of three lines ----
const LONG_LINE = Array.from({ length: 90 }, (_, i) => `word${i + 1}`).join(' ');
play('screen readers: a finished line is put into the polite live region as speaker and text', async page => {
  const live = () => page.locator('#lineLive').textContent();
  await newGame(page);
  await textDone(page);
  await until(page, () => document.getElementById('lineLive').textContent !== '');
  assert.equal(await live(), (await page.locator('#name').innerText()).trim() ? `${(await page.locator('#name').innerText()).trim()}: ${(await text(page)).replace(/\s+/g, ' ').trim()}` : (await text(page)).replace(/\s+/g, ' ').trim());
  assert.equal(await page.locator('#lineLive').getAttribute('aria-live'), 'polite');
  await page.evaluate(() => { document.getElementById('lineLive').textContent = ''; });
  await page.keyboard.press('Space');
  await textDone(page);
  await until(page, () => document.getElementById('lineLive').textContent !== '');
  assert.notEqual(await live(), '');
});

play('a long line is split into pages: each fits the box, a click turns the page, the last click moves on', async page => {
  await newGame(page);
  const pages = [];
  for (let i = 0; i < 8 && pages.join(' ') !== LONG_LINE; i++) {
    await page.keyboard.press('Space'); // finishes the page's typing
    await textDone(page);
    const shown = await page.evaluate(() => {
      const t = document.getElementById('text'), lh = parseFloat(getComputedStyle(t).lineHeight);
      return { text: t.textContent, lines: Math.round(t.offsetHeight / lh), boxTop: document.getElementById('box').offsetTop };
    });
    assert.ok(shown.lines <= 3, `page ${i + 1} has ${shown.lines} lines`);
    assert.ok(shown.boxTop > 0, 'the box stays on the stage');
    pages.push(shown.text.trim());
    await page.keyboard.press('Space'); // to the next page
    await until(page, () => document.getElementById('box').dataset.done !== 'true');
  }
  assert.ok(pages.length >= 2, 'the line took more than one page');
  assert.equal(pages.join(' '), LONG_LINE, 'no word is lost or repeated');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    for (const s of proj.scripts) if (s.file === 'park.vn') s.text = s.text.replace('The park was nearly empty. Only one bench was occupied.', LONG_LINE);
    await route.fulfill({ response: res, json: proj });
  });
});

play('choices: number keys pick an option and the story branches', async page => {
  await newGame(page);
  await toChoice(page);
  const options = await page.locator('#menu button').allInnerTexts();
  assert.deepEqual(options, ['Sorry, I got lost.', "You didn't have to wait."]);
  await page.keyboard.press('2');
  await until(page, () => document.getElementById('menu').dataset.visible !== 'true');
  await until(page, () => /Don't flatter yourself/.test(document.getElementById('text').textContent));
});

play('choices: arrow keys move focus and Enter picks', async page => {
  await newGame(page);
  await toChoice(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "You didn't have to wait.");
  await page.keyboard.press('Enter');
  await until(page, () => /Don't flatter yourself/.test(document.getElementById('text').textContent));
});

play('Tab does not skip unread text and says so', async page => {
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Tab');
  await page.locator('#toast[data-show="true"]').waitFor();
  assert.match(await page.locator('#toast').innerText(), /unread/i);
  assert.equal(await page.locator('#quickui [aria-pressed="true"]').count(), 0);
});

play('with "skip unread" on, Tab skips through the lines and stops at the choice', async page => {
  await page.locator('#titleui [data-act="options"]').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await page.locator('#optionsui [role="tab"]', { hasText: 'Game' }).click();
  await page.locator('#optionsui [data-id="skip"]').click(); await page.locator('#optionsui [data-id="skip.all"]').click(); // Read text only -> All text
  await page.keyboard.press('Escape');
  await page.locator('#options').waitFor({ state: 'hidden' });
  await newGame(page);
  await page.keyboard.press('Tab');
  await menuOpen(page);
  assert.equal(await page.locator('#menu button').count(), 2);
  assert.equal(await page.locator('#quickui [aria-pressed="true"]').count(), 0); // the choice ended the skipping
});

play('auto mode advances by itself up to the choice', async page => {
  await newGame(page);
  await page.keyboard.press('a');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  await menuOpen(page);
  await page.keyboard.press('a'); // off again
});

play('PageUp rolls back to the previous line', async page => {
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  await page.keyboard.press('PageUp');
  await until(page, () => document.getElementById('name').textContent === '');
  await until(page, () => /^The park was nearly/.test(document.getElementById('text').textContent));
});

play('F5 quick saves and F9 returns to the saved line', async page => {
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  const saved = await status(page);
  await page.keyboard.press('F5');
  await toChoice(page);
  await page.keyboard.press('1');
  await until(page, () => /Lost\?/.test(document.getElementById('text').textContent));
  await page.keyboard.press('F9');
  await page.locator('#confirm').getByRole('button', { name: 'Yes' }).click();
  await until(page, s => document.getElementById('status').textContent === s, saved);
  assert.equal(await page.locator('#name').innerText(), 'Alice');
});

play('H hides the interface and a click brings it back', async page => {
  await newGame(page);
  await page.keyboard.press('h');
  await until(page, () => document.getElementById('stage').dataset.uiHidden === 'true');
  assert.equal(await page.locator('#box').isVisible(), false);
  await page.locator('#stage').click();
  await until(page, () => document.getElementById('stage').dataset.uiHidden !== 'true');
  assert.equal(await page.locator('#box').isVisible(), true);
});

play('Escape opens the pause menu, Options has tabs, Escape closes them', async page => {
  await newGame(page);
  await page.keyboard.press('Escape');
  await page.locator('#pauseui [data-act="resume"]').waitFor({ state: 'visible' });
  await page.locator('#pauseui').getByRole('button', { name: 'Options' }).click();
  await page.locator('#options').waitFor({ state: 'visible' });
  const tabs = await page.locator('#optionsui [role="tab"]').allInnerTexts();
  assert.deepEqual(tabs, ['Audio', 'Game', 'Accessibility']);
  await page.locator('#optionsui [role="tab"]', { hasText: 'Accessibility' }).click();
  assert.equal(await page.locator('#optionsui [role="tab"][aria-selected="true"]').innerText(), 'Accessibility');
  await page.keyboard.press('Escape');
  await page.locator('#options').waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await page.locator('#pauseui [data-act="resume"]').waitFor({ state: 'hidden' });
  await textDone(page);
  assert.match(await text(page), /^The park was nearly/); // still the same line: the game was only paused
});

play('the name prompt takes typed text and the story uses it', async page => {
  await page.evaluate(() => window.postMessage({ type: 'goto', file: 'demo.vn', line: 14 }, location.origin));
  await menuOpen(page);
  const field = page.locator('#menu input[type="text"]');
  await field.fill('Sam');
  await page.keyboard.press('Enter');
  await until(page, () => /Nice to meet you, Sam\./.test(document.getElementById('text').textContent));
});

play('animation studio: the embedded page shows one character and answers play/seek messages', async page => {
  const result = await page.evaluate(async () => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:400px;height:300px;left:0;top:0';
    const got = [];
    addEventListener('message', e => { if (e.source === f.contentWindow) got.push(e.data); });
    f.src = '/?studio=mina';
    document.body.append(f);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 100 && !got.some(m => m.type === 'studioReady'); i++) await wait(100);
    const post = m => f.contentWindow.postMessage(m, location.origin);
    post({ type: 'studioAnims', anims: { wave: { dur: 0.3, keys: [{ t: 0.5, rot: 10 }] } } });
    post({ type: 'studioSeek', name: 'wave', t: 0.5 });
    post({ type: 'studioPlay', name: 'wave', dur: 0.3 });
    await wait(800);
    const doc = f.contentDocument;
    return {
      ready: got.some(m => m.type === 'studioReady'),
      last: got.filter(m => m.type === 'studioTime').at(-1),
      studio: doc.documentElement.dataset.studio,
      bar: getComputedStyle(doc.getElementById('bar')).display,
    };
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.last, { type: 'studioTime', t: 1, playing: false });
  assert.equal(result.studio, '');
  assert.equal(result.bar, 'none');
});

const slotCards = page => page.locator('#savesui [data-act="slot"]');
const slotButton = (page, n) => slotCards(page).nth(n);
const enabledSlots = page => page.locator('#savesui [data-act="slot"][data-on="true"]');
const savesText = page => page.locator('#savesui').innerText();
const confirmYes = page => page.locator('#confirm').getByRole('button', { name: 'Yes' }).click();
async function openPause(page, button) {
  await page.keyboard.press('Escape');
  await page.locator('#pauseui [data-act="resume"]').waitFor({ state: 'visible' });
  await page.locator('#pauseui').getByRole('button', { name: button }).click();
  await page.locator('#saves').waitFor({ state: 'visible' });
}

play('saves: a manual save fills a slot, Continue/Load bring it back, the delete button removes it', async page => {
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  const saved = await status(page);
  await openPause(page, 'Save');
  assert.equal(await slotCards(page).count(), 6);
  await slotButton(page, 0).click(); // an empty slot saves at once, with no confirmation
  await until(page, () => document.querySelector('#savesui [data-act="remove"]'));
  assert.match(await savesText(page), /Alice/);
  await slotButton(page, 0).click(); // a filled slot asks before overwriting
  await page.locator('#confirm').waitFor({ state: 'visible' });
  assert.match(await page.locator('#confirmText').innerText(), /Overwrite/);
  assert.equal(await page.locator('#saves').isVisible(), true); // the save screen stays behind the question
  const looks = () => page.evaluate(() => ['confirmYes', 'confirmNo'].map(id => {
    const b = document.getElementById(id), cs = getComputedStyle(b);
    return { variant: b.dataset.variant, border: cs.borderTopColor, accent: getComputedStyle(document.getElementById('stage')).getPropertyValue('--vn-accent').trim() };
  }));
  const [yes, no] = await looks(); // Yes is the dialog's main action: accent border; No keeps the stock look
  assert.equal(yes.variant, 'primary');
  assert.equal(yes.border, 'rgb(95, 209, 195)');
  assert.equal(yes.accent, '#5fd1c3');
  assert.equal(no.variant, undefined);
  assert.notEqual(no.border, yes.border);
  await page.locator('#confirm').getByRole('button', { name: 'No' }).click();
  await page.locator('#confirm').waitFor({ state: 'hidden' });
  // Back to the title and load it from there.
  await page.keyboard.press('Escape'); // closes the saves screen
  await page.locator('#saves').waitFor({ state: 'hidden' });
  await page.locator('#pauseui').getByRole('button', { name: 'Main menu' }).click();
  await confirmYes(page);
  await page.locator('#titleui [data-act="load"]').click();
  await page.locator('#saves').waitFor({ state: 'visible' });
  await slotButton(page, 0).click(); // no game is running, so no confirmation
  await until(page, s => document.getElementById('status').textContent === s, saved);
  assert.equal(await page.locator('#name').innerText(), 'Alice');
  // Delete it again.
  await openPause(page, 'Save');
  await page.locator('#savesui [data-act="remove"]').click();
  await page.locator('#confirm').waitFor({ state: 'visible' });
  assert.equal((await looks())[0].variant, 'danger'); // deleting marks Yes as destructive
  assert.equal((await looks())[0].border, 'rgb(240, 112, 122)');
  await confirmYes(page);
  await until(page, () => !document.querySelector('#savesui [data-act="remove"]'));
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some(k => /slot/i.test(k) && localStorage[k].includes('Alice'))), false);
});

play('saves: a filled slot shows its thumbnail, a thumbnail is only on its own page', async page => {
  await newGame(page);
  await textDone(page);
  await openPause(page, 'Save');
  assert.equal(await page.locator('#savesui img[src^="data:image"]').count(), 0); // nothing saved yet
  await slotButton(page, 0).click();
  await until(page, () => document.querySelector('#savesui img[src^="data:image"]'));
  assert.equal(await page.locator('#savesui img[src^="data:image"]').count(), 1);
  assert.equal(await page.locator('#savesui [data-act="rename"]').count(), 0); // saveNames is off
  await page.locator('#savesui [data-id="page2"]').click();
  await until(page, () => document.querySelectorAll('#savesui img[src^="data:image"]').length === 0);
});

play('options: Left and Right move between the tabs and show their page', async page => {
  await page.locator('#titleui [data-act="options"]').click();
  await page.locator('#optionsui [role="tab"]').first().waitFor();
  await until(page, () => document.activeElement.dataset.id === 'audio');
  await page.keyboard.press('ArrowRight');
  await until(page, () => document.activeElement.dataset.id === 'game' && document.querySelector('#optionsui [role="tab"][aria-selected="true"]').dataset.id === 'game');
  assert.equal(await page.locator('#optionsui [data-setting="text_speed"]').count(), 1);
  assert.equal(await page.locator('#optionsui [data-setting="master"]').count(), 0);
  await page.keyboard.press('ArrowLeft');
  await until(page, () => document.activeElement.dataset.id === 'audio');
  assert.equal(await page.locator('#optionsui [data-setting="master"]').count(), 1);
});

play('load screen: empty slots are disabled and the Q and C pages list quick and choice saves', async page => {
  await newGame(page);
  await toChoice(page);
  await page.keyboard.press('F5');
  await page.keyboard.press('1'); // the choice writes a "before choice" autosave
  await until(page, () => /Lost\?/.test(document.getElementById('text').textContent));
  await openPause(page, 'Load');
  assert.equal(await enabledSlots(page).count(), 0); // page 1 has no manual saves
  await page.locator('#savesui [data-id="pagequick"]').click();
  await until(page, () => document.querySelectorAll('#savesui [data-act="slot"][data-on="true"]').length === 1);
  await page.locator('#savesui [data-id="pagechoice"]').click();
  await until(page, () => document.querySelectorAll('#savesui [data-act="slot"][data-on="true"]').length >= 1);
});

play('choice autosave: loading the newest one goes back before the decision, with the menu open again', async page => {
  await newGame(page);
  await toChoice(page);
  await page.keyboard.press('1');
  await until(page, () => /Lost\?/.test(document.getElementById('text').textContent));
  await openPause(page, 'Load');
  await page.locator('#savesui [data-id="pagechoice"]').click();
  await until(page, () => document.querySelectorAll('#savesui [data-act="slot"][data-on="true"]').length === 1);
  await enabledSlots(page).first().click();
  await page.locator('#confirm').waitFor({ state: 'visible' }); // a game is running: asks first
  await confirmYes(page);
  await menuOpen(page);
  assert.deepEqual(await page.locator('#menu button').allInnerTexts(), ['Sorry, I got lost.', "You didn't have to wait."]);
  await page.keyboard.press('2'); // and the other answer can be taken now
  await until(page, () => /Don't flatter yourself/.test(document.getElementById('text').textContent));
});

play('history lists the lines so far, opens with L and closes with Escape', async page => {
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  await page.keyboard.press('l');
  await until(page, () => document.getElementById('historyui').dataset.visible === 'true');
  const rows = await page.locator('#historyui [data-act="line"]').allInnerTexts();
  assert.match(rows[0], /^The park was nearly empty\./);
  assert.ok(rows.length >= 1);
  assert.equal(await page.locator('#historyui').getByText('Nothing yet.').count(), 0);
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('historyui').dataset.visible === 'false');
});

play('history: clicking an earlier line rolls back to it; the line on screen does nothing', async page => {
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  await textDone(page);
  await page.keyboard.press('l');
  await until(page, () => document.getElementById('historyui').dataset.visible === 'true');
  const rows = page.locator('#historyui [data-act="line"]');
  assert.equal(await rows.count(), 2);
  await until(page, () => document.activeElement?.dataset.id === '2'); // focus starts at the newest line
  await rows.nth(1).click();
  assert.equal(await page.locator('#historyui').getAttribute('data-visible'), 'true');
  await rows.nth(0).click();
  await until(page, () => document.getElementById('historyui').dataset.visible === 'false');
  await until(page, () => /^The park was nearly empty\./.test(document.getElementById('text').textContent) && document.getElementById('name').textContent === '');
  await textDone(page);
  await page.keyboard.press('Space'); // and the story goes on from there
  await until(page, () => document.getElementById('name').textContent === 'Alice');
});

play('saveNames: a numbered slot asks for a name, shows it, keeps it on overwrite and can be renamed', async page => {
  await newGame(page);
  await textDone(page);
  await openPause(page, 'Save');
  await slotButton(page, 0).click();
  await page.locator('#saveName').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'saveNameInput');
  await page.keyboard.type('Before the bench');
  await page.keyboard.press('Enter');
  await page.locator('#saveName').waitFor({ state: 'hidden' });
  await until(page, () => /Before the bench/.test(document.getElementById('savesui').textContent));
  // Overwriting offers the old name; Cancel leaves the save alone.
  await slotButton(page, 0).click();
  await confirmYes(page);
  await page.locator('#saveName').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#saveNameInput').inputValue(), 'Before the bench');
  await page.locator('#saveNameCancel').click();
  await page.locator('#saveName').waitFor({ state: 'hidden' });
  // Rename from the card.
  await page.locator('#savesui [data-act="rename"]').first().click();
  await page.locator('#saveNameInput').fill('Park');
  await page.locator('#saveNameOk').click();
  await until(page, () => /Park/.test(document.getElementById('savesui').textContent) && !/Before the bench/.test(document.getElementById('savesui').textContent));
  assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).label, gameKey('save.1')), 'Park');
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.game = { ...proj.game, saveNames: true };
    await route.fulfill({ response: res, json: proj });
  });
});

play('saves without saveNames: no name is asked and no rename button shows', async page => {
  await newGame(page);
  await textDone(page);
  await openPause(page, 'Save');
  await slotButton(page, 0).click();
  await until(page, () => document.querySelector('#savesui [data-act="remove"]'));
  assert.equal(await page.locator('#saveName').isHidden(), true);
  assert.equal(await page.locator('#savesui [data-act="rename"]').count(), 0);
});

play('gallery: opens from the title screen, locked tiles are disabled, Escape goes back', async page => {
  await page.locator('#titleui [data-act="gallery"]').click();
  const tiles = page.locator('#galleryui [data-act="tile"]');
  await tiles.first().waitFor();
  const count = await tiles.count();
  assert.ok(count > 0);
  await page.locator('#galleryui .sc-text', { hasText: new RegExp('^[0-9]+ / ' + count + '$') }).waitFor();
  assert.equal(await page.locator('#galleryui [data-act="tile"][aria-disabled="true"]').count(), count); // nothing seen yet: every tile is locked
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('galleryui').dataset.visible === 'false');
  await page.locator('#titleui [data-act="start"]').waitFor({ state: 'visible' });
});

play('extras: music room and chapters start locked, unlock as the story plays, and a chapter starts a new playthrough there', async page => {
  await page.locator('#titleui [data-act="chapters"]').click();
  const chapters = page.locator('#chaptersui [data-act="chapter"]');
  await chapters.first().waitFor();
  assert.equal(await chapters.count(), 2);
  assert.equal(await page.locator('#chaptersui [data-act="chapter"][aria-disabled="true"]').count(), 2);
  await page.locator('#chaptersui .sc-text', { hasText: /^0 \/ 2$/ }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#titleui [data-act="music"]').click();
  await page.locator('#musicui [data-act="track"][aria-disabled="true"]').waitFor();
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('musicui').dataset.visible === 'false');

  await newGame(page);
  await toChoice(page);
  await page.keyboard.press('2');
  await until(page, () => /Don't flatter yourself/.test(document.getElementById('text').textContent));
  for (let i = 0; i < 8 && !/Sit\. We need/.test(await text(page)); i++) { // on to the bench_talk label
    await textDone(page).catch(() => {});
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Escape');
  await page.locator('#pauseui').getByRole('button', { name: 'Main menu' }).click();
  await confirmYes(page);
  await page.locator('#titleui [data-act="start"]').waitFor({ state: 'visible' });

  await page.locator('#titleui [data-act="music"]').click();
  await page.locator('#musicui .sc-text', { hasText: /^1 \/ 1$/ }).waitFor();
  await page.locator('#musicui [data-act="track"]').click();
  await page.locator('#musicui .sc-text', { hasText: /Evening Theme/ }).first().waitFor(); // "♪ Evening Theme" under the heading
  assert.equal(await page.locator('#musicui .sc-text', { hasText: '♪' }).count(), 2); // the heading line and the playing track's mark
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('musicui').dataset.visible === 'false');

  await page.locator('#titleui [data-act="chapters"]').click();
  await page.locator('#chaptersui .sc-text', { hasText: /^2 \/ 2$/ }).waitFor();
  await page.locator('#chaptersui [data-act="chapter"]', { hasText: 'A talk' }).click();
  await until(page, () => document.getElementById('box').dataset.visible === 'true');
  await until(page, () => /Sit. We need to talk anyway/.test(document.getElementById('text').textContent));
});


play('achievements: the list shows endings and achievements apart with counts, and an unlock pops up the toast', async page => {
  await page.evaluate(() => localStorage.setItem('vn.evening-in-the-park.unlocked', JSON.stringify(['town_visit'])));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleui [data-act="achievements"]').click();
  await page.locator('#achievementsui .sc-text', { hasText: /^Achievements +1 \/ 1$/ }).waitFor(); // the achievements section; the ending (0 / 1) has its own heading
  // Locked but not `hidden`: the title and description show (only hidden entries read "???").
  const texts = await page.locator('#achievementsui .sc-text').allInnerTexts();
  for (const t of ['A thank-you note', 'Find what was left in town.', 'Into town', 'Leave the park behind.']) assert.ok(texts.includes(t), t);
  assert.ok(!texts.includes('???'));
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('achievementsui').dataset.visible === 'false');

  await page.evaluate(() => window.postMessage({ type: 'screen', name: 'achievement_toast' }, location.origin));
  await page.locator('#achtoastui .sc-text', { hasText: 'Ending reached' }).waitFor(); // the sample's first entry is an ending
  await page.locator('#achtoastui .sc-text', { hasText: 'A thank-you note' }).waitFor();
  const corner = await page.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect(), b = document.querySelector('#achtoastui .sc-text').getBoundingClientRect();
    return [b.left - r.left > r.width / 2, b.top - r.top < r.height / 4]; // top right, the default position
  });
  assert.deepEqual(corner, [true, true]);
  await until(page, () => document.getElementById('achtoastui').dataset.visible === 'false'); // it goes after achievementToast.seconds
});

play('quick menu: game.json quickMenu picks the buttons, their order and the edge', async page => {
  await newGame(page);
  await until(page, () => document.getElementById('quickui').dataset.visible === 'true');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#quickui [data-id]')].map(e => e.dataset.act)), ['options', 'auto']); // voice joins only on a voiced line
  const at = await page.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect(), b = document.querySelector('#quickui [data-act="options"]').getBoundingClientRect();
    return [b.left - r.left < r.width / 4, b.top - r.top < r.height / 4]; // top left
  });
  assert.deepEqual(at, [true, true]);
  await page.locator('#quickui [data-act="auto"]').click();
  await until(page, () => document.querySelector('#quickui [data-act="auto"]').getAttribute('aria-pressed') === 'true');
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.game = { ...proj.game, quickMenu: { items: ['options', 'auto', 'nonsense'], position: 'top', align: 'left' } };
    await route.fulfill({ response: res, json: proj });
  });
});

// localStorage key of a per-game value (the sample's game id is the slug of its title).
const gameKey = key => `vn.evening-in-the-park.${key}`;

play('gallery: seen backgrounds are unlocked tiles that open a viewer, arrows page through it', async page => {
  // Playing shows bg_park_evening, which unlocks its tile; bg_park_night stays locked until it has been on screen.
  await newGame(page);
  await until(page, k => localStorage.getItem(k)?.includes('bg_park_evening'), gameKey('images'));
  await page.keyboard.press('Escape');
  await page.locator('#pauseui').getByRole('button', { name: 'Main menu' }).click();
  await confirmYes(page);
  await page.locator('#titleui [data-act="gallery"]').click();
  await page.locator('#galleryui .sc-text', { hasText: /^1 \/ 2$/ }).waitFor();
  const tiles = page.locator('#galleryui [data-act="tile"]');
  assert.equal(await tiles.nth(0).getAttribute('aria-disabled'), null);
  assert.equal(await tiles.nth(1).getAttribute('aria-disabled'), 'true');
  const titles = await page.locator('#galleryui .sc-text').allInnerTexts();
  assert.ok(titles.includes('Evening park') && titles.includes('Locked'), titles.join('|'));
  assert.equal(await page.locator('#galleryui img.sc-img').count(), 1); // only the seen tile has its picture
  await tiles.nth(0).click();
  await until(page, () => document.getElementById('viewerui').dataset.visible === 'true');
  await until(page, () => /^Evening park/.test(document.querySelector('#viewerui .sc-text')?.textContent ?? ''));
  await page.keyboard.press('Escape'); // back to the grid, not the title
  await until(page, () => document.getElementById('viewerui').dataset.visible === 'false');
  await until(page, () => document.getElementById('galleryui').dataset.visible === 'true');
  await tiles.nth(0).click(); // a click on the picture closes the viewer too
  await until(page, () => document.getElementById('viewerui').dataset.visible === 'true');
  await page.locator('#viewerui [data-id="shut"]').click({ position: { x: 600, y: 300 } });
  await until(page, () => document.getElementById('viewerui').dataset.visible === 'false');
  await until(page, () => document.activeElement?.dataset.id === '1'); // focus is back on the tile that was viewed
});

play('gallery: with both images seen the viewer pages through them and wraps around', async page => {
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['bg_park_evening', 'bg_park_night'])), gameKey('images'));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleui [data-act="gallery"]').click();
  await page.locator('#galleryui .sc-text', { hasText: /^2 \/ 2$/ }).waitFor();
  await page.locator('#galleryui [data-act="tile"]').nth(0).click();
  const shows = re => until(page, r => new RegExp(r).test(document.querySelector('#viewerui .sc-text')?.textContent ?? ''), re);
  await shows('^Evening park\\s+1 / 2');
  await page.keyboard.press('ArrowRight');
  await shows('^Night park\\s+2 / 2');
  await page.keyboard.press('ArrowRight');
  await shows('^Evening park\\s+1 / 2');
  await page.keyboard.press('ArrowLeft');
  await shows('^Night park\\s+2 / 2');
});

play('Continue is disabled without a save and resumes the newest one, showing its line', async page => {
  assert.equal(await page.locator('#titleui [data-act="continue"]').getAttribute('aria-disabled'), 'true');
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  const saved = await status(page);
  await page.keyboard.press('Escape');
  await page.locator('#pauseui').getByRole('button', { name: 'Main menu' }).click();
  await confirmYes(page);
  await page.locator('#titleui [data-act="continue"]').waitFor({ state: 'visible' });
  await until(page, () => document.querySelector('#titleui [data-act="continue"]').getAttribute('aria-disabled') !== 'true');
  await page.locator('#titleui [data-act="continue"]').click();
  await until(page, s => document.getElementById('status').textContent === s, saved);
  assert.equal(await page.locator('#name').innerText(), 'Alice');
});

// A second language is injected into the project the page fetches; the sample ships only English.
const withFinnish = async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.locales = { ...proj.locales, fi: { 'ui.new_game': 'Uusi peli', joce: 'Puisto oli melkein tyhjä.' } };
    await route.fulfill({ response: res, json: proj });
  });
};

play('language: the Options list offers the locales, switching translates the title and the story and is remembered', async page => {
  await page.locator('#titleui [data-act="options"]').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await page.locator('#optionsui [role="tab"]', { hasText: 'Game' }).click();
  assert.equal(await page.locator('#optionsui [data-id="language"]').textContent(), 'en ▾'); // Game page: the language row shows when the game has a second one
  await page.locator('#optionsui [data-id="language"]').click(); await page.locator('#optionsui [data-id="language.fi"]').click(); // open the list, pick Finnish
  await until(page, () => document.querySelector('#optionsui [data-id="language"]').textContent === 'fi ▾');
  await page.keyboard.press('Escape');
  await page.locator('#options').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Uusi peli' }).waitFor(); // the title reloads in Finnish
  assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).lang, gameKey('settings')), 'fi');
  await page.locator('#titleui [data-act]', { hasText: 'Uusi peli' }).click();
  await until(page, () => document.getElementById('box').dataset.visible === 'true');
  await textDone(page);
  assert.equal(await text(page), 'Puisto oli melkein tyhjä.');
  await page.reload(); // the choice survives a reload
  await page.getByRole('button', { name: 'Uusi peli' }).waitFor();
}, withFinnish);

// An export lists its languages in `localeFiles` and ships each table as locale/<lang>.json; the page fetches it once, when picked.
const fetchedFinnish = [];
const withFinnishFile = async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.localeFiles = ['fi'];
    await route.fulfill({ response: res, json: proj });
  });
  await context.route('**/locale/fi.json', route => {
    fetchedFinnish.push(route.request().url());
    return route.fulfill({ json: { 'ui.new_game': 'Uusi peli', joce: 'Puisto oli melkein tyhjä.' } });
  });
};

play('language: an exported translation is fetched when picked, and only once', async page => {
  fetchedFinnish.length = 0;
  await page.locator('#titleui [data-act="options"]').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await page.locator('#optionsui [role="tab"]', { hasText: 'Game' }).click();
  assert.equal(await page.locator('#optionsui [data-id="language"]').textContent(), 'en ▾'); // Game page: the language row shows when the game has a second one
  assert.equal(fetchedFinnish.length, 0, 'listed, not fetched, until picked');
  await page.locator('#optionsui [data-id="language"]').click(); await page.locator('#optionsui [data-id="language.fi"]').click(); // open the list, pick Finnish
  await until(page, () => document.querySelector('#optionsui [data-id="language"]').textContent === 'fi ▾');
  await page.keyboard.press('Escape');
  await page.locator('#options').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Uusi peli' }).waitFor();
  await page.locator('#titleui [data-act]', { hasText: 'Uusi peli' }).click();
  await until(page, () => document.getElementById('box').dataset.visible === 'true');
  await textDone(page);
  assert.equal(await text(page), 'Puisto oli melkein tyhjä.');
  assert.equal(fetchedFinnish.length, 1, 'one fetch serves the title and the story');
}, withFinnishFile);

// An exported game (data-mode="game", the program in project.json) whose second line runs an `if` on a function this
// engine does not have, as after a hot fix made against a newer engine: the story stops with the error screen.
const asBrokenExport = async context => {
  const { compile, packProgram } = await import('../../dist/engine/src/index.js');
  const program = compile([{ file: 'crash.vn', text: 'label start:\n  "Fine so far."\n  if ok:\n    "Never."\n  "After."' }]);
  for (const op of program.ops) if (op.op === 'branch') op.cond = { t: 'call', name: 'nosuch', args: [] };
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.route(url => url.pathname === '/', async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/<html\b/, '<html data-mode="game"') });
  });
  await context.route('**/project.json', async route => {
    const proj = await (await route.fetch({ url: new URL('/api/project', route.request().url()).href })).json();
    await route.fulfill({ json: { game: proj.game, assets: proj.assets, rigs: proj.rigs, locales: {}, program: packProgram(program, 'v1'), engine: '9.9.9' } });
  });
};

play('error screen: an exported game stops on a runtime error with a report and a way back to the title', async page => {
  await newGame(page);
  await textDone(page);
  assert.equal(await text(page), 'Fine so far.');
  await page.keyboard.press('Space');
  await page.locator('#crash').waitFor({ state: 'visible' });
  const report = await page.locator('#crashReport').innerText();
  assert.match(report, /^Engine: Marginalia 9\.9\.9$/m);
  assert.match(report, /^Where: crash\.vn:3$/m);
  assert.match(report, /^Error: Unknown function nosuch$/m);
  assert.match(report, /Last lines:\n {2}Fine so far\./);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'crashToTitle');
  await page.keyboard.press('Space'); // works the focused button, not the story
  await page.getByRole('button', { name: 'New game' }).waitFor();
  assert.equal(await page.locator('#crash').isHidden(), true);
  // again, this time copying the report first
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await page.locator('#crash').waitFor({ state: 'visible' });
  await page.locator('#crashCopy').click();
  await page.locator('#crashCopy', { hasText: 'Copied' }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Where: crash\.vn:3$/m);
  await page.locator('#crashToTitle').click();
  await page.getByRole('button', { name: 'New game' }).waitFor();
}, asBrokenExport);

// A pad the page can read: navigator.getGamepads() returns this object, and the test presses its buttons.
const withPad = async context => {
  await context.addInitScript(() => {
    const pad = { index: 0, id: 'Test Pad (STANDARD GAMEPAD)', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    window.__padPolls = 0;
    navigator.getGamepads = () => { window.__padPolls++; return [pad]; };
  });
};
// Press and release a button, each held until the page's poll (once a frame) has read it twice: a busy machine stalls
// frames, and a fixed wait then let a press come and go unseen.
const tap = async (page, n) => {
  for (const pressed of [true, false]) {
    const polls = await page.evaluate(([n, pressed]) => { __pad.buttons[n].pressed = pressed; __pad.buttons[n].value = pressed ? 1 : 0; return __padPolls; }, [n, pressed]);
    await until(page, p => __padPolls >= p + 2, polls);
  }
};
const focusedText = page => page.evaluate(() => document.activeElement?.textContent ?? '');

play('gamepad: the d-pad moves focus between the title buttons, A presses, B goes back', async page => {
  await tap(page, 13); // down: focus lands on a title button
  const first = await focusedText(page);
  assert.ok(/New game|Continue|Load|Gallery|Options/.test(first), `focus is on ${first}`);
  await tap(page, 13);
  const second = await focusedText(page);
  assert.notEqual(second, first);
  await tap(page, 12); // up again
  assert.equal(await focusedText(page), first);
  for (let i = 0; i < 6 && !/Options/.test(await focusedText(page)); i++) await tap(page, 13);
  assert.match(await focusedText(page), /Options/);
  await tap(page, 0); // A
  await page.locator('#options').waitFor({ state: 'visible' });
  await tap(page, 5); // RB: next tab
  assert.equal(await page.locator('#optionsui [role="tab"][aria-selected="true"]').innerText(), 'Game');
  await tap(page, 1); // B closes the screen
  await page.locator('#options').waitFor({ state: 'hidden' });
}, withPad);

play('gamepad: in the game A advances, and at a choice the d-pad moves between options and A picks', async page => {
  await newGame(page);
  await textDone(page);
  await tap(page, 0);
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  await toChoice(page);
  await tap(page, 13);
  await tap(page, 13);
  assert.equal(await focusedText(page), "You didn't have to wait.");
  await tap(page, 0);
  await until(page, () => /Don't flatter yourself/.test(document.getElementById('text').textContent));
}, withPad);

play('NVL: narration fills a full-screen page, a clear starts a new one, off returns to the box', async page => {
  await page.evaluate(() => window.postMessage({ type: 'goto', file: 'demo.vn', line: 104 }, location.origin));
  await until(page, () => document.getElementById('nvl').dataset.visible === 'true');
  const nvlDone = () => until(page, () => document.getElementById('nvl').dataset.done === 'true');
  const next = async () => { await nvlDone(); await page.keyboard.press('Space'); };
  await nvlDone();
  assert.equal(await page.locator('#box').isVisible(), false);
  await next();
  await until(page, () => document.querySelectorAll('#nvl-page > div').length === 2);
  await next();
  await until(page, () => document.querySelectorAll('#nvl-page > div').length === 3);
  await nvlDone();
  assert.match(await page.locator('#nvl-page > div').nth(2).innerText(), /^Alice:\s*Did you hear that\?/);
  await next(); // nvl clear: the page starts over with the next line alone
  await until(page, () => /^Neither of them/.test(document.getElementById('nvl-page').textContent));
  assert.equal(await page.locator('#nvl-page > div').count(), 1);
  await next(); // nvl off: back to the text box
  await until(page, () => document.getElementById('nvl').dataset.visible !== 'true');
});

play('a gamepad shows the on-screen keyboard at the name prompt and its keys type into the field', async page => {
  await page.evaluate(() => window.postMessage({ type: 'goto', file: 'demo.vn', line: 14 }, location.origin));
  await menuOpen(page);
  await page.evaluate(() => { document.getElementById('stage').dataset.pad = 'true'; });
  assert.equal(await page.locator('#menu .osk').isVisible(), true);
  // A real mouse click would clear the pad flag, so press the keys the way the pad's confirm does: element.click().
  for (const k of ['s', 'o']) await page.evaluate(k => document.querySelector(`#menu .osk [data-osk="${k}"]`).click(), k);
  assert.equal(await page.locator('#menu input[type="text"]').inputValue(), 'So'); // names start with a capital
});

// The project the page fetches, with a jump to a label that does not exist as the first line of the story: it ends at once.
const withBrokenStart = async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    for (const s of proj.scripts) if (s.file === 'park.vn') s.text = s.text.replace('label start:\n', 'label start:\n  jump nowhere\n');
    await route.fulfill({ response: res, json: proj });
  });
};

test('a script error shows a banner over the black stage, and clicking it opens the problem list', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await withBrokenStart(context);
  const page = await context.newPage();
  try {
    await page.goto(base);
    const banner = page.locator('#errBanner');
    await banner.waitFor({ state: 'visible' });
    assert.match(await banner.innerText(), /Script error: Unknown label "nowhere" \(park\.vn:\d+\)/);
    await banner.click();
    assert.equal(await page.locator('#diag').getAttribute('data-visible'), 'true');
  } finally {
    await context.close();
  }
});

test('editor: the preview error banner jumps to the line of the error', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  await withBrokenStart(context);
  const page = await context.newPage();
  try {
    await page.goto(`${base}editor/`);
    const banner = page.frameLocator('#preview').locator('#errBanner');
    await banner.waitFor({ state: 'visible' });
    const where = /\(([\w.]+):(\d+)\)/.exec(await banner.innerText());
    assert.ok(where, 'the banner names the file and line');
    await banner.click();
    await page.locator('#tabs [aria-selected="true"], #tabs .active, #tabs .on').first().waitFor().catch(() => {});
    // The jump (tab switch, then reveal) lands a moment after the click, so poll until the cursor row shows the failing line.
    const cursorRows = () => page.evaluate(() => {
      const line = document.querySelector('.monaco-editor .current-line');
      if (!line) return [];
      const y = line.getBoundingClientRect().top;
      return [...document.querySelectorAll('.monaco-editor .view-line')]
        .filter(e => Math.abs(e.getBoundingClientRect().top - y) < 4).map(e => e.textContent);
    });
    let rows = [];
    for (let i = 0; i < 40 && !rows.some(r => /jump\s+nowhere/.test(r)); i++) {
      rows = await cursorRows();
      if (!rows.some(r => /jump\s+nowhere/.test(r))) await page.waitForTimeout(200);
    }
    assert.ok(rows.some(r => /jump\s+nowhere/.test(r)), `the cursor is on the failing line, saw ${JSON.stringify(rows)}`);
  } finally {
    await context.close();
  }
});

test('files panel: headings carry their add icons, right-click and Shift+F10 open a menu, Reveal posts the path', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  const revealed = [];
  await context.route('**/api/reveal?*', route => { revealed.push(new URL(route.request().url()).searchParams.get('path')); return route.fulfill({ json: { ok: true } }); });
  const page = await context.newPage();
  try {
    await page.goto(`${base}editor/`);
    const heading = name => page.locator('#sbList h3', { hasText: name });
    await heading('Scripts').waitFor();
    assert.equal(await heading('Scripts').locator('.add').count(), 2, 'new file and new folder');
    assert.equal(await heading('Assets').locator('.add').count(), 2, 'add files and new folder');
    assert.equal(await heading('Characters').locator('.add').count(), 1, 'add a character PSD');
    assert.match(await page.locator('#sbList .row', { hasText: 'mina' }).first().innerText(), /psd/, 'mina is marked as converted from a master');

    const menu = page.locator('.ctxmenu');
    await page.locator('#sbList .item', { hasText: 'park.vn' }).click({ button: 'right' });
    await menu.waitFor();
    assert.ok((await menu.innerText()).includes('Preview from Start of File'));
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });

    await page.locator('#sbList .item', { hasText: 'park.vn' }).focus();
    await page.keyboard.press('Shift+F10');
    await menu.waitFor();
    await page.keyboard.press('End'); // Reveal is the last item
    await page.keyboard.press('Enter');
    await menu.waitFor({ state: 'hidden' });
    for (let i = 0; i < 20 && !revealed.length; i++) await page.waitForTimeout(100);
    assert.deepEqual(revealed, ['script/park.vn']);
  } finally {
    await context.close();
  }
});

test('files panel: F2 renames a script through the palette, Delete removes it after a confirm', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  const calls = [];
  for (const route of ['move', 'delete']) {
    await context.route(`**/api/${route}?*`, r => {
      const q = Object.fromEntries(new URL(r.request().url()).searchParams);
      calls.push({ route, ...q });
      return r.fulfill({ json: { ok: true, to: q.to } });
    });
  }
  await context.route('**/api/script?*', r => r.fulfill({ json: { ok: true } })); // closing a tab saves it
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    const row = name => page.locator('#sbList .item', { hasText: name });
    await row('demo.vn').waitFor();
    // A click opens the file but keeps the focus on the row (the code editor would take F2 for its own rename).
    await row('demo.vn').click();
    await until(page, () => document.activeElement?.dataset.key === 'script/demo.vn');
    await page.keyboard.press('F2');
    const input = page.locator('[aria-controls="paletteList"]');
    await input.waitFor();
    assert.equal(await input.inputValue(), '#rename:script/demo.vn');
    await input.fill('#rename:script/side/demo_b');
    await page.locator('.create', { hasText: 'Rename to script/side/demo_b.vn' }).waitFor();
    await page.keyboard.press('Enter');
    await row('demo_b.vn').waitFor();
    assert.deepEqual(calls, [{ route: 'move', from: 'script/demo.vn', to: 'script/side/demo_b.vn' }]);
    assert.equal(await row('demo.vn').count(), 0, 'the old name is gone');
    assert.equal(await page.locator('#sbList summary', { hasText: 'side' }).count(), 1, 'the new folder shows');

    await row('demo_b.vn').click();
    await until(page, () => document.activeElement?.dataset.key === 'script/side/demo_b.vn');
    await page.keyboard.press('Delete');
    await page.locator('dialog.ask').getByRole('button', { name: 'Delete' }).click();
    await row('demo_b.vn').waitFor({ state: 'detached' });
    assert.deepEqual(calls.at(-1), { route: 'delete', path: 'script/side/demo_b.vn' });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('files panel: a delete toast offers Undo, and Restore from Trash lists the entries and puts one back', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  const calls = [];
  const query = r => Object.fromEntries(new URL(r.request().url()).searchParams);
  await context.route('**/api/delete?*', r => { calls.push({ route: 'delete', ...query(r) }); return r.fulfill({ json: { ok: true, trash: 'entry-new' } }); });
  await context.route('**/api/trash/restore?*', r => {
    const { id } = query(r);
    calls.push({ route: 'restore', id });
    return r.fulfill({ json: { paths: [id === 'entry-new' ? 'script/demo.vn' : 'assets/bg/old.png'], aside: null } });
  });
  const now = Date.now();
  await context.route('**/api/trash', r => r.fulfill({ json: [
    { id: 'entry-new', action: 'delete', paths: ['script/demo.vn'], time: new Date(now - 60_000).toISOString(), bytes: 2048 },
    { id: 'entry-old', action: 'replace', paths: ['assets/bg/old.png', 'assets/bg/old2.png'], time: new Date(now - 3 * 3_600_000).toISOString(), bytes: 3 * 1024 * 1024 },
  ] }));
  await context.route('**/api/script?*', r => r.fulfill({ json: { ok: true } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    const row = page.locator('#sbList .item', { hasText: 'demo.vn' });
    await row.waitFor();
    await row.click();
    await until(page, () => document.activeElement?.dataset.key === 'script/demo.vn');
    await page.keyboard.press('Delete');
    await page.locator('dialog.ask').getByRole('button', { name: 'Delete' }).click();
    const toastEl = page.locator('#toast');
    await toastEl.waitFor();
    assert.equal(await toastEl.locator('span').innerText(), 'deleted script/demo.vn');
    // Undo restores the entry the delete made (the delete was mocked, so the file is still on disk and stays listed).
    await toastEl.getByRole('button', { name: 'Undo' }).click();
    await until(page, () => document.querySelector('#toast span')?.textContent === 'restored script/demo.vn');
    assert.equal(await toastEl.getByRole('button', { name: 'Undo' }).isVisible(), false, 'a restore with nothing pushed aside has no Undo');
    assert.deepEqual(calls, [{ route: 'delete', path: 'script/demo.vn' }, { route: 'restore', id: 'entry-new' }]);

    await page.keyboard.press('Control+p');
    await page.keyboard.type('>Files: Restore from Trash');
    await page.keyboard.press('Enter');
    const items = page.locator('#paletteList li');
    await until(page, () => document.querySelectorAll('#paletteList li .detail').length === 2);
    // The detail is drawn inside the label's .main span.
    assert.deepEqual(await items.locator('.detail').allInnerTexts(), ['deleted 1 min ago, 2.0 KB', 'replaced 3 h ago, 3.0 MB']);
    const labels = await items.locator('.main').allInnerTexts();
    assert.ok(labels[0].startsWith('script/demo.vn') && labels[1].startsWith('assets/bg/old.png and 1 more'), JSON.stringify(labels));
    await page.keyboard.type('old');
    await until(page, () => document.querySelectorAll('#paletteList li').length === 1);
    await page.keyboard.press('Enter');
    await until(page, () => document.querySelector('#toast span')?.textContent === 'restored assets/bg/old.png');
    assert.deepEqual(calls.at(-1), { route: 'restore', id: 'entry-old' });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('files panel: renaming an asset rewrites the scripts that name it and says so in a toast', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  const moves = [], saved = {};
  await context.route('**/api/move?*', r => {
    const q = Object.fromEntries(new URL(r.request().url()).searchParams);
    moves.push(q);
    return r.fulfill({ json: { ok: true, to: q.to } });
  });
  // The rewritten scripts autosave: keep what they send, the sample stays as it is.
  await context.route('**/api/script?*', r => {
    if (r.request().method() === 'PUT') saved[new URL(r.request().url()).searchParams.get('file')] = r.request().postData();
    return r.fulfill({ json: { ok: true } });
  });
  await context.route('**/api/game', r => {
    if (r.request().method() !== 'PUT') return r.fallback();
    saved['game.json'] = r.request().postData();
    return r.fulfill({ json: { ok: true } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('#sbList summary', { hasText: /^bg/ }).click(); // asset folders start closed
    const row = page.locator('#sbList .item[data-key="assets/bg/bg_park_night.png"]');
    await row.click({ button: 'right' });
    await page.locator('.ctxmenu').getByRole('menuitem', { name: 'Rename…' }).click();
    const input = page.locator('[aria-controls="paletteList"]');
    assert.equal(await input.inputValue(), '#rename:assets/bg/bg_park_night.png');
    await input.fill('#rename:assets/bg/night_park.png');
    await page.locator('.create', { hasText: 'Rename to assets/bg/night_park.png' }).waitFor();
    await page.keyboard.press('Enter');
    await until(page, () => /^renamed assets\/bg\/bg_park_night\.png to assets\/bg\/night_park\.png: updated \d+ mentions in \d+ files$/.test(document.querySelector('#toast span')?.textContent ?? ''));
    assert.deepEqual(moves, [{ from: 'assets/bg/bg_park_night.png', to: 'assets/bg/night_park.png' }]);
    assert.equal(await page.locator('#toast button').isVisible(), false, 'no Undo for a rename yet');
    // Wait for every autosave, game.json too: one still in flight when the context closes would reach the real sample.
    for (let i = 0; i < 50 && !(saved['park.vn'] && saved['screens.vn'] && saved['demo.vn'] && saved['game.json']); i++) await page.waitForTimeout(100);
    assert.match(saved['game.json'] ?? '', /"image": "night_park"/, 'the gallery entry in game.json follows');
    assert.match(saved['park.vn'] ?? '', /^ {2}scene night_park dissolve 1\.2$/m, 'a scene name follows');
    assert.doesNotMatch(saved['park.vn'], /bg_park_night/);
    assert.match(saved['park.vn'], /scene bg_park_evening fade/, 'the other background is left alone');
    assert.match(saved['screens.vn'] ?? '', /image "bg\/night_park\.png" size/, 'a quoted path follows');
    assert.match(saved['demo.vn'] ?? '', /image show photo bg\/night_park at/, 'a path without the extension keeps none');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('git commit dialog: the bar counts changes, the dialog lists them, ignores, and commits with the message', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  // git itself is mocked: the test must not commit to the checkout it runs in.
  let status = {
    repo: true, git: true, branch: 'dev', suggest: 'Update park.vn, add bg_new.png',
    changes: [{ path: 'script/park.vn', x: ' ', y: 'M' }, { path: 'assets/bg/bg_new.png', x: '?', y: '?' }, { path: 'assets/bg/b.png', x: 'R', y: ' ', from: 'assets/bg/a.png' }],
    blockers: [], warnings: ['masters/big.psd is 40 MB: put PSDs in Git LFS.'], unignored: ['/.trash/'],
  };
  const posts = [];
  await context.route('**/api/git', r => r.fulfill({ json: status }));
  await context.route('**/api/git/ignore', r => {
    posts.push({ route: 'ignore' });
    status = { ...status, unignored: [] };
    return r.fulfill({ json: { added: ['/.trash/'] } });
  });
  await context.route('**/api/git/commit', r => {
    posts.push({ route: 'commit', body: r.request().postData() });
    status = { ...status, changes: [], warnings: [], blockers: ['Nothing to commit.'] };
    return r.fulfill({ json: { hash: 'abc1234', files: 3 } });
  });
  await context.route('**/api/script?*', r => r.fulfill({ json: { ok: true } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    const bar = page.locator('#sbGit');
    await bar.locator('.gb-count').waitFor();
    assert.equal(await bar.locator('.gb-branch').innerText(), '⎇ dev');
    assert.equal(await bar.locator('.gb-count').innerText(), '3 changes');
    await bar.getByRole('button', { name: 'Commit…' }).click();

    const dialog = page.locator('#gitCommit');
    await until(page, () => document.querySelectorAll('#gitCommit .gd-row').length === 3);
    assert.equal(await dialog.locator('.gd-branch').innerText(), 'on dev');
    assert.equal(await dialog.locator('.gd-summary').innerText(), '3 changed files:');
    assert.deepEqual(await dialog.locator('.gd-kind').allInnerTexts(), ['MODIFIED', 'ADDED', 'RENAMED']);
    assert.match(await dialog.locator('.gd-row').nth(2).innerText(), /assets\/bg\/b\.png\s+from assets\/bg\/a\.png/);
    assert.deepEqual(await dialog.locator('.gd-note[data-kind="warning"]').allInnerTexts(), ['masters/big.psd is 40 MB: put PSDs in Git LFS.']);
    const message = dialog.getByRole('textbox', { name: 'Commit message' });
    assert.equal(await message.inputValue(), 'Update park.vn, add bg_new.png', 'the suggested message');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('gd-message')), true, 'focus starts in the message');

    const ignore = dialog.getByRole('button', { name: 'Add to .gitignore' });
    await ignore.click();
    await ignore.waitFor({ state: 'hidden' });
    assert.match(await page.locator('#status').innerText(), /added \/\.trash\/ to \.gitignore/);

    const go = dialog.getByRole('button', { name: 'Commit all' });
    await message.fill('');
    assert.equal(await go.isDisabled(), true, 'no message, no commit');
    await message.fill('Park: the night scene');
    assert.equal(await go.isDisabled(), false);
    await page.keyboard.press('Control+Enter');
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(posts, [{ route: 'ignore' }, { route: 'commit', body: 'Park: the night scene' }]);
    assert.match(await page.locator('#status').innerText(), /committed 3 files \(abc1234\)/);
    assert.equal(await bar.locator('.gb-count').innerText(), 'no changes');
    assert.equal(await bar.getByRole('button', { name: 'Commit…' }).isDisabled(), true);

    // A blocker (here a merge conflict) keeps Commit off and is shown first; Esc closes.
    status = { ...status, changes: [{ path: 'script/park.vn', x: 'U', y: 'U' }], blockers: ['Resolve the merge conflict in script/park.vn first.'] };
    await page.keyboard.press('Control+p');
    await page.keyboard.type('>Git: Commit All Changes');
    await page.keyboard.press('Enter');
    await until(page, () => document.querySelector('#gitCommit .gd-kind')?.textContent === 'conflict');
    assert.deepEqual(await dialog.locator('.gd-note[data-kind="blocker"]').allInnerTexts(), ['Resolve the merge conflict in script/park.vn first.']);
    await message.fill('anything');
    assert.equal(await go.isDisabled(), true, 'blocked');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(posts.length, 2, 'nothing more was posted');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// The studio's sections are header buttons (aria-expanded) over a body; open one if it is closed.
const openSection = async (studio, id) => {
  const head = studio.locator(`.as-sect[data-sect="${id}"] .as-sect-head`);
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
};
/** The + in the Parameters header opens a menu: New parameter or New pad (Model mode). */
const addControl = async (studio, kind) => {
  await studio.locator('.ap-add').click();
  await studio.locator('.ctxmenu:visible button', { hasText: kind === 'pad' ? 'New pad' : 'New parameter' }).click();
};

test('animation studio: a section is dragged to the other column or moved with Alt+arrows, the layout is kept, Reset layout and a narrow window show the first one', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    const open = async () => {
      await page.goto(`${base}editor/`);
      await page.locator('button.anim', { hasText: 'Animate' }).first().click();
      await page.locator('#animStudio .as-timeline').waitFor();
      return page.locator('#animStudio');
    };
    let studio = await open();
    const column = (zone) => studio.locator(`.as-dock[data-zone="${zone}"] > .as-sect:not([hidden])`).evaluateAll(els => els.map(e => e.dataset.sect));
    assert.deepEqual(await column('left'), ['poses', 'params', 'tree']);
    assert.deepEqual(await column('right'), ['sel', 'frames', 'place']);
    assert.equal(await studio.locator('[data-t="resetdock"]').isVisible(), false, 'nothing to reset yet');
    assert.equal(await studio.locator('.as-grip-h').isVisible(), true, 'Parameters and Parts are neighbours: the split grip shows');

    // Drag Selection by its grab button onto the top half of the Poses header.
    const grab = await studio.locator('.as-sect[data-sect="sel"] .as-sect-grab').boundingBox();
    const target = await studio.locator('.as-sect[data-sect="poses"]').boundingBox();
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 40, target.y + 4, { steps: 8 });
    assert.equal(await page.locator('.dock-drop-line').isVisible(), true);
    await page.mouse.up();
    assert.deepEqual(await column('left'), ['sel', 'poses', 'params', 'tree']);
    assert.deepEqual(await column('right'), ['frames', 'place']);
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('vn.editor.studioDock'))).left, ['sel', 'poses', 'params', 'tree']);
    assert.equal(await studio.locator('[data-t="resetdock"]').isVisible(), true);
    assert.equal(await studio.locator('.as-sect[data-sect="sel"] .as-gz-name').count(), 1, 'its controls moved with it');
    // Alt+Down twice on Parameters puts Poses and Parts above it: no longer neighbours, so no split grip.
    // Alt+Down on Parameters puts Parts between it and Selection: no longer neighbours, so no split grip.
    await studio.locator('.as-sect[data-sect="params"] .as-sect-grab').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Alt+ArrowDown');
    assert.deepEqual(await column('left'), ['sel', 'poses', 'tree', 'params']);
    assert.equal(await studio.locator('.as-grip-h').isVisible(), false);

    // Kept over a reload and a mode switch.
    studio = await open();
    assert.deepEqual(await column('left'), ['sel', 'poses', 'tree', 'params']);
    await studio.locator('.as-modes [data-mode="model"]').click();
    assert.deepEqual(await column('left'), ['sel', 'poses', 'tree', 'params']);
    assert.deepEqual(await column('right'), ['keyforms', 'warp', 'mask', 'physics', 'auto'], 'Model has its own sections, in the order kept');
    await studio.locator('.as-modes [data-mode="animate"]').click();

    // A narrow window shows the first layout and no grab buttons; the kept layout comes back when it widens.
    await page.setViewportSize({ width: 800, height: 800 });
    assert.deepEqual(await column('left'), ['poses', 'params', 'tree']);
    assert.equal(await studio.locator('.as-sect[data-sect="sel"] .as-sect-grab').isVisible(), false);
    await page.setViewportSize({ width: 1280, height: 800 });
    assert.deepEqual(await column('left'), ['sel', 'poses', 'tree', 'params']);

    await studio.locator('[data-t="resetdock"]').click();
    assert.deepEqual(await column('left'), ['poses', 'params', 'tree']);
    assert.deepEqual(await column('right'), ['sel', 'frames', 'place']);
    assert.equal(await page.evaluate(() => localStorage.getItem('vn.editor.studioDock')), null);
    assert.equal(await studio.locator('[data-t="resetdock"]').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('animation studio: a section can sit in a second left column beside the first, and the side columns fold away when dragged to the window edge', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    await page.locator('#animStudio .as-timeline').waitFor();
    const studio = page.locator('#animStudio');
    const column = (zone) => studio.locator(`.as-dock[data-zone="${zone}"] > .as-sect:not([hidden])`).evaluateAll(els => els.map(e => e.dataset.sect));
    const second = studio.locator('.as-dock[data-zone="left2"]');
    assert.equal(await second.isVisible(), false, 'no second column until it holds a section');

    // Alt+Right on Parts moves it into the second column, which appears beside the first.
    await studio.locator('.as-sect[data-sect="tree"] .as-sect-grab').focus();
    await page.keyboard.press('Alt+ArrowRight');
    assert.deepEqual(await column('left2'), ['tree']);
    assert.deepEqual(await column('left'), ['poses', 'params']);
    const a = await studio.locator('.as-dock[data-zone="left"]').boundingBox(), b = await second.boundingBox();
    assert.ok(b.x >= a.x + a.width - 1 && Math.abs(b.y - a.y) < 2, 'side by side');
    assert.equal(await studio.locator('.as-grip-h').isVisible(), false, 'Parameters and Parts are apart: no split grip');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('vn.editor.studioDock'))).left2, ['tree']);
    // Alt+Left puts it back and the column goes away.
    await page.keyboard.press('Alt+ArrowLeft');
    assert.equal(await second.isVisible(), false);

    // An empty second column shows as a strip to drop in while a section is dragged.
    const grab = await studio.locator('.as-sect[data-sect="tree"] .as-sect-grab').boundingBox();
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
    await page.mouse.down();
    await page.mouse.move(grab.x + 60, grab.y + 20, { steps: 4 });
    const strip = await second.boundingBox();
    assert.ok(strip && strip.width > 20, 'the drop strip shows during the drag');
    await page.mouse.move(strip.x + strip.width / 2, strip.y + 40, { steps: 6 });
    await page.mouse.up();
    assert.deepEqual(await column('left2'), ['tree']);

    // The left grip dragged to the window's edge folds the whole left area into a rail; the rail brings it back.
    const grip = studio.locator('.as-body > .as-grip[data-grip="left"]');
    const g = await grip.boundingBox();
    await page.mouse.move(g.x + 3, g.y + 200);
    await page.mouse.down();
    await page.mouse.move(2, g.y + 200, { steps: 8 });
    await page.mouse.up();
    assert.equal(await studio.locator('.as-rail-left').isVisible(), true);
    assert.equal(await studio.locator('.as-side').evaluate(el => el.getBoundingClientRect().width < 40), true);
    await studio.locator('.as-rail-left').click();
    assert.equal(await studio.locator('.as-rail-left').isVisible(), false);
    assert.equal(await studio.locator('.as-side').evaluate(el => el.getBoundingClientRect().width > 300), true, 'both columns back');

    // The right column folds the same way, by double-clicking its grip.
    await studio.locator('.as-grip-r').dblclick();
    assert.equal(await studio.locator('.as-rail-right').isVisible(), true);
    assert.equal(await studio.locator('.as-inspect').evaluate(el => el.getBoundingClientRect().width < 40), true);
    await studio.locator('.as-rail-right').click();
    assert.equal(await studio.locator('.as-inspect').evaluate(el => el.getBoundingClientRect().width > 200), true);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('animation studio: Model | Animate, Model hides the picker and timeline, Animate brings them back, and the Parts tree is a keyboard list', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    const studio = page.locator('#animStudio');
    await studio.locator('.as-timeline').waitFor();
    assert.deepEqual(await studio.locator('.as-modes button').allTextContents(), ['Model', 'Animate'], 'workflow order, left to right');
    assert.equal(await studio.locator('.as-modes [data-mode="animate"]').getAttribute('aria-pressed'), 'true', 'the Animate button opens Animate mode');
    assert.equal(await studio.locator('.as-picker').isVisible(), true);
    const sections = () => studio.locator('.as-sect:not([hidden])').evaluateAll(els => els.map(e => e.dataset.sect));
    assert.deepEqual(await sections(), ['poses', 'params', 'tree', 'sel', 'frames', 'place'], 'the palette is in the left column, above the Parts tree');
    await studio.locator('.as-modes [data-mode="model"]').click();
    assert.equal(await studio.locator('.as-modes [data-mode="model"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await studio.locator('.as-timeline').isVisible(), false);
    assert.equal(await studio.locator('.as-transport').isVisible(), false);
    assert.equal(await studio.locator('.as-picker').isVisible(), false, 'no animation picker in Model mode');
    assert.deepEqual(await sections(), ['poses', 'params', 'tree', 'keyforms', 'sel', 'warp', 'mask', 'physics', 'auto']);
    const leftOf = sel => studio.locator(sel).evaluate(e => e.closest('.as-side') !== null);
    assert.equal(await leftOf('.ap'), true, 'the sliders are in the left column');
    assert.equal(await leftOf('.ab'), false, 'and the Keyforms block is not');
    // The grip resizes the left column; the size is kept.
    const side = studio.locator('.as-side'), w0 = (await side.boundingBox()).width;
    await studio.locator('.as-grip-v').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(Math.round((await side.boundingBox()).width), Math.round(w0 + 16), 'an arrow key widens the column by 16 px');
    assert.match(await page.evaluate(() => localStorage.getItem('vn.editor.studioLayout')), /"left":316/);
    assert.equal(await studio.locator('.as-sect[data-sect="sel"] .as-sect-head').getAttribute('aria-expanded'), 'true');
    assert.equal(await studio.locator('.as-sect[data-sect="physics"] .as-sect-head').getAttribute('aria-expanded'), 'false', 'rig setup sections start closed');
    await page.keyboard.press('Space'); // the animation does not play in Model mode
    assert.match(await studio.locator('.as-play').textContent(), /Play/);
    await studio.locator('.as-modes [data-mode="animate"]').click();
    assert.equal(await studio.locator('.as-timeline').isVisible(), true);
    assert.equal(await studio.locator('.as-picker').isVisible(), true);
    assert.deepEqual(await sections(), ['poses', 'params', 'tree', 'sel', 'frames', 'place']);
    // The Parts tree: arrows move between rows, Left / Right between the variants of a slot (shown for the chosen slot).
    const focused = () => page.evaluate(() => document.activeElement.dataset.part ?? document.activeElement.dataset.variant ?? null);
    const rows = await studio.locator('.as-tree .as-row').evaluateAll(els => els.map(e => e.dataset.part));
    await studio.locator('.as-tree .as-row').first().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), rows[1]);
    await page.keyboard.press('End');
    assert.equal(await focused(), rows.at(-1));
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused(), rows.at(-2));
    await page.keyboard.press('Home');
    assert.equal(await focused(), rows[0]);
    await studio.locator('.as-tree .as-row:has(.as-badge-slot)').first().click();
    await studio.locator('.as-detail .as-variant').first().focus();
    const first = await focused();
    await page.keyboard.press('ArrowRight');
    assert.notEqual(await focused(), first);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await focused(), first);
    // The eye hides a part on the stage only: it is marked in the tree, "Show all" appears, and it stays hidden across modes.
    const eye = studio.locator('.as-tree .as-eye[data-eye="face"]');
    assert.equal(await studio.locator('.as-showall').count(), 0);
    await eye.click();
    assert.equal(await eye.getAttribute('aria-checked'), 'false');
    assert.equal(await studio.locator('.as-tree .as-row[data-part="face"].as-stagehidden').count(), 1);
    await studio.locator('.as-modes [data-mode="model"]').click();
    await studio.locator('.as-modes [data-mode="animate"]').click();
    assert.equal(await studio.locator('.as-tree .as-eye[data-eye="face"]').getAttribute('aria-checked'), 'false', 'a hidden part stays hidden when the mode changes');
    // A click on the stage lands on what is drawn there: with the part under it hidden, the click goes to what lies behind it.
    await studio.locator('.as-showall').click();
    const sum = () => studio.locator('.as-sect[data-sect="sel"] .as-sect-sum').textContent();
    const stage = await studio.locator('.as-stage').boundingBox();
    const clickMid = async () => { await studio.locator('.as-tree .as-row').first().click(); await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height * 0.6); await page.waitForTimeout(300); return sum(); };
    const top = await clickMid();
    assert.notEqual(top, 'the whole character', 'the middle of the stage is on the character');
    await studio.locator(`.as-tree .as-eye[data-eye="${top}"]`).click();
    assert.notEqual(await clickMid(), top, 'a hidden part takes no click');
    await studio.locator('.as-showall').click();
    assert.equal(await clickMid(), top, 'shown again, it is picked again');
    await studio.locator('.as-tree .as-eye[data-eye="eyes"]').click({ modifiers: ['Alt'] });
    assert.equal(await studio.locator('.as-tree .as-eye[aria-checked="true"]').count(), (await studio.locator('.as-tree .as-eye').count()) - (await studio.locator('.as-tree .as-eye[aria-checked="false"]').count()));
    await studio.locator('.as-showall').click();
    assert.equal(await studio.locator('.as-tree .as-eye[aria-checked="false"]').count(), 0);
    assert.equal(await studio.locator('.as-showall').count(), 0);
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: the Model button opens Model mode, and dragging on the stage moves the chosen pivot in one undo step', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Model' }).first().click();
    const studio = page.locator('#animStudio');
    await studio.locator('.as-timeline').waitFor({ state: 'hidden' });
    assert.equal(await studio.locator('.as-modes [data-mode="model"]').getAttribute('aria-pressed'), 'true');
    await studio.locator('.as-tree .as-row[data-part="face"]').click();
    await studio.locator('[data-gz="pivot"]').click(); // Model opens on Move (a click on the stage picks parts to bind); the Pivot tool places pivots
    const x = studio.locator('[data-p="x"]'), y = studio.locator('[data-p="y"]');
    const before = [await x.inputValue(), await y.inputValue()];
    const box = await studio.locator('.as-stage').boundingBox();
    // The stage page may still be loading: it takes the pick once its cursor turns into a crosshair.
    const cursor = () => page.frameLocator('#animStudio iframe').locator('#stage').evaluate(e => e.style.cursor);
    for (let i = 0; (await cursor().catch(() => '')) !== 'crosshair' && i < 50; i++) await page.waitForTimeout(100);
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.notDeepEqual([await x.inputValue(), await y.inputValue()], before, 'the drag moved the pivot');
    await studio.locator('[data-t="undo"]').click(); // the whole drag is one step
    assert.deepEqual([await x.inputValue(), await y.inputValue()], before);
    assert.equal(await studio.locator('[data-t="undo"]').isDisabled(), true);
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: bones are edited in the Selection section of Model mode (new bone, parent, part on a bone, pivot, remove) and written by Apply', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    const studio = page.locator('#animStudio');
    await studio.locator('.as-tree .as-row[data-part="head"]').waitFor();
    assert.equal(await studio.locator('.as-detail select').count(), 0, 'Animate mode does not edit bones');
    assert.equal(await studio.locator('.as-bone-new').count(), 0);
    await studio.locator('.as-modes [data-mode="model"]').click();
    const choose = name => studio.locator(`.as-tree .as-row[data-part="${name}"]`).click();
    const select = name => studio.locator(`.as-detail select[data-bone-for="${name}"]`);
    await choose('face');
    assert.equal(await select('face').inputValue(), 'head', 'face sits on the head bone');
    // a new bone under the head, then the bangs move onto it and it turns about a pivot of its own
    await choose('head');
    await studio.locator('.as-bone-new').click();
    await studio.locator('.as-tree .as-row[data-part="bone"]').waitFor();
    assert.equal(await select('bone').inputValue(), 'head', 'a new bone hangs from the chosen bone, and is the chosen one');
    await select('bone').selectOption('');
    assert.equal(await select('bone').inputValue(), '', 'and can be moved to the top');
    await select('bone').selectOption('head');
    assert.equal(await select('bone').inputValue(), 'head');
    await choose('bangs');
    await select('bangs').selectOption('bone');
    await choose('head'); // the head bone's own pivot is edited in the fields
    assert.deepEqual([await studio.locator('[data-p="x"]').inputValue(), await studio.locator('[data-p="y"]').inputValue()], ['270', '380']);
    await studio.locator('[data-p="x"]').fill('300');
    await studio.locator('[data-p="x"]').press('Tab');
    await studio.locator('[data-t="apply"]').click();
    for (let i = 0; !saved.length && i < 50; i++) await page.waitForTimeout(100);
    assert.ok(saved.length, 'the rig.json tab was not saved');
    let rig = JSON.parse(saved.at(-1));
    assert.deepEqual(rig.bones.bone, { parent: 'head' });
    assert.deepEqual(rig.bones.head.pivot, [300, 380]);
    assert.equal(rig.parts.bangs.bone, 'bone');
    assert.equal(rig.parts.face.bone, 'head', 'the rest of parts stays');
    // removing it puts the bangs back on the head
    await choose('bone');
    await studio.locator('.as-detail .as-bone-del').click();
    await choose('bangs');
    assert.equal(await select('bangs').inputValue(), 'head');
    await studio.locator('[data-t="apply"]').click();
    for (let i = 0; JSON.parse(saved.at(-1)).bones.bone && i < 50; i++) await page.waitForTimeout(100);
    rig = JSON.parse(saved.at(-1));
    assert.equal(rig.bones.bone, undefined);
    assert.equal(rig.parts.bangs.bone, 'head');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: the mouth and blink fields (By itself, Model mode) are written to rig.json by Apply', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const saved = [];
  // The editor autosaves a rig.json edit; catch the request so the sample project is left alone.
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Model' }).first().click();
    const studio = page.locator('#animStudio');
    await openSection(studio, 'auto');
    await studio.locator('.as-sp-vars').waitFor();
    const field = async (sel, v) => { await studio.locator(sel).fill(v); await studio.locator(sel).press('Tab'); };
    assert.equal(await studio.locator('.as-bl-slot').isDisabled(), !(await studio.locator('.as-blink').isChecked()));
    await field('.as-sp-vars', 'open, neutral');
    await field('.as-sp-rate', '6');
    await studio.locator('.as-blink').check();
    await field('.as-bl-min', '2');
    await field('.as-bl-dur', '0.2');
    assert.equal(await studio.locator('.as-bl-max').inputValue(), '6'); // an empty end takes its default
    await field('.as-bl-max', '1'); // a range that runs backwards is not kept
    assert.equal(await studio.locator('.as-bl-max').inputValue(), '6');
    await studio.locator('[data-t="apply"]').click();
    for (let i = 0; !saved.length && i < 50; i++) await page.waitForTimeout(100);
    assert.ok(saved.length, 'the rig.json tab was not saved');
    const rig = JSON.parse(saved.at(-1));
    assert.deepEqual(rig.autonomous.speak, { slot: 'mouth', variants: ['open', 'neutral'], rate: 6 });
    assert.deepEqual(rig.autonomous.blink, { slot: 'eyes', variant: 'closed', every: [2, 6], dur: 0.2 });
    assert.ok(rig.animations && rig.pivots && rig.autonomous.idle, 'the rest of the file stays');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: the Parameters section moves a pad and a slider, keys them into parameter lanes, and saves a pose', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).nth(1).click(); // robo, the sample's rig with parameters
    const studio = page.locator('#animStudio');
    await studio.locator('.ap-group').first().waitFor(); // open by default in Animate mode when the rig has parameters
    assert.equal(await studio.locator('.ap-group .ap-fold').allTextContents().then(l => l.join(',')), 'Head,Arms,Body', 'categories in the order of rig.json categories');
    assert.equal(await studio.locator('.ap-pad').count(), 1, 'head_x and head_y are one pad');
    assert.equal(await studio.locator('.ap-row[data-ctl="head_x"], .ap-row[data-ctl="head_y"]').count(), 2, 'the pad axes keep a slider each');
    await studio.locator('.as-more').click(); // the animation picker's menu
    await page.locator('.ctxmenu button', { hasText: 'New animation' }).click();
    await studio.locator('.as-name input').fill('turn');
    await studio.locator('.as-name button[type="submit"]').click();
    assert.equal(await studio.locator('.as-anim').inputValue(), 'turn', 'the picker shows the new animation');
    // A drag on the pad and a slider change; the key buttons write tracks, drawn as lanes under the channel lanes.
    const pad = await studio.locator('.ap-pad').boundingBox();
    await page.mouse.click(pad.x + pad.width * 0.9, pad.y + pad.height * 0.5);
    await studio.locator('.ap-padrow .ap-key').click();
    assert.equal(await studio.locator('.ap-row[data-ctl="head_x"] .ap-num').inputValue(), await studio.locator('.ap-read').textContent().then(t => String(Number(/head_x (\S+),/.exec(t)[1]))), 'the axis slider follows the pad');
    await studio.locator('.ap-row[data-ctl="arm_r_lift"] .ap-num').fill('0.5');
    await studio.locator('.ap-row[data-ctl="arm_r_lift"] .ap-key').click();
    assert.equal(await studio.locator('.tl-pkey').count(), 3, 'head_x, head_y and arm_r_lift each got a key');
    assert.equal(await studio.locator('.ap-key.ap-keyed').count(), 4, 'the pad, its two axis sliders and the slider show a key at the playhead');
    await openSection(studio, 'poses');
    // Reset puts the pad back to its default; a pose saves what differs.
    await studio.locator('.ap-pose-name').fill('turned');
    await studio.locator('.ap-pose-save').click();
    assert.match(await studio.locator('.as-note').textContent(), /Saved pose "turned"/);
    await studio.locator('.ap-pose-name').fill('scratch');
    await studio.locator('.ap-pose-save').click();
    await studio.locator('.ap-pose-sel').selectOption('scratch');
    await studio.locator('.ap-pose-del').click();
    assert.equal(await studio.locator('.ap-pose-sel option').allTextContents().then(l => l.includes('scratch')), false, 'the ✕ next to the pose picker deletes a pose');
    assert.match(await studio.locator('.as-sect[data-sect="poses"] .as-sect-sum').textContent(), /^[0-9]+ poses?$/);
    assert.equal(await studio.locator('.ap-pose-sel option').allTextContents().then(l => l.includes('turned')), true);
    await studio.locator('.ap-padrow .ap-reset').click();
    assert.match(await studio.locator('.ap-read').textContent(), /head_x 0, head_y 0/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape'); // the first one warns about unapplied changes
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: Model mode previews the parameters and keys them as keyforms (no timeline, no Key changed), and says pivots belong to the rest pose', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo
    const studio = page.locator('#animStudio');
    await openSection(studio, 'poses');
    await openSection(studio, 'params');
    await studio.locator('.ap-pad').waitFor();
    assert.equal(await studio.locator('.ap-row .ap-key').first().isVisible(), true, 'the key button is there in Model mode: it keys a keyform of the chosen part');
    assert.equal(await studio.locator('.ap-row .ap-key').first().isDisabled(), true, 'but with no part chosen there is nothing to key');
    assert.equal(await studio.locator('.ap-target, .ap-kf').count(), 0, 'no part-first keyed target or Keyform row: the Bind block under the controls is the one place');
    assert.equal(await studio.locator('.ab-name').textContent(), 'none', 'no parameter is active until the author picks one');
    assert.equal(await studio.locator('.ap-key-all').isVisible(), false, 'Key changed writes timeline keys: Animate only');
    assert.equal(await studio.locator('.ap-keyedit').isVisible(), false);
    assert.equal(await studio.locator('.ap-pose-save').isVisible(), true, 'poses stay: they are rig data');
    assert.equal(await studio.locator('.as-rest-note').isVisible(), false, 'nothing to say while the parameters are at their defaults');
    const pad = await studio.locator('.ap-pad').boundingBox();
    await page.mouse.click(pad.x + pad.width * 0.9, pad.y + pad.height * 0.5);
    assert.match(await studio.locator('.ap-read').textContent(), /head_x 0\.[0-9]+/);
    assert.equal(await studio.locator('.as-rest-note').isVisible(), true, 'a parameter is off its default: the stage shows that pose');
    await studio.locator('.ap-reset-all').click();
    assert.equal(await studio.locator('.as-rest-note').isVisible(), false);
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true, 'previewing changes nothing in the working copy');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

// Rotates the chosen part with the gizmo's ring, `deg` degrees clockwise on the screen, in one drag.
async function dragRing(page, deg) {
  const ring = page.frames().find(f => f.url().includes('studio=')).locator('svg circle[r="64"]');
  await ring.waitFor({ timeout: 10000 });
  const b = await ring.boundingBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2, r = b.width / 2, a = (deg * Math.PI) / 180;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  await page.mouse.move(cx + r * Math.cos(a / 2), cy + r * Math.sin(a / 2), { steps: 4 });
  await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test('animation studio: the tool row is icon buttons with names, key letters and groups, its toggles report their state, and it fits a phone', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).nth(1).click(); // robo
    const studio = page.locator('#animStudio');
    const row = studio.locator('.as-gizmo');
    await row.waitFor();
    const btn = name => row.getByRole('button', { name, exact: true });
    const shown = () => row.locator('.si-btn').evaluateAll(els => els.filter(e => e.getClientRects().length).map(e => [e.getAttribute('aria-label'), e.textContent.trim(), !!e.querySelector('svg.si[aria-hidden="true"]')]));
    // Icons carry no text; the accessible name is the label. Animate has no Pivot, Warp or Mask.
    assert.deepEqual(await shown(), [['Move', '', true], ['Rotate', '', true], ['Scale', '', true], ['World axes', '', true], ['Fit', '', true], ['Auto-key', '', true], ['Key', '', true]]);
    for (const [gz, name, key] of [['pivot', 'Pivot', 'Q'], ['move', 'Move', 'W'], ['rotate', 'Rotate', 'E'], ['scale', 'Scale', 'R'], ['warp', 'Warp', 'D'], ['mask', 'Mask', 'M']]) {
      const b = row.locator(`[data-gz="${gz}"]`);
      assert.equal(await b.getAttribute('aria-label'), name);
      assert.ok((await b.getAttribute('title')).startsWith(`${name} (${key})`), `the tooltip names the tool and its key: ${await b.getAttribute('title')}`);
      assert.equal(await b.getAttribute('aria-keyshortcuts'), key);
    }
    assert.match(await btn('World axes').getAttribute('title'), /^World axes \(X\)/);
    assert.match(await btn('Fit').getAttribute('title'), /^Fit \(F\)/);
    assert.deepEqual(await row.getByRole('group').evaluateAll(els => els.map(e => e.getAttribute('aria-label'))), ['Transform tools', 'View', 'Keying'], 'the Deform group is Model\'s');
    // The chosen tool is the pressed one, by click and by key.
    assert.equal(await btn('Move').getAttribute('aria-pressed'), 'true');
    await btn('Rotate').click();
    assert.deepEqual(await Promise.all(['Move', 'Rotate', 'Scale'].map(n => btn(n).getAttribute('aria-pressed'))), ['false', 'true', 'false']);
    await page.keyboard.press('r');
    assert.equal(await btn('Scale').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('q');
    assert.match(await studio.locator('.as-note').textContent(), /Pivot tool is for Model mode/, 'a key for a tool the mode does not have still says so');
    // Toggles: World axes (X) and Auto-key. Key is a command and waits for a drag.
    assert.equal(await btn('World axes').getAttribute('aria-pressed'), 'false');
    await btn('World axes').click();
    assert.equal(await btn('World axes').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('x');
    assert.equal(await btn('World axes').getAttribute('aria-pressed'), 'false', 'X toggles it too');
    assert.equal(await btn('Auto-key').getAttribute('aria-pressed'), 'true');
    assert.equal(await btn('Key').getAttribute('aria-pressed'), null);
    assert.equal(await btn('Key').isDisabled(), true, 'nothing previewed yet');
    // Auto-key on keys a drag at once; off, the drag previews and Key writes it.
    await studio.locator('.as-more').click();
    await page.locator('.ctxmenu button', { hasText: 'New animation' }).click();
    await studio.locator('.as-name input').fill('icon tools');
    await studio.locator('.as-name button[type="submit"]').click();
    await studio.locator('.as-tree .as-row[data-part="face"]').click();
    await btn('Rotate').click();
    const keys = () => studio.locator('.tl-key').count();
    const k0 = await keys();
    await dragRing(page, 30);
    const k1 = await keys();
    assert.ok(k1 > k0, 'Auto-key wrote a key at the playhead');
    await btn('Auto-key').click();
    assert.equal(await btn('Auto-key').getAttribute('aria-pressed'), 'false');
    await studio.locator('.as-slider').fill('500');
    await dragRing(page, 30);
    assert.equal(await keys(), k1, 'with Auto-key off a drag only previews');
    assert.equal(await btn('Key').isDisabled(), false);
    await btn('Key').click();
    assert.ok(await keys() > k1, 'Key wrote the previewed drag');
    assert.equal(await btn('Key').isDisabled(), true);
    // Model mode: the deform group and Pivot come in, keying goes.
    await studio.locator('.as-modes button', { hasText: 'Model' }).click();
    assert.deepEqual((await shown()).map(s => s[0]), ['Pivot', 'Move', 'Rotate', 'Scale', 'Warp', 'Mask', 'World axes', 'Fit']);
    assert.deepEqual(await row.getByRole('group').evaluateAll(els => els.map(e => e.getAttribute('aria-label'))), ['Transform tools', 'Deform tools', 'View']);
    assert.equal(await btn('Pivot').getAttribute('aria-pressed'), 'false', 'Model keeps the tool in hand (Move at the start); Pivot is one click away');
    await btn('Warp').click();
    assert.equal(await btn('Warp').getAttribute('aria-pressed'), 'true');
    assert.equal(await btn('Pivot').getAttribute('aria-pressed'), 'false');
    // A phone: every button on one line inside the window, with no sideways scroll.
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 700 });
      for (const mode of ['Animate', 'Model']) {
        await studio.locator('.as-modes button', { hasText: mode }).click();
        const fit = await row.locator('.si-btn').evaluateAll(els => {
          const r = els.filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect());
          return { ys: new Set(r.map(b => Math.round(b.y))).size, left: Math.min(...r.map(b => b.left)), right: Math.max(...r.map(b => b.right)), scroll: document.documentElement.scrollWidth - innerWidth, wide: Math.min(...r.map(b => b.width)) };
        });
        assert.equal(fit.ys, 1, `the tool row is one line at ${width} px in ${mode}`);
        assert.ok(fit.left >= 0 && fit.right <= width, `the buttons are inside a ${width} px window in ${mode}`);
        assert.ok(fit.scroll <= 0, `no sideways scroll at ${width} px in ${mode}`);
        assert.ok(fit.wide >= 28, 'a button stays big enough to hit');
      }
    }
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: in Model mode a gizmo drag writes the chosen part\'s keyform at the keyed parameter value, one undo step per drag, with a mark on the track', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo: arm_r is keyed to arm_r_lift (0 and 1)
    const studio = page.locator('#animStudio');
    await studio.locator('.ap-pad').waitFor();
    assert.equal(await studio.locator('.as-sect[data-sect="params"] .as-sect-head').getAttribute('aria-expanded'), 'true', 'the Parameters section is open in Model mode');
    assert.equal(await studio.locator('[data-gz="rotate"]').isVisible(), true, 'Rotate and Scale are Model tools now');
    assert.equal(await studio.locator('[data-gz="scale"]').isVisible(), true);
    await studio.locator('.as-tree .as-row[data-part="arm_r"]').click();
    const row = studio.locator('.ap-row[data-ctl="arm_r_lift"]'), num = row.locator('.ap-num'), ticks = row.locator('.ap-tick');
    const rot = studio.locator('[data-bf="rot"]'), undo = studio.locator('[data-t="undo"]');
    await row.locator('label').click(); // the author picks the parameter: nothing is guessed from the chosen part
    assert.equal(await studio.locator('.ab-name').textContent(), 'arm_r_lift');
    assert.match(await studio.locator('.ab-formtext').textContent(), /^arm_r at arm_r_lift = 0 \(a key\)/, 'the pose stored at the slider\'s value');
    assert.deepEqual(await ticks.evaluateAll(els => els.map(e => e.title)), ['At rest at 0: click to set arm_r_lift to 0', 'Posed at 1: click to set arm_r_lift to 1'], 'marks on the track at the keyed values');
    await num.fill('0.5');
    await num.press('Enter');
    assert.match(await studio.locator('.ab-formtext').textContent(), /^arm_r at arm_r_lift = 0\.5: between keys/);
    assert.equal(await row.locator('.ap-key').getAttribute('aria-pressed'), 'false');
    await studio.locator('[data-gz="rotate"]').click();
    await dragRing(page, 40);
    assert.equal(await ticks.count(), 3, 'the drag made a key at 0.5');
    assert.match(await studio.locator('.ab-formtext').textContent(), /^arm_r at arm_r_lift = 0\.5 \(a key\)/);
    const written = Number(await rot.inputValue());
    assert.ok(written > 70 && written < 80, `the key holds the pose on show (35) plus the drag (about 40): ${written}`);
    assert.equal(await row.locator('.ap-key').getAttribute('aria-pressed'), 'true');
    assert.equal(await num.inputValue(), '0.5', 'the slider stays at the value');
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), false);
    await undo.click(); // the whole drag is one step
    assert.equal(await ticks.count(), 2);
    assert.equal(await undo.isDisabled(), true);
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true);
    await studio.locator('[data-t="redo"]').click();
    assert.equal(await ticks.count(), 3);
    // The numeric field edits the same key; the key button removes it.
    await rot.fill('50');
    await rot.press('Enter');
    assert.equal(await rot.inputValue(), '50');
    await row.locator('.ap-key').click();
    assert.equal(await ticks.count(), 2, 'the key button unkeys the value');
    assert.equal(await row.locator('.ap-key').getAttribute('aria-pressed'), 'false');
    await row.locator('.ap-key').click();
    assert.equal(await ticks.count(), 3, 'and keys it again, holding the pose on show');
    assert.equal(Number(await rot.inputValue()), 35);
    // A tick sets the slider to the key.
    await ticks.nth(2).click();
    assert.equal(await num.inputValue(), '1');
    // Apply writes the keyform.
    await studio.locator('[data-t="apply"]').click();
    for (let i = 0; i < 50 && !saved.length; i++) await page.waitForTimeout(100); // the rig.json tab is saved a moment after Apply
    const rig = JSON.parse(saved.at(-1));
    assert.deepEqual(rig.keyforms.filter(k => k.target === 'arm_r'), [{ target: 'arm_r', param: 'arm_r_lift', keys: [{ at: 0 }, { at: 0.5, rot: 35 }, { at: 1, rot: 70 }] }]);
    // Animate mode is what it was: no Bind block, no editing, its key button keys the animation.
    await studio.locator('.as-modes [data-mode="animate"]').click();
    assert.equal(await studio.locator('.ab').isVisible(), false);
    assert.equal(await studio.locator('.ap-edit-btn').first().isVisible(), false);
    assert.equal(await studio.locator('.ap-add').isVisible(), false, 'the + for new controls is Model mode only');
    assert.equal(await studio.locator('.ap-tick').count(), 0, 'no marks: Animate shows the timeline\'s keys instead');
    await openSection(studio, 'poses');
    assert.equal(await studio.locator('.ap-key-all').isVisible(), true);
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: a pad writes the grid corner nearest its dot, a grid grows, and parameters can be created, renamed, re-ranged and deleted', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo: head_turn is a pad over head_x and head_y
    const studio = page.locator('#animStudio');
    await studio.locator('.ap-pad').waitFor();
    const undo = studio.locator('[data-t="undo"]'), note = studio.locator('.as-note');
    await studio.locator('.as-tree .as-row[data-part="eyes"]').click();
    assert.equal(await studio.locator('.ab-name').textContent(), 'none', 'eyes has no keyform: no parameter is active until the author picks one');
    const pad = await studio.locator('.ap-pad').boundingBox();
    await page.mouse.click(pad.x + pad.width - 2, pad.y + pad.height * 0.5); // the pad is picked by using it; this is the right-hand corner of the middle row
    assert.equal(await studio.locator('.ab-name').textContent(), 'head_turn');
    assert.match(await studio.locator('.ab-formtext').textContent(), /^eyes is not bound to head_turn yet/);
    assert.equal(await studio.locator('.ap-corner').count(), 0, 'no grid yet');
    await studio.locator('[data-gz="move"]').click();
    const frame = page.frames().find(f => f.url().includes('studio='));
    const arrow = frame.locator('svg polygon[fill="#ff5d5d"]'); // the x arrow of the move gizmo
    await arrow.waitFor({ timeout: 10000 });
    const a = await arrow.first().boundingBox(), ax = a.x + a.width / 2, ay = a.y + a.height / 2;
    await page.mouse.move(ax, ay);
    await page.mouse.down();
    await page.mouse.move(ax + 20, ay, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(await studio.locator('.ap-corner').count(), 9, 'the first drag made the grid: min, default and max on each axis');
    assert.equal(await studio.locator('.ap-corner.ap-authored').count(), 1, 'one corner is posed');
    assert.ok(Number(await studio.locator('[data-bf="dx"]').inputValue()) > 0, 'the corner holds the move');
    assert.match(await note.textContent(), /^Bound eyes to head_turn and wrote eyes at head_x 1, head_y 0 as a keyform/);
    await undo.click();
    assert.equal(await studio.locator('.ap-corner').count(), 0, 'one undo removes the grid again');
    await studio.locator('[data-t="redo"]').click();
    // + column: a grid line at the dot's x. The dot moves off the corner first.
    await page.mouse.click(pad.x + pad.width * 0.75, pad.y + pad.height * 0.5);
    await studio.locator('.ap-grid-add').first().click();
    assert.equal(await studio.locator('.ap-corner').count(), 12, 'a column of three corners was added');
    assert.match(await note.textContent(), /Added a grid line at head_x = 0\.5/);
    // The controls themselves.
    const rows = () => studio.locator('.ap-row').count();
    const before = await rows();
    await addControl(studio, 'param');
    assert.equal(await rows(), before + 1);
    const editor = studio.locator('.ap-editor:visible');
    assert.equal(await editor.count(), 1, 'a new parameter opens its editor');
    await editor.locator('input[type="text"]').first().fill('smile');
    await editor.locator('input[type="text"]').first().press('Enter');
    assert.equal(await studio.locator('.ap-row[data-ctl="smile"]').count(), 1, 'renamed');
    await studio.locator('.ap-editor:visible input[type="number"]').nth(1).fill('3');
    await studio.locator('.ap-editor:visible input[type="number"]').nth(1).press('Enter');
    assert.deepEqual(await studio.locator('.ap-row[data-ctl="smile"] input[type="range"]').evaluate(e => [e.min, e.max]), ['-1', '3'], 'the range follows');
    await studio.locator('.ap-editor:visible input[type="text"]').first().fill('arm_r_lift');
    await studio.locator('.ap-editor:visible input[type="text"]').first().press('Enter');
    assert.match(await note.textContent(), /There is a parameter named "arm_r_lift" already/, 'a name that is taken is refused');
    // The + menu also adds a pad; the ✕ on the active row deletes a control in one step.
    const n0 = await rows();
    await addControl(studio, 'param');
    assert.equal(await rows(), n0 + 1);
    assert.equal(await studio.locator('.ap-row.ap-active .ap-del-btn').isVisible(), true, 'the active row shows a delete next to the edit button');
    await studio.locator('.ap-row.ap-active .ap-del-btn').click();
    assert.equal(await rows(), n0, 'the ✕ deleted the new parameter');
    const pads0 = await studio.locator('.ap-padrow').count();
    await addControl(studio, 'pad');
    assert.equal(await studio.locator('.ap-padrow').count(), pads0 + 1, 'New pad in the + menu');
    await studio.locator('.ap-padrow.ap-active .ap-del-btn').click();
    assert.equal(await studio.locator('.ap-padrow').count(), pads0, 'the ✕ on a pad deletes the pad');
await studio.locator('.ap-row[data-ctl="smile"] label').click();
    await studio.locator('.ap-row[data-ctl="smile"] .ap-edit-btn').click();
    await studio.locator('[data-t="apply"]').click();
    for (let i = 0; i < 50 && !saved.length; i++) await page.waitForTimeout(100); // the rig.json tab is saved a moment after Apply
    const rig = JSON.parse(saved.at(-1));
    assert.deepEqual(rig.parameters.at(-1), { id: 'smile', min: -1, max: 3, default: 0 });
    const grid = rig.keyforms.find(k => k.target === 'eyes');
    assert.deepEqual(grid.params, ['head_x', 'head_y']);
    assert.deepEqual(grid.grid.x, [-1, 0, 0.5, 1]);
    await studio.locator('.ap-editor:visible .ap-delete').click();
    assert.equal(await studio.locator('.ap-row[data-ctl="smile"]').count(), 0, 'deleted');
    await undo.click();
    assert.equal(await studio.locator('.ap-row[data-ctl="smile"]').count(), 1, 'undo brings it back');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: Model mode is parameter first: the author picks the parameter, picking a part binds it with keys at rest, posing writes a key, and a part lists what moves it', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo
    const studio = page.locator('#animStudio');
    await studio.locator('.ap-pad').waitFor();
    const note = studio.locator('.as-note'), active = studio.locator('.ab-name'), bound = studio.locator('.ab-part'), undo = studio.locator('[data-t="undo"]');
    assert.equal(await studio.locator('.as-modes [data-mode="model"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await studio.locator('.as-modes [data-mode="keyform"]').count(), 0, 'Model and Animate are the only modes');
    assert.equal(await studio.locator('.as-sect[data-sect="params"] .as-sect-head').getAttribute('aria-expanded'), 'true');
    assert.equal(await studio.locator('.ab').isVisible(), true, 'the Bind block is under the controls');
    assert.equal(await studio.locator('.ap-target, .ap-kf').count(), 0, 'no part-first keyed target line');
    assert.equal(await studio.locator('[data-gz="pivot"]').isVisible(), true, 'the Pivot tool is still in Model');
    assert.equal(await studio.locator('[data-gz="move"]').getAttribute('aria-pressed'), 'true', 'Model starts on Move, so a click on the stage picks parts');
    assert.equal(await studio.locator('.as-sect[data-sect="sel"]').isVisible(), true);
    assert.equal(await active.textContent(), 'none', 'no parameter is active until the author picks one');
    assert.equal(await studio.locator('.ap-row.ap-active, .ap-padrow.ap-active').count(), 0);
    // With no active parameter a click on a part of the stage only selects it: nothing is bound.
    const stage = await studio.locator('.as-stage iframe').boundingBox();
    const spineRow = studio.locator('.as-row[data-part="spine"]');
    for (let i = 0; i < 20 && (await spineRow.getAttribute('aria-pressed')) !== 'true'; i++) { // the art may still be loading: a click on nothing picks nothing
      await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5); // the middle of the robo: the spine
      await page.waitForTimeout(400);
    }
    assert.equal(await spineRow.getAttribute('aria-pressed'), 'true', 'the click chose the spine');
    assert.equal(await bound.count(), 0);
    assert.equal(await studio.locator('.as-bind').count(), 0, 'and there are no ticks in the tree while no parameter is active');
    // Nothing is guessed: choosing a part that one parameter moves does not make that parameter active; its button jumps there.
    await studio.locator('.as-tree .as-row[data-part="arm_r"]').click();
    assert.equal(await active.textContent(), 'none');
    assert.deepEqual(await studio.locator('.ab-aff').allTextContents(), ['arm_r_lift'], 'the parameters that move the chosen part');
    await studio.locator('.ab-aff').click();
    assert.equal(await active.textContent(), 'arm_r_lift');
    assert.equal(await studio.locator('.ap-row[data-ctl="arm_r_lift"]').evaluate(e => e.classList.contains('ap-active')), true, 'the active row is highlighted');
    // One line to a control: only the active row shows reset and edit, the others keep their width for the slider.
    assert.equal(await studio.locator('.ap-row[data-ctl="arm_r_lift"] .ap-edit-btn').isVisible(), true, 'the active row shows reset and edit');
    assert.equal(await studio.locator('.ap-row[data-ctl="eye_open"] .ap-edit-btn').isVisible(), false, 'another row shows only its key button');
    assert.equal(await studio.locator('.ap-row[data-ctl="eye_open"] .ap-key').isVisible(), true);
    assert.equal(await bound.count(), 1, 'arm_r is bound to arm_r_lift already (the sample rig)');
    assert.match(await bound.first().textContent(), /^arm_rpose2 keys · 1 posed$/);
    // A new parameter becomes the active one. A click on a part of the stage binds it: keys at min, default and max, all at rest.
    await addControl(studio, 'param');
    const editor = studio.locator('.ap-editor:visible input[type="text"]').first();
    await editor.fill('wave');
    await editor.press('Enter');
    assert.equal(await active.textContent(), 'wave');
    assert.equal(await bound.count(), 0);
    assert.match(await studio.locator('.ab-hint').textContent(), /Click a part on the stage, or tick it in the Parts tree, to bind it to wave/);
    await studio.locator('.as-row[data-part="torso"]').click(); // another part is chosen, then a Shift-click on the spine only selects it
    await page.keyboard.down('Shift');
    for (let i = 0; i < 20 && (await spineRow.getAttribute('aria-pressed')) !== 'true'; i++) {
      await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
      await page.waitForTimeout(400);
    }
    await page.keyboard.up('Shift');
    assert.equal(await spineRow.getAttribute('aria-pressed'), 'true', 'the Shift-click chose the spine');
    assert.equal(await bound.count(), 0, 'but did not bind it');
    assert.doesNotMatch(await note.textContent(), /^Bound/);
    for (let i = 0; i < 20 && !/^Bound/.test(await note.textContent()); i++) { // the art may still be loading: a click on nothing picks nothing
      await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5); // the middle of the robo: the spine
      await page.waitForTimeout(400);
    }
    assert.match(await note.textContent(), /^Bound spine to wave: keys at -1, 0, 1, all at rest/);
    assert.equal(await bound.count(), 1);
    assert.match(await bound.first().textContent(), /^spinepose3 keys$/, 'three keys, none posed');
    assert.equal(await studio.locator('.ap-row[data-ctl="wave"] .ap-tick').count(), 3, 'a mark on the track for each key');
    assert.equal(await studio.locator('.as-bind[data-bind="spine"]').getAttribute('aria-checked'), 'true', 'and its tick in the Parts tree');
    await undo.click();
    assert.equal(await bound.count(), 0, 'binding is one undo step');
    await studio.locator('[data-t="redo"]').click();
    // The tick of another row binds that part too (and a second tick unbinds it).
    await studio.locator('.as-bind[data-bind="forearm_r"]').click();
    assert.equal(await bound.count(), 2);
    assert.equal(await studio.locator('.as-row[data-part="forearm_r"]').getAttribute('aria-pressed'), 'true', 'a bound pick is chosen as well');
    await studio.locator('.as-bind[data-bind="forearm_r"]').click();
    assert.equal(await bound.count(), 1);
    // Click a key, pose there with the gizmo: one undo step, the key is posed, the others stay at rest.
    await studio.locator('.as-row[data-part="spine"]').click();
    assert.deepEqual(await studio.locator('.ab-key').allTextContents(), ['-1', '0', '1']);
    await studio.locator('.ab-key', { hasText: /^1$/ }).click();
    assert.equal(await studio.locator('.ap-row[data-ctl="wave"] .ap-num').inputValue(), '1', 'the slider went to the key');
    await studio.locator('[data-gz="rotate"]').click();
    await dragRing(page, 25);
    assert.match(await note.textContent(), /^Wrote spine at wave = 1 as a keyform/);
    const rot = studio.locator('[data-bf="rot"]');
    assert.ok(Math.abs(Number(await rot.inputValue()) - 25) < 1, `the key holds the drag: ${await rot.inputValue()}`);
    assert.match(await bound.first().textContent(), /3 keys · 1 posed/);
    assert.equal(await studio.locator('.ap-row[data-ctl="wave"] .ap-tick:not(.ap-rest)').count(), 1, 'one posed mark, two at rest');
    await undo.click();
    assert.match(await bound.first().textContent(), /^spinepose3 keys$/, 'the drag was one step; the binding stays');
    await studio.locator('[data-t="redo"]').click();
    // Ctrl-click adds a part to the chosen ones: one drag poses both by the same delta, as one undo step; a plain click goes back to one.
    await studio.locator('.as-row[data-part="torso"]').click({ modifiers: ['Control'] });
    assert.equal(await studio.locator('.as-row[data-part="spine"]').getAttribute('aria-pressed'), 'true', 'the spine stays the chosen part');
    assert.equal(await bound.count(), 1, 'adding does not bind by itself');
    await dragRing(page, 15);
    assert.match(await note.textContent(), /^Bound 2 parts \(spine, torso\) to wave and wrote 2 parts \(spine, torso\) at wave = 1 as keyforms/);
    assert.equal(await bound.count(), 2);
    await undo.click();
    assert.equal(await bound.count(), 1, 'the whole drag, binding included, is one undo step');
    await studio.locator('[data-t="redo"]').click();
    assert.equal(await bound.count(), 2);
    await studio.locator('.as-row[data-part="spine"]').click(); // a plain click drops the added part from the chosen set
    await dragRing(page, 5);
    assert.match(await note.textContent(), /^Wrote spine at wave = 1 as a keyform/);
    await undo.click();
    await studio.locator('.as-bind[data-bind="torso"]').click(); // unbind it again so the rest of the test sees one bound part
    assert.equal(await bound.count(), 1);
    // The default key cannot be removed; another one can.
    await studio.locator('.ab-key', { hasText: /^0$/ }).click();
    assert.equal(await studio.locator('.ab-keyhere').isDisabled(), true, 'the default key stays');
    await studio.locator('.ap-row[data-ctl="wave"] .ap-num').fill('0.5');
    await studio.locator('.ap-row[data-ctl="wave"] .ap-num').press('Enter');
    await studio.locator('.ab-keyhere').click();
    assert.deepEqual(await studio.locator('.ab-key').allTextContents(), ['-1', '0', '0.5', '1'], 'a key added at the slider\'s value');
    await studio.locator('.ab-keyhere').click();
    assert.deepEqual(await studio.locator('.ab-key').allTextContents(), ['-1', '0', '1'], 'and removed again');
    // A pad: a part picked from the tree gets a grid; a corner of it is a key; a click near a corner puts the dot on it.
    await studio.locator('.ap-padrow[data-ctl="pad:head_turn"] > label').click();
    assert.equal(await active.textContent(), 'head_turn');
    assert.equal(await bound.count(), 0, 'no part has a grid on this pad yet');
    await studio.locator('.as-bind[data-bind="eyes"]').click();
    assert.match(await note.textContent(), /^Bound eyes to head_turn: a 3 × 3 grid of corners, all at rest/);
    assert.equal(await studio.locator('.ap-corner').count(), 9);
    assert.equal(await studio.locator('.ap-corner.ap-authored').count(), 0);
    await studio.locator('.ab-size select').selectOption('2');
    await studio.locator('.as-bind[data-bind="mouth"]').click();
    assert.match(await note.textContent(), /^Bound mouth to head_turn: a 2 × 2 grid/, 'the size applies to the next part bound');
    assert.equal(await studio.locator('.ap-corner').count(), 4, 'and the pad shows the corners of the chosen part');
    const pad = await studio.locator('.ap-pad').boundingBox();
    await page.mouse.click(pad.x + pad.width - 3, pad.y + 3);
    assert.match(await studio.locator('.ap-read').textContent(), /head_x 1, head_y 1/, 'the dot snapped onto the corner');
    // What moves a part, from the other side: choose head, its parameters are buttons, one makes that parameter active.
    await studio.locator('.as-tree .as-row[data-part="head"]').click();
    assert.deepEqual(await studio.locator('.ab-aff').allTextContents(), ['head_x', 'head_y']);
    await studio.locator('.ab-aff', { hasText: 'head_y' }).click();
    assert.equal(await active.textContent(), 'head_y');
    assert.equal(await studio.locator('.ap-padrow').evaluate(e => e.classList.contains('ap-active')), true, 'one axis of a pad highlights the pad');
    // Unbind with the ✕: the keys it made go.
    await studio.locator('.ap-row[data-ctl="wave"] > label').click();
    await studio.locator('.ab-unbind').first().click();
    assert.equal(await bound.count(), 0);
    assert.match(await note.textContent(), /^Unbound spine from wave/);
    await undo.click();
    assert.equal(await bound.count(), 1, 'undo binds it again, posed key included');
    // A gizmo drag on a part that is not bound yet binds it first, still one undo step.
    await studio.locator('.as-tree .as-row[data-part="forearm_r"]').click();
    await studio.locator('.ap-row[data-ctl="wave"] .ap-num').fill('1');
    await studio.locator('.ap-row[data-ctl="wave"] .ap-num').press('Enter');
    await dragRing(page, 15);
    assert.match(await note.textContent(), /^Bound forearm_r to wave and wrote forearm_r at wave = 1/);
    assert.equal(await bound.count(), 2);
    await undo.click();
    assert.equal(await bound.count(), 1, 'binding and posing were one step');
    await studio.locator('[data-t="redo"]').click();
    // Apply writes the keyforms.
    await studio.locator('[data-t="apply"]').click();
    for (let i = 0; i < 50 && !saved.length; i++) await page.waitForTimeout(100); // the rig.json tab is saved a moment after Apply
    const rig = JSON.parse(saved.at(-1));
    const spine = rig.keyforms.filter(k => k.target === 'spine' && k.param === 'wave');
    assert.equal(spine.length, 1);
    assert.deepEqual(spine[0].keys.map(k => k.at), [-1, 0, 1]);
    assert.deepEqual(spine[0].keys.map(k => Object.keys(k).length > 1), [false, false, true], 'only the posed key holds a pose');
    assert.ok(rig.keyforms.some(k => k.target === 'forearm_r' && k.param === 'wave'));
    // The Warp section is keyed to the active parameter and has no slider or parameter choice of its own.
    await studio.locator('.ap-row[data-ctl="breathe"] > label').click();
    assert.deepEqual(await bound.allTextContents(), ['torsowarp2 keys · 1 posed']);
    await studio.locator('.as-tree .as-row[data-part="torso"]').click();
    await studio.locator('[data-gz="warp"]').click();
    assert.match(await studio.locator('.aw-active').textContent(), /^Keyed to breathe, the active parameter/);
    assert.equal(await studio.locator('.aw-param').isVisible(), false);
    assert.equal(await studio.locator('.aw-range').isVisible(), false, 'every slider is in the Parameters section');
    // Animate mode has no Bind block and no ticks in the tree, and no Pivot tool.
    await studio.locator('.as-modes [data-mode="animate"]').click();
    assert.equal(await studio.locator('.ab').isVisible(), false);
    assert.equal(await studio.locator('[data-gz="pivot"]').isVisible(), false);
    assert.equal(await studio.locator('.as-bind').count(), 0, 'no ticks in the tree');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: the Warp tool shows the lattice of the chosen part, a point drag is one undo step, a preset writes keys', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo: its torso has a 2x3 warp on `breathe`
    const studio = page.locator('#animStudio');
    await studio.locator('.as-tree .as-row[data-part="torso"]').waitFor();
    const stageFrame = () => page.frames().find(f => f.url().includes('studio='));
    const handles = () => stageFrame().evaluate(() => [...document.querySelectorAll('svg circle[stroke="#000"]')].map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]));
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelector('svg'));
    await studio.locator('.as-tree .as-row[data-part="torso"]').click();
    const breathe = studio.locator('.ap-row[data-ctl="breathe"] .ap-num');
    const setBreathe = async v => { await breathe.fill(String(v)); await breathe.press('Enter'); };
    await studio.locator('.ap-row[data-ctl="breathe"] > label').click(); // the warp is keyed to the active parameter: the author picks it
    assert.equal(await studio.locator('[data-gz="warp"]').isVisible(), true, 'the Warp tool is in the tool row in Model mode');
    assert.equal((await handles()).length, 0, 'no lattice before the Warp tool is chosen');
    await page.keyboard.press('d'); // the tool's key
    assert.equal(await studio.locator('[data-gz="warp"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await studio.locator('.as-sect[data-sect="warp"] .as-sect-head').getAttribute('aria-expanded'), 'true', 'choosing the tool opens its section');
    assert.equal(await studio.locator('.as-sect[data-sect="warp"] .as-sect-sum').textContent(), '2×3');
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 12);
    assert.match(await studio.locator('.aw-active').textContent(), /^Keyed to breathe, the active parameter/);
    assert.equal(await studio.locator('.aw-param').count(), 0, 'the Warp section has no parameter choice or slider of its own');
    assert.equal(await studio.locator('.aw-keys button').count(), 2);
    assert.equal(await studio.locator('.ap-row[data-ctl="breathe"] .ap-tick').count(), 2, 'the slider track has a mark at each key of the warp');
    assert.equal(await studio.locator('.ap-row[data-ctl="lean"] .ap-tick').count(), 0, 'a parameter the warp is not keyed to has none');
    // The slider value selects the keyform: on the key at 1, a drag changes that key, and the point follows the pointer.
    await setBreathe(1);
    assert.match(await studio.locator('.aw-keyhint').textContent(), /On the key at 1/);
    const box = await studio.locator('.as-stage iframe').boundingBox(), before = await handles(), at = before[4];
    await page.mouse.move(box.x + at[0], box.y + at[1]);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + at[0] + i * 6, box.y + at[1] + i * 2);
    await page.mouse.up();
    const after = await handles();
    assert.ok(Math.abs(after[4][0] - at[0] - 30) < 0.6 && Math.abs(after[4][1] - at[1] - 10) < 0.6, `the point followed the pointer (${after[4]} from ${at})`);
    assert.match(await studio.locator('.aw-pthint').textContent(), /^Point 4 \(column 1, row 1\)/);
    assert.ok(Number(await studio.locator('.aw-dx').inputValue()) > 0.05, 'the point displacement shows in its fields');
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), false, 'the drag changed the working copy');
    await studio.locator('[data-t="undo"]').click(); // the whole drag is one step
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true);
    assert.equal(await studio.locator('[data-t="undo"]').isDisabled(), true);
    // The same point by keyboard: its fields, and a point chosen from the list.
    assert.equal(await studio.locator('.aw-pick').inputValue(), '4');
    await studio.locator('.aw-dx').fill('0.02');
    await studio.locator('.aw-dx').dispatchEvent('change');
    await studio.locator('.aw-dx').blur();
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), false);
    await studio.locator('.aw-pick').selectOption('7');
    assert.equal(await studio.locator('.aw-dx').inputValue(), '0', 'point 7 has no move in this keyform');
    await studio.locator('[data-t="undo"]').click();
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true);
    // Between the keys a drag adds a key at the slider's value.
    await setBreathe(0.5);
    assert.match(await studio.locator('.aw-keyhint').textContent(), /No key at 0\.5/);
    const half = (await handles())[4];
    await page.mouse.move(box.x + half[0], box.y + half[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + half[0] + 12, box.y + half[1]);
    await page.mouse.up();
    assert.deepEqual(await studio.locator('.aw-keys button').allTextContents(), ['0', '0.5', '1']);
    await studio.locator('.aw-delkey').click();
    assert.deepEqual(await studio.locator('.aw-keys button').allTextContents(), ['0', '1'], 'Delete key removes the key at the value');
    await studio.locator('[data-t="undo"]').click();
    await studio.locator('[data-t="undo"]').click();
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true);
    // A part with no warp: Add warp gives it the default lattice and turns the tool on; a preset writes keys for a parameter.
    await studio.locator('.as-tree .as-row[data-part="face"]').click();
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 0); // a part without a warp has no lattice
    assert.equal(await studio.locator('.aw-addbtn').textContent(), 'Add warp to face');
    await studio.locator('.aw-addbtn').click();
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 25);
    assert.equal(await studio.locator('.as-sect[data-sect="warp"] .as-sect-sum').textContent(), '4×4');
    await studio.locator('.aw-preset').selectOption('sway');
    await studio.locator('.aw-write').click();
    assert.deepEqual(await studio.locator('.aw-keys button').allTextContents(), ['0', '1'], 'rest at the default, the bend at the far end');
    assert.match(await page.locator('.as-note').textContent(), /Sway written as the keys of breathe/);
    // Moving the slider to a key shows the shape: the lattice moves with it.
    const rest = await handles();
    await studio.locator('.aw-keys button', { hasText: '1' }).last().click();
    let bent = rest;
    for (let i = 0; i < 40 && !(bent[24][0] > rest[24][0] + 1.5); i++) { await page.waitForTimeout(100); bent = await handles(); } // the stage answers a moment after the slider
    assert.ok(bent[24][0] > rest[24][0] + 1.5 && Math.abs(bent[24][1] - rest[24][1]) < 0.5 && Math.abs(bent[0][0] - rest[0][0]) < 0.5, `the bottom row bends sideways, the top row stays (${rest[24]} ${bent[24]} / ${rest[0]} ${bent[0]})`);
    // Animate mode has neither the tool nor the section.
    await studio.locator('.as-modes [data-mode="animate"]').click();
    assert.equal(await studio.locator('[data-gz="warp"]').isVisible(), false);
    assert.equal(await studio.locator('.as-sect[data-sect="warp"]').isVisible(), false);
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 0); // the lattice is gone
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: the Mask tool outlines the chosen part\'s mask, a point drag is one undo step, the picker switches between a part\'s shape and a drawn one', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo: its eyes have a drawn mask (eyelids) on `eye_open`
    const studio = page.locator('#animStudio');
    await studio.locator('.as-tree .as-row[data-part="eyes"]').waitFor();
    const outlines = () => page.frames().find(f => f.url().includes('studio=')).evaluate(() => document.querySelectorAll('svg polygon[stroke-dasharray]').length);
    const handles = () => page.frames().find(f => f.url().includes('studio=')).evaluate(() => [...document.querySelectorAll('svg circle[stroke="#000"]')].map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]));
    const sum = studio.locator('.as-sect[data-sect="mask"] .as-sect-sum');
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelector('svg'));
    assert.equal(await studio.locator('[data-gz="mask"]').isVisible(), true, 'the Mask tool is in the tool row in Model mode');
    assert.equal(await sum.textContent(), '1 mask', 'nothing chosen: how many parts have a mask');
    assert.equal(await outlines(), 0, 'no outline until a part with a mask is chosen');
    await studio.locator('.as-tree .as-row[data-part="eyes"]').click();
    assert.equal(await sum.textContent(), 'polygon, 4 points');
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg polygon[stroke-dasharray]').length === 1);
    assert.equal((await handles()).length, 0, 'the outline shows without the tool; its points are handles only with the Mask tool');
    await page.keyboard.press('m'); // the tool's key
    assert.equal(await studio.locator('[data-gz="mask"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await studio.locator('.as-sect[data-sect="mask"] .as-sect-head').getAttribute('aria-expanded'), 'true', 'choosing the tool opens its section');
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 4);
    // Drag a point: it follows the pointer, and the whole drag is one undo step.
    const box = await studio.locator('.as-stage iframe').boundingBox(), before = await handles(), at = before[0];
    await page.mouse.move(box.x + at[0], box.y + at[1]);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + at[0] + i * 3, box.y + at[1] + i * 2);
    await page.mouse.up();
    const after = await handles();
    assert.ok(Math.abs(after[0][0] - at[0] - 15) < 1 && Math.abs(after[0][1] - at[1] - 10) < 1, `the point followed the pointer (${after[0]} from ${at})`);
    assert.equal(await studio.locator('.am-pick').inputValue(), '0', 'the dragged point is the chosen one');
    assert.notEqual(await studio.locator('.am-x').inputValue(), '214', 'its x shows in the field');
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), false, 'the drag changed the working copy');
    await studio.locator('[data-t="undo"]').click();
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true);
    assert.equal(await studio.locator('.am-x').inputValue(), '214');
    // The same by keyboard: choose a point from the list and type its place; add a point after it, then remove it.
    await studio.locator('.am-pick').selectOption('2');
    assert.equal(await studio.locator('.am-x').inputValue(), '326');
    await studio.locator('.am-x').fill('330');
    await studio.locator('.am-x').dispatchEvent('change');
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), false);
    await studio.locator('.am-add').click();
    assert.equal(await sum.textContent(), 'polygon, 5 points');
    assert.equal(await studio.locator('.am-pick').inputValue(), '3', 'the new point is chosen');
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 5);
    await studio.locator('.am-del').click();
    assert.equal(await sum.textContent(), 'polygon, 4 points');
    for (let i = 0; i < 3; i++) await studio.locator('[data-t="undo"]').click();
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true, 'three edits, three undo steps');
    // The picker: another part's shape (no handles, an outline of its silhouette), then a drawn one again, then none.
    await studio.locator('.am-source').selectOption('from');
    assert.match(await sum.textContent(), /^to \w+/);
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg polygon[stroke-dasharray]').length >= 1);
    assert.equal((await handles()).length, 0, 'a part\'s silhouette has no points to drag');
    assert.equal(await studio.locator('.am-from').isVisible(), true);
    await studio.locator('.am-source').selectOption('polygon');
    assert.equal(await sum.textContent(), 'polygon, 4 points', 'a drawn shape starts as a rectangle inside the part\'s image');
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 4);
    await studio.locator('.am-remove').click();
    assert.equal(await sum.textContent(), 'none');
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg polygon[stroke-dasharray]').length === 0); // no mask, no outline
    await studio.locator('[data-t="undo"]').click();
    await studio.locator('[data-t="undo"]').click();
    await studio.locator('[data-t="undo"]').click();
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true);
    // Animate mode has neither the tool nor the section.
    await studio.locator('.as-modes [data-mode="animate"]').click();
    assert.equal(await studio.locator('[data-gz="mask"]').isVisible(), false);
    assert.equal(await studio.locator('.as-sect[data-sect="mask"]').isVisible(), false);
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg polygon[stroke-dasharray]').length === 0);
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

/** Pixels of a Chromium screenshot (8-bit RGB or RGBA PNG, not interlaced), enough to count the light ones in a region. */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); colorType = body[9]; } else if (type === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), data = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = data.subarray(y * stride, (y + 1) * stride), prev = y ? data.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      cur[i] = (row[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
    }
  }
  return { w, h, bpp, data };
}
/** How many pixels of the region (x, y, w, h) of a decoded screenshot are light (the robo's eye whites). */
function lightPixels(img, x, y, w, h) {
  let n = 0;
  for (let j = Math.max(0, y); j < Math.min(img.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(img.w, x + w); i++) {
    const o = (j * img.w + i) * img.bpp;
    if (img.data[o] > 190 && img.data[o + 1] > 205 && img.data[o + 2] > 215) n++;
  }
  return n;
}

const ROBO_FROM_VN = [
  'label robo_from_test:',
  '  behaviors off',
  '  scene bg_park_evening',
  '  show robo at center',
  '  "Robo rests." #rf01',
  '  show robo eyes=none',
  '  "Robo has no eyes." #rf02',
].join('\n');

const ROBO_VN = [
  'label robo_mask_test:',
  '  behaviors off',
  '  scene bg_park_evening',
  '  show robo at center',
  '  "Robo rests." #rb01',
  '  show robo pose=squint',
  '  "Robo squints." #rb02',
].join('\n');

/** The head of the sample robo as a screenshot, with `patch` laid over its rig.json (the sample on disk is not touched), at each of `lines` of ROBO_FROM_VN. */
async function roboHeads(patch, lines, script = ROBO_FROM_VN, file = 'robofrom.vn') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts = [...proj.scripts, { file, text: script }];
    proj.rigs.robo.rig = { ...proj.rigs.robo.rig, ...patch };
    await route.fulfill({ response: res, json: proj });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base);
    await page.getByRole('button', { name: 'New game' }).waitFor();
    await page.evaluate(f => window.postMessage({ type: 'goto', file: f, line: 1 }, location.origin), file);
    const shots = [];
    for (let i = 0; i < lines.length; i++) {
      if (i) await page.keyboard.press('Space');
      await lineUp(page, lines[i]);
      await until(page, () => window.vnStage().some(a => a.char === 'robo'));
      await page.waitForTimeout(500);
      const snap = (await stageNow(page)).find(a => a.char === 'robo');
      shots.push({ snap, img: decodePng(await page.screenshot()), canvas: await page.locator('canvas#canvas').boundingBox() });
    }
    assert.deepEqual(errors, [], 'the page threw errors');
    return shots;
  } finally {
    await context.close();
  }
}
/** The share of the pixels of region (x, y, w, h) that differ clearly between two screenshots of the same size. */
function differing(a, b, x, y, w, h) {
  let n = 0, total = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const p = (j * a.w + i) * a.bpp, q = (j * b.w + i) * b.bpp;
    total++;
    if (Math.abs(a.data[p] - b.data[q]) + Math.abs(a.data[p + 1] - b.data[q + 1]) + Math.abs(a.data[p + 2] - b.data[q + 2]) > 60) n++;
  }
  return n / total;
}

test('masks: the eyelid mask of the sample robo clips its eyes to a band as its parameter closes, and changes nothing at rest', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const lines = [/Robo rests/, /Robo squints/];
  const masked = await roboHeads({}, lines, ROBO_VN, 'robomask.vn');
  const control = await roboHeads({ masks: [] }, lines, ROBO_VN, 'robomask.vn'); // the same rig without its mask
  const [{ snap, canvas }] = masked, k = canvas.width / 1920, [bx, by, bw, bh] = snap.bounds;
  const light = shot => lightPixels(shot.img, Math.round(canvas.x + bx * k), Math.round(canvas.y + by * k), Math.round(bw * k), Math.round(bh * k * 0.35)); // the head is the top of the figure
  assert.deepEqual([masked[0].snap.masks, masked[1].snap.masks, control[0].snap.masks], [1, 1, 0], 'one stencil mask on stage, none in the control');
  const [rest, squint, plainRest, plainSquint] = [light(masked[0]), light(masked[1]), light(control[0]), light(control[1])];
  assert.ok(plainRest > 200, `the eye whites show (${plainRest} light pixels)`);
  assert.ok(Math.abs(plainSquint - plainRest) < plainRest * 0.1, 'the squint pose alone does not change the eyes');
  assert.ok(Math.abs(rest - plainRest) < plainRest * 0.1, `at rest the clip leaves the eyes as they are (${rest} against ${plainRest})`);
  assert.ok(squint > 0 && squint < plainSquint * 0.7, `the squint closes the clip to a band of the eyes (${squint} against ${plainSquint} light pixels)`);
});

test('masks: a part clipped to another part\'s shape is drawn only where that part has pixels, and goes when a look hides that part', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  // The face is put above the eyes, so without a mask it covers them; clipped to the eyes' shape only two windows of it are left.
  const order = ['legs', 'torso', 'collar', 'hand_r', 'lower_r', 'upper_r', 'hand_l', 'lower_l', 'upper_l', 'eyes', 'antenna', 'mouth', 'face'];
  const plain = await roboHeads({ order, masks: [] }, [/Robo rests/, /no eyes/]);
  const clipped = await roboHeads({ order, masks: [{ id: 'windows', part: 'face', from: 'eyes' }] }, [/Robo rests/, /no eyes/]);
  const [{ snap, canvas }] = plain, k = canvas.width / 1920, [bx, by, bw, bh] = snap.bounds;
  const head = [Math.round(canvas.x + bx * k), Math.round(canvas.y + by * k), Math.round(bw * k), Math.round(bh * k * 0.35)];
  assert.equal(plain[0].snap.masks, 0);
  assert.equal(clipped[0].snap.masks, 1, 'one stencil mask on stage');
  const gone = differing(plain[0].img, clipped[0].img, ...head);
  assert.ok(gone > 0.1, `the clipped face leaves most of the head empty (${Math.round(gone * 100)}% of the head differs)`);
  // The look hides the eyes: nothing is left to clip the face to, so the face goes and no stencil is drawn.
  assert.equal(clipped[1].snap.masks, 0);
  const windows = differing(clipped[0].img, clipped[1].img, ...head);
  assert.ok(windows > 0.005, `the two windows of the face are gone (${Math.round(windows * 1000) / 10}% of the head differs)`);
  const unclipped = differing(plain[1].img, clipped[1].img, ...head);
  assert.ok(unclipped > 0.1, `without the eyes the clipped face is not drawn at all (${Math.round(unclipped * 100)}% differs from the unclipped one)`);
});

test('animation studio: fills a 1280x720 window, every section opens by keyboard and is remembered, focus starts inside', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    const studio = page.locator('#animStudio');
    await studio.locator('.as-sect-head').first().waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.closest('#animStudio') !== null), true, 'focus starts inside the studio');
    const fits = () => studio.locator('.as-card').evaluate(c => c.scrollHeight <= c.clientHeight + 1);
    assert.equal(await fits(), true, 'the studio does not need to scroll at 1280x720');
    // Each section's header is a button: Enter opens it, Enter closes it. What opens is the section's own control.
    const controls = { sel: '.as-key', params: '.ap-body', poses: '.ap-pose-save', frames: '.af-fill', place: '.as-place-btn' };
    for (const [id, control] of Object.entries(controls)) {
      const head = studio.locator(`.as-sect[data-sect="${id}"] .as-sect-head`);
      await head.focus();
      if ((await head.getAttribute('aria-expanded')) === 'true') await page.keyboard.press('Enter'); // closed first, to see it open
      assert.equal(await head.getAttribute('aria-expanded'), 'false', `${id} closed`);
      assert.equal(await studio.locator(control).isVisible(), false, `${id} hides ${control} when closed`);
      await page.keyboard.press('Enter');
      assert.equal(await head.getAttribute('aria-expanded'), 'true', `${id} opened`);
      assert.equal(await studio.locator(control).isVisible(), true, `${id} shows ${control}`);
    }
    assert.equal(await fits(), true, 'still no page scroll with every section open (the columns scroll themselves)');
    // What was opened and closed is kept for the next opening (and the next page load).
    await page.keyboard.press('Escape');
    assert.equal(await studio.isHidden(), true, 'Esc closes the studio from a section header');
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('vn.editor.studioLayout')));
    assert.deepEqual(kept.open.animate, { sel: true, params: true, poses: true, frames: true, place: true });
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    assert.equal(await studio.locator('.as-sect[data-sect="frames"] .as-sect-head').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: the animation picker is one line, the Parts tree dresses the stage, and picking a part without a pivot shows no ring', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    const studio = page.locator('#animStudio');
    await studio.locator('.as-tree .as-row').first().waitFor();
    // The picker is a select with the character's animations and the presets in their own group.
    assert.ok(await studio.locator('.as-anim optgroup[label="Of this character"] option').count() > 0);
    assert.ok(await studio.locator('.as-anim optgroup[label="Presets"] option').count() > 0);
    assert.ok(await studio.locator('.as-picker').evaluate(e => e.getBoundingClientRect().height) < 90, 'the picker takes a line or two, not a list');
    const kinds = await studio.locator('.as-tree .as-badge').allTextContents();
    assert.ok(['slot', 'layer', 'bone'].every(k => kinds.includes(k)), `the tree names slots, layers and bones, saw ${kinds}`);
    assert.ok(await studio.locator('.as-tree img').count() > 0, 'parts and variants have thumbnails');
    const hidden = () => studio.locator('.as-tree .as-row.as-hidden').count();
    assert.equal(await hidden(), 0, 'nothing is hidden by default');
    await studio.locator('.as-tree .as-row:has(.as-badge-slot)').first().click();
    const none = studio.locator('.as-detail [data-variant="none"]');
    await none.click();
    assert.ok(await hidden() > 0, 'a slot set to none is marked hidden in the tree');
    assert.equal(await none.getAttribute('aria-pressed'), 'true');
    await none.click(); // again: back to what the look picks
    assert.equal(await hidden(), 0);
    await studio.locator('.as-anim').selectOption('head_tilt');
    assert.notEqual(await studio.locator('.as-tree .as-row[aria-pressed="true"]').getAttribute('data-part'), '', 'an animation that only keys parts opens at one of them');
    await studio.locator('.as-tree .as-row[data-part="face"]').click();
    assert.equal(await studio.locator('.as-tree .as-row[data-part="face"]').getAttribute('aria-pressed'), 'true', 'the tree marks the chosen part');
    assert.equal(await studio.locator('.as-sect[data-sect="sel"] .as-sect-sum').textContent(), 'face', 'and the Selection section says so');
    // face sits on the head bone and has no pivot of its own: with the Pivot tool on, choosing it starts picking, and shows no ring (it used
    // to show one for the pivot the head parts shared).
    await studio.locator('.as-modes [data-mode="model"]').click();
    await studio.locator('[data-gz="pivot"]').click(); // Model opens on Move; the Pivot tool starts picking
    await studio.locator('.as-tree .as-row[data-part="face"]').click();
    const stage = page.frameLocator('#animStudio iframe');
    const visible = () => stage.locator('div[title]').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.title));
    await page.waitForTimeout(500);
    assert.deepEqual(await visible(), [], 'a part without a pivot of its own has no ring to compare');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: Export renders a PNG sequence with alpha into a zip, the same bytes on every run, and Cancel saves nothing', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const { readZip, crc32 } = await import('../../dist/engine/src/index.js');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let downloads = 0;
  page.on('download', () => { downloads++; });
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    const studio = page.locator('#animStudio');
    await studio.locator('.as-timeline').waitFor();
    await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelector('canvas'));
    const open = () => studio.locator('[data-t="export"]').click();
    const dialog = studio.locator('.as-export');
    // Export belongs to Animate mode, and Esc closes only the dialog, not the studio under it.
    await studio.locator('.as-modes [data-mode="model"]').click();
    assert.equal(await studio.locator('[data-t="export"]').isVisible(), false, 'no Export in Model mode');
    await studio.locator('.as-modes [data-mode="animate"]').click();
    await studio.locator('.as-anim').selectOption('breathe');
    await open();
    await dialog.waitFor();
    assert.match(await dialog.locator('.ax-summary').textContent(), /frames, .* s at 30 fps; 1280 x 720 px PNG with alpha/);
    await dialog.locator('.ax-fps').fill('1000');
    assert.equal(await dialog.locator('.ax-go').isEnabled(), true, 'a frame rate out of range is put in range, not refused');
    await dialog.locator('.ax-w').fill('9000');
    assert.equal(await dialog.locator('.ax-go').isEnabled(), false, 'a size that cannot be drawn is');
    assert.match(await dialog.locator('.ax-summary').textContent(), /whole pixels from 16 to 4096/);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await studio.isVisible(), true, 'Esc in the dialog leaves the studio open');

    // A zip of 15 frames at 4 fps: 3.5 s is 14 steps and the last pose.
    const run = async (name, over = {}) => {
      await open();
      await dialog.waitFor();
      await dialog.locator('.ax-fps').fill(String(over.fps ?? 4));
      await dialog.locator(over.loop ? '.ax-loop' : '.ax-once').check();
      await dialog.locator('.ax-leadin').fill(String(over.leadIn ?? 0));
      await dialog.locator('.ax-w').fill(String(over.w ?? 320));
      await dialog.locator('.ax-h').fill(String(over.h ?? 180));
      await dialog.locator('.ax-framing').selectOption(over.framing ?? 'stage');
      await dialog.locator('.ax-zip').check();
      await dialog.locator('.ax-name').fill(name);
      const got = page.waitForEvent('download');
      await dialog.locator('.ax-go').click();
      const file = await (await got).path();
      await dialog.waitFor({ state: 'hidden' });
      return readZip(new Uint8Array(readFileSync(file)), async () => { throw new Error('PNG frames are stored'); });
    };
    const first = await run('bot');
    assert.equal(first.length, 15);
    assert.equal(first[0].path, 'bot_0001.png');
    assert.equal(first.at(-1).path, 'bot_0015.png');
    assert.match(await studio.locator('.as-note').textContent(), /bot\.zip \(15 frames/);
    // Decode frames here: 320 x 180, transparent around the character, solid in it, and the frames differ over time.
    const look = bytes => {
      const img = decodePng(Buffer.from(bytes));
      let clear = 0, solid = 0, sum = 0;
      for (let i = 0; i < img.data.length; i += 4) { const al = img.data[i + 3]; if (al === 0) clear++; else if (al === 255) solid++; sum = (sum * 31 + img.data[i] + img.data[i + 1] * 7 + img.data[i + 2] * 13 + al * 17) >>> 0; }
      return { bpp: img.bpp, w: img.w, h: img.h, clear, solid, sum, corner: [...img.data.subarray(0, 4)] };
    };
    const [a, b] = [look(first[0].bytes), look(first[7].bytes)];
    assert.equal(a.bpp, 4, 'the frames carry an alpha channel');
    assert.deepEqual([a.w, a.h], [320, 180]);
    assert.deepEqual(a.corner, [0, 0, 0, 0], 'the background is transparent');
    assert.ok(a.clear > 20000 && a.solid > 500, `transparent around, solid in the character (${a.clear} clear, ${a.solid} solid)`);
    assert.notEqual(a.sum, b.sum, 'the frames differ across time');
    // The same export again gives the same bytes: nothing in it depends on a clock.
    const second = await run('bot');
    assert.deepEqual(second.map(e => crc32(e.bytes)), first.map(e => crc32(e.bytes)), 'two runs give identical frames');
    // In a square image the whole stage leaves the character small; fitted to the character it fills the image, at the size asked for.
    const whole = look((await run('bot', { w: 180, h: 180 }))[0].bytes), fitted = look((await run('bot', { framing: 'character', w: 180, h: 180 }))[0].bytes);
    assert.deepEqual([whole.w, whole.h, fitted.w, fitted.h], [180, 180, 180, 180]);
    assert.ok(fitted.solid > whole.solid * 3, `the fitted character is larger (${fitted.solid} against ${whole.solid} solid pixels)`);

    // Mina's hair is a physics chain driven by the head, so the dialog offers a lead-in. From rest the hair has not moved at frame 1 of a loop;
    // after a lead-in the animation is already under way, so the first frame differs, and each of the two is the same every run.
    await studio.locator('.as-anim').selectOption('head_tilt');
    await open();
    assert.equal(await dialog.locator('.ax-lead').isVisible(), true, 'a rig with physics offers a lead-in');
    await page.keyboard.press('Escape');
    const frame1 = async leadIn => (await run('hair', { loop: true, fps: 10, leadIn }))[0].bytes;
    const cold = await frame1(0), warm = await frame1(3);
    assert.notEqual(crc32(cold), crc32(warm), 'a lead-in changes the first frame of a loop');
    assert.equal(crc32(await frame1(3)), crc32(warm), 'and gives the same one every run');
    assert.equal(crc32(await frame1(0)), crc32(cold));

    // Cancel stops the run and a zip saves nothing.
    const before = downloads;
    await open();
    await dialog.waitFor();
    await dialog.locator('.ax-fps').fill('30');
    await dialog.locator('.ax-zip').check();
    await dialog.locator('.ax-go').click();
    await until(page, () => /Frame \d+ of/.test(document.querySelector('.ax-count')?.textContent ?? ''));
    await dialog.locator('.ax-cancel').click();
    await dialog.waitFor({ state: 'hidden' });
    assert.match(await studio.locator('.as-note').textContent(), /Cancelled: nothing was saved/);
    await page.waitForTimeout(300);
    assert.equal(downloads, before, 'a cancelled zip is not downloaded');
    // The stage is still working afterwards.
    await studio.locator('.as-slider').fill('500');
    assert.match(await studio.locator('.as-time').textContent(), /^0\.50 \/ 1\.00 s$/, 'head_tilt, halfway');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

// ---- the standalone studio (editor/studio.html): a character folder and no game project ----
// The folder picker is stubbed with a folder in the page's own file system (OPFS), so what the page reads and writes is a real
// FileSystemDirectoryHandle. Nothing in the studio may need the dev server's /api routes: the tests count them.
const folderFiles = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? folderFiles(path.join(dir, e.name), `${prefix}${e.name}/`) : [{ rel: prefix + e.name, bytes: [...readFileSync(path.join(dir, e.name))] }]);
const seedFolder = (page, name, files) => page.evaluate(async ({ name, files }) => {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(name, { recursive: true }).catch(() => {});
  const dir = await root.getDirectoryHandle(name, { create: true });
  for (const f of files) {
    const parts = f.rel.split('/');
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await w.write(new Uint8Array(f.bytes));
    await w.close();
  }
  window.showDirectoryPicker = async () => dir;
}, { name, files });
const folderText = (page, name, rel) => page.evaluate(async ({ name, rel }) => {
  let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
  const parts = rel.split('/');
  try {
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    return await (await (await d.getFileHandle(parts.at(-1))).getFile()).text();
  } catch { return null; }
}, { name, rel });
/** A page on studio.html with `files` as the folder the picker will return; `api` collects the requests a game project would have answered. */
async function standalonePage(files, name = 'robo') {
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await context.newPage();
  const errors = [], api = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/') || p === '/__events') api.push(p); });
  await page.goto(`${base}editor/studio.html`);
  await seedFolder(page, name, files);
  return { context, page, errors, api, studio: page.locator('#animStudio') };
}
/** The folder's text file once `ok` accepts it (the page writes asynchronously after Save). */
async function savedText(page, name, rel, ok = () => true) {
  for (let i = 0; i < 60; i++) { const text = await folderText(page, name, rel); if (text !== null && ok(text)) return text; await page.waitForTimeout(100); }
  throw new Error(`${rel} never reached the expected text`);
}
const openFolderButton = page => page.getByRole('button', { name: 'Open character folder...' });
const stageUp = page => until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelector('canvas'));
const newAnimation = async (page, studio, name) => {
  await studio.locator('.as-more').click();
  await page.locator('.ctxmenu button', { hasText: 'New animation' }).click();
  await studio.locator('.as-name input').fill(name);
  await studio.locator('.as-name button[type="submit"]').click();
};

test('standalone studio: opens a character folder with no game, edits it and Save writes rig.json into the folder, leaving the rest of the file alone', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const robo = folderFiles(path.join(sampleCopy, 'assets', 'char', 'robo'));
  const { context, page, errors, api, studio } = await standalonePage(robo);
  try {
    assert.equal(await openFolderButton(page).isEnabled(), true);
    await openFolderButton(page).click();
    await studio.locator('.as-timeline').waitFor();
    await stageUp(page);
    assert.equal(await page.title(), 'robo · Marginalia Studio');
    // The studio is the page: no Close, no script links; Save and Open take their place.
    assert.deepEqual(await studio.locator('header button:visible').allInnerTexts(), ['Model', 'Animate', 'Open...', 'Export...', 'Undo', 'Redo', 'Save']);
    assert.equal(await studio.locator('.as-sect[data-sect="place"]').count() === 0 || await studio.locator('.as-sect[data-sect="place"]').isHidden(), true, 'no Place in scene section');
    assert.equal(await studio.locator('[data-t="scene"]').isHidden(), true, 'no Try in scene');
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true, 'nothing to save yet');
    assert.match(await studio.locator('.as-note').evaluate(e => e.dataset.hint), /Ctrl\+S save/);
    // The stage drew the character from the folder's files (blob URLs): robo has a body on stage and its parts in the tree.
    const frame = page.frameLocator('#animStudio iframe');
    await until(page, () => document.querySelector('#animStudio iframe')?.contentWindow?.vnStage?.().some(a => a.char === 'robo' && a.bounds[2] > 20));
    assert.ok(await studio.locator('.as-tree .as-row').count() >= 12, 'the parts tree lists the character');
    assert.ok(await studio.locator('.as-tree img').first().getAttribute('src').then(s => s.startsWith('blob:')), 'thumbnails come from the folder');
    await frame.locator('#stage').waitFor();

    // An edit makes Save available; Save writes only what the studio edits, in the file's own layout.
    const before = await folderText(page, 'robo', 'rig.json');
    await newAnimation(page, studio, 'qa_wave');
    assert.equal(await studio.locator('[data-t="apply"]').isEnabled(), true);
    await studio.locator('[data-t="apply"]').click();
    await until(page, () => /Saved rig\.json/.test(document.querySelector('#animStudio .as-note').textContent));
    const after = JSON.parse(await folderText(page, 'robo', 'rig.json'));
    assert.ok(after.animations.qa_wave, 'the new animation is in rig.json');
    const was = JSON.parse(before);
    for (const key of Object.keys(was)) if (key !== 'animations') assert.deepEqual(after[key], was[key], `${key} is untouched`);
    assert.deepEqual(Object.keys(after.animations).filter(k => k !== 'qa_wave'), Object.keys(was.animations ?? {}), 'the other animations stay');
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true, 'saved: nothing pending');

    // Ctrl+S saves too, and the export dialog opens (the movie export needs no game either).
    await studio.locator('.as-more').click();
    await page.locator('.ctxmenu button', { hasText: 'Rename' }).click();
    await studio.locator('.as-name input').fill('qa_wave2');
    await studio.locator('.as-name button[type="submit"]').click();
    await page.locator('body').click({ position: { x: 3, y: 3 } }); // focus nowhere in particular: Ctrl+S still saves, and the browser's Save Page stays away
    await page.keyboard.press('Control+s');
    assert.ok(JSON.parse(await savedText(page, 'robo', 'rig.json', text => text.includes('qa_wave2'))).animations.qa_wave2, 'Ctrl+S wrote the rename');
    await studio.locator('[data-t="export"]').click();
    assert.match(await studio.locator('.ax-summary').textContent(), /frames, .* at 30 fps/);
    await page.keyboard.press('Escape');

    // Unsaved edits are not dropped by Open...: it warns, and a second press leaves for the start screen.
    await newAnimation(page, studio, 'qa_unsaved');
    await studio.locator('[data-t="open"]').click();
    assert.match(await studio.locator('.as-note').textContent(), /not saved/);
    assert.equal(await studio.isVisible(), true);
    await studio.locator('[data-t="open"]').click();
    await studio.waitFor({ state: 'hidden' });
    assert.equal(await openFolderButton(page).isVisible(), true);
    assert.equal(JSON.parse(await folderText(page, 'robo', 'rig.json')).animations.qa_unsaved, undefined, 'the discarded edit never reached the file');

    // Opening the folder again shows what was saved, from a fresh studio (nothing of the discarded edit is left).
    await openFolderButton(page).click();
    await studio.locator('.as-timeline').waitFor();
    await stageUp(page);
    const animations = await studio.locator('.as-anim option').allTextContents();
    assert.ok(animations.includes('qa_wave2') && !animations.includes('qa_unsaved'), `reopened with the saved animations (${animations})`);
    assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true);

    assert.deepEqual(api, [], 'the standalone studio asked the dev server for no project route');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('standalone studio: a flat character (one image per pose, no rig.json) opens from its images and Save creates its rig.json', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const { context, page, errors, api, studio } = await standalonePage(folderFiles(path.join(sampleCopy, 'assets', 'char', 'alice')), 'alice');
  try {
    await openFolderButton(page).click();
    await studio.locator('.as-timeline').waitFor();
    await stageUp(page);
    // No default.png: the stage draws the first pose it finds, so the character is on stage.
    await until(page, () => document.querySelector('#animStudio iframe')?.contentWindow?.vnStage?.().some(a => a.char === 'alice' && a.bounds[2] > 20 && a.bounds[3] > 20));
    assert.equal(await studio.locator('.as-tree .as-row').count(), 0, 'a flat character has no parts');
    assert.equal(await folderText(page, 'alice', 'rig.json'), null, 'no rig.json yet');
    // A preset animation plays on it; a new animation of its own is saved into a new rig.json.
    await newAnimation(page, studio, 'nod');
    await studio.locator('[data-t="apply"]').click();
    await until(page, () => /Saved rig\.json/.test(document.querySelector('#animStudio .as-note').textContent));
    const rig = JSON.parse(await folderText(page, 'alice', 'rig.json'));
    assert.deepEqual(Object.keys(rig.animations), ['nod']);
    assert.deepEqual(rig.order, [], 'the generated skeleton: no parts to order');
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('standalone studio: a folder with several characters (a game project) offers each one, and a browser without folders says so', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const project = [...folderFiles(path.join(sampleCopy, 'assets', 'char')).map(f => ({ ...f, rel: `assets/char/${f.rel}` })), { rel: 'game.json', bytes: [123, 125] }];
  const { context, page, errors, api, studio } = await standalonePage(project, 'sample');
  try {
    await openFolderButton(page).click();
    const choose = page.locator('#choose');
    await choose.waitFor();
    assert.deepEqual(await choose.locator('button').allInnerTexts(), ['alice', 'mina', 'robo']);
    assert.equal(await studio.isHidden(), true, 'nothing opens until one is chosen');
    await choose.locator('button', { hasText: 'mina' }).click();
    await studio.locator('.as-timeline').waitFor();
    await stageUp(page);
    assert.equal(await page.title(), 'mina · Marginalia Studio');
    // Save into assets/char/mina/rig.json of the project folder.
    await newAnimation(page, studio, 'qa_sway');
    await page.keyboard.press('Control+s');
    assert.ok(JSON.parse(await savedText(page, 'sample', 'assets/char/mina/rig.json', text => text.includes('qa_sway'))).animations.qa_sway);
    assert.equal(await folderText(page, 'sample', 'assets/char/robo/rig.json'), Buffer.from(folderFiles(path.join(sampleCopy, 'assets', 'char', 'robo')).find(f => f.rel === 'rig.json').bytes).toString('utf8'), 'the other characters are not touched');
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
  const bare = await browser.newContext();
  try {
    await bare.addInitScript(() => { delete window.showDirectoryPicker; });
    const p = await bare.newPage();
    await p.goto(`${base}editor/studio.html`);
    assert.equal(await openFolderButton(p).isDisabled(), true);
    assert.match(await p.locator('#status').innerText(), /cannot open folders/);
  } finally {
    await bare.close();
  }
});

// ---- custom screens (games/sample/script/screens.vn): clicks, keys and a pad pick elements; the answer drives the story ----
const screensVn = readFileSync(path.join(root, 'games/sample/script/screens.vn'), 'utf8').split('\n');
const screensLine = needle => screensVn.findIndex(l => l.includes(needle)) + 1;
const gotoScreens = (page, needle) => page.evaluate(m => window.postMessage({ type: 'goto', file: 'screens.vn', line: m }, location.origin), screensLine(needle));
const screenUp = page => until(page, () => document.getElementById('screenui').dataset.visible === 'true');
const screenGone = page => until(page, () => document.getElementById('screenui').dataset.visible !== 'true');
const screenIds = page => page.evaluate(() => [...document.querySelectorAll('#screenui [data-id]')].map(e => e.dataset.id));
const activeId = page => page.evaluate(() => document.querySelector('#screenui [data-active="true"]')?.dataset.id ?? null);

play('screens: clicking a hotspot answers the screen and the story branches on it', async page => {
  await gotoScreens(page, 'show screen town_map');
  await screenUp(page);
  assert.deepEqual(await screenIds(page), ['cafe', 'lake', 'closed', 'bag', 'leave']); // the station waits for visited > 0
  assert.equal(await page.locator('#screenui .sc-text').innerText(), 'Where to? You carry: Brass key, Silver coin');
  assert.equal(await page.locator('#screenui [data-id="closed"]').getAttribute('aria-disabled'), 'true');
  await page.locator('#screenui [data-id="closed"]').click({ force: true }); // disabled: nothing happens
  assert.equal(await page.locator('#screenui').getAttribute('data-visible'), 'true');
  await page.locator('#screenui [data-id="cafe"]').hover();
  assert.equal(await activeId(page), 'cafe');
  assert.equal(await page.locator('#screenui .sc-tip').innerText(), 'The cafe');
  await page.locator('#screenui [data-id="cafe"]').click();
  await screenGone(page);
  await until(page, () => /cafe smells of coffee/.test(document.getElementById('text').textContent));
  await textDone(page);
  await page.keyboard.press('Space'); // the loop shows the map again, now with the station and the map in the bag
  await screenUp(page);
  assert.ok((await screenIds(page)).includes('station'));
  assert.equal(await page.locator('#screenui .sc-text').innerText(), 'Where to? You carry: Brass key, Silver coin, Folded map');
});

play('screens: hover none draws no highlight and tooltip off shows no tooltip', async page => {
  await gotoScreens(page, 'show screen town_map');
  await screenUp(page);
  const look = id => page.locator(`#screenui [data-id="${id}"]`).evaluate(e => { const c = getComputedStyle(e); return [c.backgroundColor, c.borderTopColor]; });
  await page.locator('#screenui [data-id="cafe"]').hover();
  assert.notDeepEqual(await look('cafe'), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']); // the stock highlight
  await page.locator('#screenui [data-id="lake"]').hover();
  assert.equal(await activeId(page), 'lake'); // still active (focus, clicks)
  assert.deepEqual(await look('lake'), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
  assert.equal(await page.locator('#screenui .sc-tip').getAttribute('data-show'), 'false');
});

play('screens: hover tint fills the active element and hover scale grows it', async page => {
  await gotoScreens(page, 'show screen town_map');
  await screenUp(page);
  const css = (id, prop) => page.locator(`#screenui [data-id="${id}"]`).evaluate((e, prop) => getComputedStyle(e)[prop], prop);
  await page.locator('#screenui [data-id="leave"]').hover();
  assert.equal(await css('leave', 'backgroundColor'), 'rgba(255, 200, 100, 0.35)');
  await page.locator('#screenui [data-id="bag"]').hover();
  await until(page, () => getComputedStyle(document.querySelector('#screenui [data-id="bag"]')).transform.startsWith('matrix(1.1,')); // after its .12s transition
  await page.locator('#screenui [data-id="cafe"]').hover();
  await until(page, () => getComputedStyle(document.querySelector('#screenui [data-id="bag"]')).transform === 'none');
});

play('screens: theme hotFill, hotBorder and tipColor style the highlight and the tooltip', async page => {
  await gotoScreens(page, 'show screen town_map');
  await screenUp(page);
  await page.locator('#screenui [data-id="cafe"]').hover();
  const look = await page.locator('#screenui [data-id="cafe"]').evaluate(e => { const c = getComputedStyle(e); return [c.backgroundColor, c.borderTopColor, c.borderTopWidth]; });
  assert.deepEqual(look, ['rgb(255, 0, 0)', 'rgb(0, 0, 255)', '6px']);
  assert.equal(await page.locator('#screenui .sc-tip').evaluate(e => getComputedStyle(e).color), 'rgb(0, 128, 0)');
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.game = { ...proj.game, theme: { ...proj.game?.theme, hotFill: '#f00', hotBorder: '#00f', hotBorderWidth: 6, tipColor: '#008000' } };
    await route.fulfill({ response: res, json: proj });
  });
});

// Two characters on stage with speaker focus: a script and game.json settings injected into the project the page fetches.
const STAGE_VN = [
  'label stage_test:',
  '  scene bg_park_evening',
  '  show alice neutral at 0.4',
  '  show mina at 0.6 behind=alice',
  '  alice: Alice speaks. #st01',
  '  mina: Mina speaks. #st02',
  '  "Nobody speaks." #st03',
  '  show mina order=front',
  '  "Mina stepped forward." #st04',
].join('\n');
const withStageScene = async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts = [...proj.scripts, { file: 'stage.vn', text: STAGE_VN }];
    proj.game = { ...proj.game, speakerFocus: { dim: 0.4, fade: 0, front: true } };
    await route.fulfill({ response: res, json: proj });
  });
};
const stageNow = page => page.evaluate(() => window.vnStage());
const order = shot => shot.map(a => a.char);
const lit = shot => Object.fromEntries(shot.map(a => [a.char, Math.round(a.lit * 100) / 100]));
const lineUp = async (page, re) => { await until(page, re => new RegExp(re).test(document.getElementById('text').textContent), re.source); await textDone(page); };

play('several characters: behind= and order= set the draw order, speaker focus dims the others and raises the speaker', async page => {
  await page.evaluate(() => window.postMessage({ type: 'goto', file: 'stage.vn', line: 1 }, location.origin));
  await lineUp(page, /Alice speaks/);
  let shot = await stageNow(page);
  assert.deepEqual(order(shot), ['mina', 'alice'], 'behind=alice draws mina first');
  assert.deepEqual(lit(shot), { mina: 0.6, alice: 1 });
  const middle = a => a.bounds[0] + a.bounds[2] / 2;
  const [mina, alice] = shot;
  assert.ok(Math.abs(middle(alice) - 0.4 * 1920) < 40 && Math.abs(middle(mina) - 0.6 * 1920) < 40, `drawn where "at" says: ${JSON.stringify(shot)}`);

  await page.keyboard.press('Space');
  await lineUp(page, /Mina speaks/);
  shot = await stageNow(page);
  assert.deepEqual(order(shot), ['alice', 'mina'], 'front: the speaker is raised for the line');
  assert.deepEqual(lit(shot), { alice: 0.6, mina: 1 });

  await page.keyboard.press('Space');
  await lineUp(page, /Nobody speaks/);
  shot = await stageNow(page);
  assert.deepEqual(order(shot), ['mina', 'alice'], 'narration: the scripted order comes back');
  assert.deepEqual(lit(shot), { mina: 1, alice: 1 }, 'offstage "lit": everyone is lit for narration');

  await page.keyboard.press('Space');
  await lineUp(page, /Mina stepped forward/);
  assert.deepEqual(order(await stageNow(page)), ['alice', 'mina'], 'order=front');
}, withStageScene);

play('screens: row, column and grid place their buttons at the computed stage positions', async page => {
  await gotoScreens(page, 'show screen layout_demo');
  await screenUp(page);
  const spots = await page.evaluate(() => {
    const root = document.getElementById('screenui').getBoundingClientRect(), k = root.width / 1920;
    return Object.fromEntries([...document.querySelectorAll('#screenui [data-id]')].map(e => {
      const r = e.getBoundingClientRect();
      return [e.dataset.id, [r.left - root.left, r.top - root.top, r.width, r.height].map(v => Math.round(v / k))];
    }));
  });
  const at = id => spots[id].slice(0, 2);
  assert.deepEqual([at('play'), at('options'), at('quit')], [[80, 160], [80, 264], [80, 368]]);
  assert.deepEqual([at('g1'), at('g2'), at('g3'), at('g4')], [[700, 160], [1020, 160], [1340, 160], [700, 280]]);
  assert.deepEqual([at('yes'), at('no')], [[1460, 956], [1680, 956]]);
  assert.deepEqual(spots.play.slice(2), [200, 84]); // the drawn size is the size layouts assume
  await page.locator('#screenui [data-id="g3"]').click();
  await screenGone(page);
  await until(page, () => /You chose g3/.test(document.getElementById('text').textContent));
});

play('screens: a polygon hotspot is hit only inside its outline', async page => {
  await gotoScreens(page, 'show screen town_map');
  await screenUp(page);
  await page.locator('#screenui [data-id="cafe"]').click();
  // Wait for the cafe line itself: the box's done flag can still be set from before, and an early Space only finishes the typing.
  await lineUp(page, /cafe smells of coffee/);
  await page.keyboard.press('Space');
  await page.locator('#screenui [data-id="station"]').waitFor({ state: 'attached' }); // drawn once visited > 0
  await screenUp(page);
  // stage point -> what the browser finds there (the stage is scaled to the window)
  const at = (x, y) => page.evaluate(([x, y]) => {
    const r = document.getElementById('screenui').getBoundingClientRect();
    const e = document.elementFromPoint(r.left + (x / 1920) * r.width, r.top + (y / 1080) * r.height);
    return e?.dataset?.id ?? null;
  }, [x, y]);
  assert.equal(await at(1490, 410), 'station');
  assert.equal(await at(1305, 262), null); // inside the bounding box, outside the outline
  await page.locator('#screenui [data-id="station"]').dispatchEvent('click');
  await until(page, () => /The station is quiet/.test(document.getElementById('text').textContent));
  await textDone(page);
  assert.match(await text(page), /3 things/);
});

play('screens: the keyboard moves between enabled elements by direction, Enter picks, Backspace cancels', async page => {
  await gotoScreens(page, 'show screen town_map');
  await screenUp(page);
  assert.equal(await activeId(page), null);
  await page.keyboard.press('ArrowDown'); // the first press lands on the default element
  assert.equal(await activeId(page), 'cafe');
  const seen = new Set();
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowRight']) {
    await page.keyboard.press(k);
    seen.add(await activeId(page));
  }
  assert.ok(!seen.has('closed'), 'a disabled element is never focused');
  await gotoScreens(page, 'show screen inventory');
  await until(page, () => !!document.querySelector('#screenui [data-id="back"]'));
  assert.deepEqual(await screenIds(page), ['key', 'coin', 'back']);
  assert.deepEqual(await page.locator('#screenui .sc-btn').allInnerTexts(), ['Brass key', 'Silver coin', 'Back']);
  await page.keyboard.press('ArrowDown'); // lands on the default, "back"
  assert.equal(await activeId(page), 'back');
  await page.keyboard.press('ArrowUp');
  assert.equal(await activeId(page), 'coin');
  await page.keyboard.press('Enter');
  await until(page, () => /You take out the coin/.test(document.getElementById('text').textContent));
  await textDone(page);
  await page.keyboard.press('Space'); // bag_loop shows the inventory again
  await until(page, () => !!document.querySelector('#screenui [data-id="back"]'));
  await page.keyboard.press('Backspace'); // the screen declares cancel: "" returns to the map
  await until(page, () => !!document.querySelector('#screenui [data-id="cafe"]'));
});

play('screens: a gamepad moves with the d-pad, A picks and B cancels', async page => {
  await gotoScreens(page, 'show screen inventory');
  await until(page, () => !!document.querySelector('#screenui [data-id="back"]'));
  await tap(page, 13); // down: the default
  assert.equal(await activeId(page), 'back');
  await tap(page, 12);
  assert.equal(await activeId(page), 'coin');
  await tap(page, 0);
  await until(page, () => /You take out the coin/.test(document.getElementById('text').textContent));
  await textDone(page);
  await tap(page, 0);
  await until(page, () => !!document.querySelector('#screenui [data-id="back"]'));
  await tap(page, 1); // B cancels
  await until(page, () => !!document.querySelector('#screenui [data-id="cafe"]'));
}, withPad);

play('screens: rolling back from the line after a pick shows the screen again', async page => {
  await gotoScreens(page, 'show screen town_map');
  await screenUp(page);
  await page.locator('#screenui [data-id="lake"]').click();
  await until(page, () => /The lake is still/.test(document.getElementById('text').textContent));
  await textDone(page);
  await page.keyboard.press('PageUp');
  await screenUp(page);
  assert.ok((await screenIds(page)).includes('lake'));
});

// ---- HUD (screens.vn "hud_demo"): a screen that stays up; clicking it calls a label and the interrupted line comes back ----
const hudUp = page => until(page, () => document.getElementById('hudui').dataset.visible === 'true');

play('hud: clicking a HUD button runs its label between lines, then the interrupted line returns', async page => {
  await gotoScreens(page, 'hud_demo');
  await until(page, () => /status strip stays up/.test(document.getElementById('text').textContent));
  await hudUp(page);
  await until(page, () => document.querySelector('#hudui .sc-text')?.textContent === 'Coins: 3');
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => /story picks up/.test(document.getElementById('text').textContent));
  await page.locator('#hudui [data-id="purse"]').click(); // in the middle of the second line
  await until(page, () => /another coin. Now you have 4/.test(document.getElementById('text').textContent));
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => /story picks up/.test(document.getElementById('text').textContent)); // the line comes back
  await textDone(page);
  await until(page, () => document.querySelector('#hudui .sc-text')?.textContent === 'Coins: 4'); // live variable
  await page.keyboard.press('Space');
  await until(page, () => /That is all/.test(document.getElementById('text').textContent));
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('hudui').dataset.visible !== 'true'); // hud off
});

play('hud: the HUD does not steal clicks meant for the story, and Shift+Tab reaches it from the keyboard', async page => {
  await gotoScreens(page, 'hud_demo');
  await hudUp(page);
  await until(page, () => /status strip stays up/.test(document.getElementById('text').textContent));
  await textDone(page);
  await page.mouse.click(640, 400); // empty stage: advances like always
  await until(page, () => /story picks up/.test(document.getElementById('text').textContent));
  await textDone(page);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.id ?? null), 'purse');
  await page.keyboard.press('Enter');
  await until(page, () => /another coin/.test(document.getElementById('text').textContent));
});

play('hud: pointing at a HUD button with `on focus` runs its label, leaving it runs `on blur`', async page => {
  await gotoScreens(page, 'hud_demo');
  await hudUp(page);
  await until(page, () => /status strip stays up/.test(document.getElementById('text').textContent));
  await textDone(page);
  assert.equal(await page.locator('#hudui .sc-text').nth(1).innerText(), '');
  await page.locator('#hudui [data-id="help"]').hover();
  await until(page, () => /just a demo/.test(document.querySelector('#hudui')?.textContent ?? ''));
  await page.mouse.move(640, 400);
  await until(page, () => !/just a demo/.test(document.querySelector('#hudui')?.textContent ?? ''));
});

// A quiet `on blur` that hides an element (a bar that closes when the pointer leaves the strip) redraws the HUD under the pointer.
const HUD_REVEAL = `screen edge:
  hotspot strip at 0,400 size 40,300 "Items" on focus edge_open on blur edge_close
  button b1 at 40,400 size 240,80 "Key" if reveal
  button b2 at 40,500 size 240,80 "Coin" if reveal
label edge_demo:
  set reveal = false
  hud on edge
  alice: One. #e001
  alice: Two. #e002
  end
label edge_open:
  set reveal = true
  return
label edge_close:
  set reveal = false
  return
`;
play('hud: an element that a blur handler removes does not break the pointer tracking', async page => {
  await page.evaluate(l => window.postMessage({ type: 'goto', file: 'edge.vn', line: l }, location.origin), HUD_REVEAL.split('\n').findIndex(l => l.startsWith('label edge_demo')) + 1);
  await hudUp(page);
  await until(page, () => /One/.test(document.getElementById('text').textContent));
  await textDone(page);
  const ids = () => page.evaluate(() => [...document.querySelectorAll('#hudui [data-id]')].map(e => e.dataset.id));
  const at = async (x, y) => page.evaluate(([x, y]) => { const r = document.getElementById('hudui').getBoundingClientRect(); return [r.left + r.width * x / 1920, r.top + r.height * y / 1080]; }, [x, y]);
  await page.mouse.move(...await at(20, 550));
  await until(page, () => document.querySelectorAll('#hudui [data-id]').length === 3); // the strip reveals the bar
  await page.mouse.move(...await at(100, 440), { steps: 8 }); // into the bar: the strip's blur closes it
  await until(page, () => document.querySelectorAll('#hudui [data-id]').length === 1);
  await page.mouse.move(...await at(900, 100), { steps: 4 });
  assert.deepEqual(await ids(), ['strip']);
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'edge.vn', text: HUD_REVEAL });
    await route.fulfill({ response: res, json: proj });
  });
});

// The same strip with the bar nested in it: moving onto a bar button is still inside the group, so the strip does not blur.
const HUD_NEST = HUD_REVEAL.replace('on blur edge_close\n', 'on blur edge_close:\n').replace(/\n  button (b[12]) (.*)/g, '\n    button $1 $2');
play('hud: a bar nested in the hover strip stays open while the pointer is on the strip or a bar button, and closes on leaving the group', async page => {
  await page.evaluate(l => window.postMessage({ type: 'goto', file: 'edge.vn', line: l }, location.origin), HUD_NEST.split('\n').findIndex(l => l.startsWith('label edge_demo')) + 1);
  await hudUp(page);
  await until(page, () => /One/.test(document.getElementById('text').textContent));
  await textDone(page);
  const ids = () => page.evaluate(() => [...document.querySelectorAll('#hudui [data-id]')].map(e => e.dataset.id));
  const at = async (x, y) => page.evaluate(([x, y]) => { const r = document.getElementById('hudui').getBoundingClientRect(); return [r.left + r.width * x / 1920, r.top + r.height * y / 1080]; }, [x, y]);
  await page.mouse.move(...await at(20, 440));
  await until(page, () => document.querySelectorAll('#hudui [data-id]').length === 3);
  await page.mouse.move(...await at(100, 440), { steps: 8 }); // strip -> bar button: the bar stays
  await until(page, () => document.querySelector('#hudui [data-id="b1"]')?.dataset.active === 'true');
  assert.deepEqual(await ids(), ['strip', 'b1', 'b2']);
  assert.equal(await page.locator('#hudui [data-id="strip"]').getAttribute('data-active'), 'true', 'the group stays highlighted');
  await page.mouse.move(...await at(100, 540), { steps: 1 }); // jump to the second button
  await until(page, () => document.querySelector('#hudui [data-id="b2"]')?.dataset.active === 'true');
  assert.deepEqual(await ids(), ['strip', 'b1', 'b2']);
  await page.mouse.move(...await at(20, 440), { steps: 8 }); // back onto the strip
  await until(page, () => document.querySelector('#hudui [data-id="strip"]')?.dataset.active === 'true' && document.querySelector('#hudui [data-id="b2"]')?.dataset.active === 'false');
  assert.deepEqual(await ids(), ['strip', 'b1', 'b2']);
  await page.mouse.move(...await at(900, 100), { steps: 4 }); // out of the group
  await until(page, () => document.querySelectorAll('#hudui [data-id]').length === 1);
  assert.deepEqual(await ids(), ['strip']);
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'edge.vn', text: HUD_NEST });
    await route.fulfill({ response: res, json: proj });
  });
});

// A blocking screen with local state: tabs and a hover tooltip redraw it without losing the focused element or the scroll position.
const STATE_SCREEN = `screen shop:
  state page = "items"
  state tip = ""
  tab items page=items at 80,60 "Items"
  tab notes page=notes at 400,60 "Notes"
  scroll at 80,200 size 500,200
    column at 0,0 gap 10
      button a1 size 300,60 "One" on focus set tip = "First" on blur set tip = "" if page == "items"
      button a2 size 300,60 "Two" on focus set tip = "Second" on blur set tip = "" if page == "items"
      button a3 size 300,60 "Three" if page == "items"
      button a4 size 300,60 "Four" if page == "items"
      button a5 size 300,60 "Five" if page == "items"
      button a6 size 300,60 "Six" if page == "items"
      text "Nothing written." if page == "notes"
  text at 80,500 "Tip: [tip]"
  button done at 1500,900 "Done"
label state_demo:
  show screen shop as pick
  alice: Picked [pick]. #s0001
  end
`;
play('screen state: a tab click and hover handlers redraw a blocking screen in place, keeping focus and scroll', async page => {
  await page.evaluate(l => window.postMessage({ type: 'goto', file: 'state.vn', line: l }, location.origin), STATE_SCREEN.split('\n').findIndex(l => l.startsWith('label state_demo')) + 1);
  await screenUp(page);
  const tip = () => page.locator('#screenui .sc-text').innerText();
  const checked = id => page.locator(`#screenui [data-id="${id}"]`).getAttribute('data-checked');
  assert.equal(await checked('items'), 'true');
  assert.equal(await checked('notes'), 'false');
  await page.locator('#screenui [data-id="a1"]').hover(); // pointer: focus handler sets the tip
  await until(page, () => [...document.querySelectorAll('#screenui .sc-text')].some(e => e.textContent === 'Tip: First'));
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), 'a1', 'the hovered element keeps focus through the redraw');
  await page.evaluate(() => { document.querySelector('#screenui .sc-scroll').scrollTop = 40; });
  await page.locator('#screenui [data-id="a2"]').hover();
  await until(page, () => [...document.querySelectorAll('#screenui .sc-text')].some(e => e.textContent === 'Tip: Second'));
  assert.ok(await page.evaluate(() => document.querySelector('#screenui .sc-scroll').scrollTop) >= 30, 'scroll position kept');
  await page.locator('#screenui [data-id="notes"]').click(); // sets the page: the items go, the notes appear, the screen stays up
  await until(page, () => !document.querySelector('#screenui [data-id="a1"]') && [...document.querySelectorAll('#screenui .sc-text')].some(e => e.textContent === 'Nothing written.'));
  assert.equal(await checked('notes'), 'true');
  assert.equal(await checked('items'), 'false');
  assert.equal(await page.locator('#screenui').getAttribute('data-visible'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), 'notes', 'the clicked tab keeps focus');
  await page.keyboard.press('Tab'); // keyboard focus counts like hovering: Tab moves native focus to the next element
  await page.locator('#screenui [data-id="items"]').click();
  await until(page, () => !!document.querySelector('#screenui [data-id="a1"]'));
  await page.keyboard.press('Tab');
  await page.locator('#screenui [data-id="done"]').click(); // a normal button still answers the screen
  await screenGone(page);
  await until(page, () => /Picked done/.test(document.getElementById('text').textContent));
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'state.vn', text: STATE_SCREEN });
    await route.fulfill({ response: res, json: proj });
  });
});

// Blocking screens with `inout` parameters: toggle and radio redraw in place, keyboard and pointer operate them, Done writes the values back,
// and the cancel key discards them (`cancel`), keeps them (`cancel keep`) or does nothing (no `cancel`).
const INOUT_SCREEN = `screen prefs(inout lamp, inout paper):
  state tip = ""
  toggle lamp_t lamp at 80,100 "Lamp" on focus set tip = "Warm" on blur set tip = ""
  text at 80,500 "Tip: [tip]"
  radio cream paper=cream at 80,200 "Cream"
  radio dark paper=dark at 80,300 "Dark"
  button done at 1500,900 "Done"
  cancel
screen prefs_keep(inout lamp, inout paper):
  toggle lamp_t lamp at 80,100 "Lamp"
  radio dark paper=dark at 80,300 "Dark"
  button done at 1500,900 "Done"
  cancel keep
screen prefs_none(inout lamp, inout paper):
  toggle lamp_t lamp at 80,100 "Lamp"
  button done at 1500,900 "Done"
label inout_demo:
  set lamp = false
  set paper = "cream"
  show screen prefs(lamp, paper) as pick
  alice: Result <[pick]> [lamp] [paper]. #s0002
  end
label inout_keep:
  set lamp = false
  set paper = "cream"
  show screen prefs_keep(lamp, paper) as pick
  alice: Kept <[pick]> [lamp] [paper]. #s0003
  end
label inout_none:
  set lamp = false
  set paper = "cream"
  show screen prefs_none(lamp, paper) as pick
  alice: Done <[pick]> [lamp]. #s0004
  end
`;
const inoutRoutes = async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'inout.vn', text: INOUT_SCREEN });
    await route.fulfill({ response: res, json: proj });
  });
};
const gotoInout = async (page, label) => {
  await page.evaluate(l => window.postMessage({ type: 'goto', file: 'inout.vn', line: l }, location.origin), INOUT_SCREEN.split('\n').findIndex(l => l.startsWith(`label ${label}`)) + 1);
  await screenUp(page);
};
const saidText = (page, re) => until(page, r => new RegExp(r).test(document.getElementById('text').textContent), re.source);
play('screen inout: toggle and radio are operable by pointer and keyboard, show their state, and Done writes the values back', async page => {
  await gotoInout(page, 'inout_demo');
  const attr = (id, a) => page.locator(`#screenui [data-id="${id}"]`).getAttribute(a);
  assert.equal(await attr('lamp_t', 'role'), 'checkbox');
  assert.equal(await attr('lamp_t', 'aria-checked'), 'false');
  assert.equal(await attr('cream', 'role'), 'radio');
  assert.equal(await attr('cream', 'aria-checked'), 'true');
  assert.equal(await attr('dark', 'aria-checked'), 'false');
  await page.locator('#screenui [data-id="lamp_t"]').click(); // pointer
  await until(page, () => document.querySelector('#screenui [data-id="lamp_t"]')?.getAttribute('aria-checked') === 'true');
  assert.equal(await attr('lamp_t', 'data-checked'), 'true');
  assert.equal(await page.locator('#screenui').getAttribute('data-visible'), 'true', 'a toggle does not end the screen');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), 'lamp_t', 'the toggle keeps focus through the redraw');
  await page.keyboard.press('Enter'); // keyboard: the focused toggle flips back
  await until(page, () => document.querySelector('#screenui [data-id="lamp_t"]')?.getAttribute('aria-checked') === 'false');
  await page.keyboard.press('Enter');
  await until(page, () => document.querySelector('#screenui [data-id="lamp_t"]')?.getAttribute('aria-checked') === 'true');
  await page.keyboard.press('ArrowDown'); // to the first radio, then the second: Enter picks it
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await until(page, () => document.querySelector('#screenui [data-id="dark"]')?.getAttribute('aria-checked') === 'true');
  assert.equal(await attr('cream', 'aria-checked'), 'false', 'a radio group has one lit member');
  await page.locator('#screenui [data-id="done"]').click();
  await screenGone(page);
  await saidText(page, /Result <done> true dark\./);
}, inoutRoutes);
play('screen inout: cancel discards the changes, cancel keep applies them, a screen without cancel ignores the cancel key', async page => {
  await gotoInout(page, 'inout_demo');
  await page.locator('#screenui [data-id="lamp_t"]').click();
  await page.locator('#screenui [data-id="dark"]').click();
  await until(page, () => document.querySelector('#screenui [data-id="dark"]')?.getAttribute('aria-checked') === 'true');
  await page.keyboard.press('Backspace');
  await screenGone(page);
  await saidText(page, /Result <> false cream\./);
  await gotoInout(page, 'inout_keep');
  await page.locator('#screenui [data-id="lamp_t"]').click();
  await page.locator('#screenui [data-id="dark"]').click();
  await until(page, () => document.querySelector('#screenui [data-id="dark"]')?.getAttribute('aria-checked') === 'true');
  await page.keyboard.press('Backspace');
  await screenGone(page);
  await saidText(page, /Kept <> true dark\./);
  await gotoInout(page, 'inout_none');
  await page.locator('#screenui [data-id="lamp_t"]').click();
  await until(page, () => document.querySelector('#screenui [data-id="lamp_t"]')?.getAttribute('aria-checked') === 'true');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#screenui').getAttribute('data-visible'), 'true', 'no cancel declared: the key does nothing');
  await page.locator('#screenui [data-id="done"]').click();
  await screenGone(page);
  await saidText(page, /Done <done> true\./);
}, inoutRoutes);

play('hud: a mask hotspot in a HUD hits only its opaque pixels and lets other clicks through to the story', async page => {
  await gotoScreens(page, 'hud_demo');
  await hudUp(page);
  await until(page, () => /status strip stays up/.test(document.getElementById('text').textContent));
  await textDone(page);
  // the mask image is read in the background; each HUD screen is a layer of its own inside #hudui
  await until(page, () => !!document.querySelector('#hudui [data-masks]') && !document.querySelector('#hudui [data-masks="loading"]'));
  const at = (fx, fy) => page.evaluate(([fx, fy]) => { const r = document.getElementById('hudui').getBoundingClientRect(); return [r.left + r.width * fx, r.top + r.height * fy]; }, [fx, fy]);
  const [cx, cy] = await at((860 + 100) / 1920, (700 + 75) / 1080);
  const [ex, ey] = await at((860 + 4) / 1920, (700 + 4) / 1080); // a corner of the box: transparent
  await page.mouse.move(ex, ey);
  assert.equal(await page.locator('#hudui .sc-hover').isVisible(), false);
  assert.notEqual(await page.locator('#hudui [data-id="orb"]').getAttribute('data-active'), 'true');
  await page.mouse.move(cx, cy);
  await until(page, () => document.querySelector('#hudui [data-id="orb"]').dataset.active === 'true');
  assert.equal(await page.locator('#hudui .sc-hover').isVisible(), true, 'the hover image shows while the orb is active');
  await page.mouse.click(cx, cy);
  await until(page, () => /ten coins. Now you have 13/.test(document.getElementById('text').textContent));
});

// ---- a project's `screen quickmenu` replaces the stock quick menu bar ----
play('quickmenu: a screen named quickmenu is drawn in place of the stock bar and its actions run', async page => {
  await newGame(page);
  await until(page, () => document.getElementById('quickui').dataset.visible === 'true');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#quickui [data-id]')].map(e => e.dataset.act)), ['history', 'auto']);
  await page.locator('#quickui [data-act="auto"]').click();
  await until(page, () => document.querySelector('#quickui [data-act="auto"]').getAttribute('aria-pressed') === 'true');
  await page.locator('#quickui [data-act="auto"]').click();
  await until(page, () => document.querySelector('#quickui [data-act="auto"]').getAttribute('aria-pressed') === 'false');
  await page.locator('#quickui [data-act="history"]').click();
  await page.locator('#history').waitFor({ state: 'visible' });
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'qm.vn', text: 'screen quickmenu:\n  row anchor bottomright margin 20 gap 10:\n    button hist "History" action history\n    button auto "Auto" action auto\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// ---- a project's `screen title` replaces the stock title screen ----
play('title: a screen named title is drawn in place of the stock one and its actions run', async page => {
  await until(page, () => document.getElementById('titleui').dataset.visible === 'true');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#titleui [data-id]')].map(e => e.dataset.act)), ['start', 'continue', 'options']);
  assert.equal(await page.locator('#titleui [data-act="continue"]').getAttribute('aria-disabled'), 'true'); // no save yet
  // the arrow keys move focus inside the project's screen (the stock title behind it is hidden), skipping the disabled button
  assert.equal(await page.evaluate(() => document.activeElement.dataset.act), 'start');
  await page.keyboard.press('ArrowDown');
  await until(page, () => document.activeElement.dataset.act === 'options');
  await page.keyboard.press('ArrowUp');
  await until(page, () => document.activeElement.dataset.act === 'start');
  await page.locator('#titleui [data-act="options"]').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await until(page, () => document.getElementById('titleui').dataset.visible === 'false');
  await page.locator('#optionsui [data-act="close"]').click();
  await until(page, () => document.getElementById('titleui').dataset.visible === 'true');
  await page.locator('#titleui [data-act="start"]').click();
  await until(page, () => document.getElementById('box').dataset.visible === 'true');
  await until(page, () => document.getElementById('titleui').dataset.visible === 'false');
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'title.vn', text: 'screen title:\n  column anchor center gap 12:\n    button s "New game" action start\n    button c "Continue" action continue\n    button o "Options" action options\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// ---- a project's `screen options` replaces the stock options ----
play('options: a screen named options is drawn in place of the stock one; sliders, cycles, tabs and close work', async page => {
  await newGame(page);
  await page.keyboard.press('Escape');
  await page.locator('#pauseui [data-act="options"]').click();
  await until(page, () => document.getElementById('optionsui').dataset.visible === 'true');
  assert.equal(await page.locator('#optionsui [data-id="access"]').count(), 0); // the project's screen, not the starter
  // first tab: the slider only; moving it does not rebuild it
  assert.equal(await page.locator('#optionsui [data-setting="master"]').count(), 1);
  assert.equal(await page.locator('#optionsui [data-id="text_sounds"]').count(), 0);
  await page.evaluate(() => {
    const s = document.querySelector('#optionsui [data-setting="master"]');
    s.dataset.same = 'yes';
    s.value = '0.25';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => document.querySelector('#optionsui [data-setting="master"]').dataset.same), 'yes');
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith('settings'))))).master, 0.25);
  assert.equal(await page.locator('#optionsui .sc-readout').textContent(), '25%');
  // second tab: the cycle button shows the word and steps it
  await page.locator('#optionsui [data-id="game"]').click();
  await page.locator('#optionsui [data-id="text_sounds"]').waitFor();
  assert.equal(await page.locator('#optionsui [data-setting="master"]').count(), 0);
  assert.equal(await page.locator('#optionsui [data-id="text_sounds"]').textContent(), 'Text sounds: on');
  await page.locator('#optionsui [data-id="text_sounds"]').click();
  await until(page, () => document.querySelector('#optionsui [data-id="text_sounds"]').textContent === 'Text sounds: off');
  await page.locator('#optionsui [data-act="close"]').click();
  await until(page, () => document.getElementById('optionsui').dataset.visible === 'false');
  await page.locator('#pauseui [data-act="resume"]').waitFor({ state: 'visible' });
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'options.vn', text: 'screen options:\n  button audio at 100,50 "Audio" action tab\n  button game at 400,50 "Game" action tab\n  slider master at 100,200 size 500,40 readout if tab == "audio"\n  button text_sounds at 100,300 "Text sounds: [text_sounds]" action cycle if tab == "game"\n  button done at 100,900 "Back" action close\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// ---- a project's `screen saves` replaces the stock save/load screen ----
play('saves: a screen named saves is drawn in place of the stock one; slots, pages, delete mode and back work', async page => {
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  await openPause(page, 'Save');
  await until(page, () => document.getElementById('savesui').dataset.visible === 'true');
  assert.equal(await page.locator('#savesui [data-act="remove"]').count(), 0); // the project's screen, not the starter
  const slots = page.locator('#savesui [data-act="slot"]');
  assert.equal(await slots.count(), 6);
  assert.equal(await page.locator('#savesui [data-act="page"]').count(), 9); // Save has no auto/quick/choice pages
  assert.match(await slots.first().textContent(), /Slot 1 .*Empty/i);
  await slots.first().click(); // an empty slot saves at once
  await until(page, () => /Alice/.test(document.querySelector('#savesui [data-act="slot"]').textContent));
  await slots.first().click(); // a filled slot asks before overwriting
  await page.locator('#confirm').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.getElementById('savesui').dataset.visible), 'true'); // stays in sight behind the question
  assert.equal(await page.evaluate(() => document.getElementById('savesui').inert), true); // but out of reach
  await page.locator('#confirm').getByRole('button', { name: 'No' }).click();
  await page.locator('#confirm').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.getElementById('savesui').inert), false);
  await page.locator('#savesui [data-id="page2"]').click(); // page 2 has other slots, all empty
  await until(page, () => /Empty/i.test(document.querySelector('#savesui [data-act="slot"]').textContent));
  assert.notEqual(await slots.first().getAttribute('data-id'), '1');
  await page.locator('#savesui [data-id="page1"]').click();
  await page.locator('#savesui [data-act="delete"]').click(); // delete mode: the next slot picked is deleted
  await slots.first().click();
  await page.locator('#confirm').waitFor({ state: 'visible' });
  await confirmYes(page);
  await until(page, () => /Empty/i.test(document.querySelector('#savesui [data-act="slot"]').textContent));
  await page.locator('#savesui [data-act="close"]').click();
  await until(page, () => document.getElementById('savesui').dataset.visible === 'false');
  await page.locator('#pauseui [data-act="resume"]').waitFor({ state: 'visible' });
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'saves.vn', text: 'screen saves:\n  each pages as pg at 100,50 step 140,0:\n    button pg at 0,0 "[pg.name]" action page\n  each slots as slot at 100,200 step 0,110:\n    button slot at 0,0 size 1100,96 "[slot.title] [slot.when] [slot.text]" action slot enabled mode == "save" or not slot.empty\n  button del at 1400,200 "Delete" action delete\n  button done at 1400,900 "Back" action close\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// ---- a project's `screen history` replaces the starter, here with a small scroll area ----
play('history: a screen named history lists the lines in a scroll area that starts at the end; wheel and keys scroll it, close goes back', async page => {
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  await textDone(page);
  await page.keyboard.press('l');
  await until(page, () => document.getElementById('historyui').dataset.visible === 'true');
  const area = page.locator('#historyui .sc-scroll');
  const info = () => area.evaluate(e => ({ top: e.scrollTop, max: e.scrollHeight - e.clientHeight, rows: e.querySelectorAll('[data-id]').length, text: e.textContent }));
  let v = await info();
  assert.equal(v.rows, 2);
  assert.ok(v.max > 0, 'two 120px rows do not fit in a 150px box');
  assert.ok(Math.abs(v.top - v.max) <= 1, 'starts at the newest line');
  assert.match(v.text, /Alice\|You're late/);
  await area.hover();
  await page.mouse.wheel(0, -400);
  await until(page, () => document.querySelector('#historyui .sc-scroll').scrollTop === 0);
  assert.equal(await page.locator('#history').isHidden(), false); // the wheel did not roll the story back or close anything
  await area.focus();
  await page.keyboard.press('ArrowDown');
  await until(page, () => { const e = document.querySelector('#historyui .sc-scroll'); return e.scrollTop > 0; });
  await page.locator('#historyui [data-act="close"]').click();
  await until(page, () => document.getElementById('historyui').dataset.visible === 'false');
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'history.vn', text: 'screen history:\n  scroll at 100,100 size 1200,150 start bottom:\n    each lines as ln step 0,120:\n      button ln at 0,0 size 1100,100 "[ln.name]|[ln.text]"\n  button done at 1400,900 "Back" action close\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// ---- a project's `screen gallery` replaces the starter gallery ----
play('gallery screen: a screen named gallery draws the tiles; locked ones are disabled, a tile opens the viewer and Escape returns to it', async page => {
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['bg_park_evening'])), gameKey('images'));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleui [data-act="gallery"]').click();
  await until(page, () => document.getElementById('galleryui').dataset.visible === 'true');
  const tiles = page.locator('#galleryui [data-act="tile"]');
  assert.deepEqual(await tiles.evaluateAll(els => els.map(e => [e.dataset.id, e.textContent, e.getAttribute('aria-disabled')])), [['1', 'Evening park', null], ['2', 'Locked', 'true']]);
  assert.equal(await page.locator('#galleryui .sc-scroll img.sc-img').count(), 1); // only the unlocked tile has its picture
  assert.match(await page.locator('#galleryui .sc-text').innerText(), /1 of 2/);
  await tiles.nth(0).click();
  await until(page, () => document.getElementById('viewerui').dataset.visible === 'true');
  await until(page, () => document.getElementById('galleryui').dataset.visible === 'false');
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('galleryui').dataset.visible === 'true');
  await until(page, () => document.activeElement?.dataset.id === '1'); // focus is back on the tile that was viewed
  await page.locator('#galleryui [data-act="close"]').click();
  await until(page, () => document.getElementById('galleryui').dataset.visible === 'false');
  await page.getByRole('button', { name: 'New game' }).waitFor();
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'gallery.vn', text: 'screen gallery:\n  scroll at 100,150 size 800,300:\n    each tiles as t step 0,260:\n      image "[t.file]" at 0,0 size 320,180 if t.unlocked\n      button t at 340,0 size 400,80 "[t.title]" action tile enabled t.unlocked\n  text at 100,60 "[count] of [total]"\n  button done at 1400,900 "Back" action close\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// ---- a project's `screen viewer` replaces the starter (here over the starter gallery) ----
play('viewer screen: a screen named viewer shows the picture and title; next and prev page and wrap, Escape returns to the gallery', async page => {
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['bg_park_evening', 'bg_park_night'])), gameKey('images'));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleui [data-act="gallery"]').click();
  await page.locator('#galleryui [data-act="tile"]').nth(0).click();
  await until(page, () => document.getElementById('viewerui').dataset.visible === 'true');
  const text = () => page.locator('#viewerui .sc-text').innerText();
  await until(page, () => /^Evening park 1\/2/.test(document.querySelector('#viewerui .sc-text')?.textContent ?? ''));
  assert.equal(await page.locator('#viewerui img.sc-img').count(), 1);
  await page.locator('#viewerui [data-act="next"]').click();
  await until(page, () => /^Night park 2\/2/.test(document.querySelector('#viewerui .sc-text')?.textContent ?? ''));
  await page.locator('#viewerui [data-act="next"]').click();
  await until(page, () => /^Evening park 1\/2/.test(document.querySelector('#viewerui .sc-text')?.textContent ?? '')); // wraps around
  await page.locator('#viewerui [data-act="prev"]').click();
  await until(page, () => /^Night park 2\/2/.test(document.querySelector('#viewerui .sc-text')?.textContent ?? ''));
  assert.match(await text(), /^Night park/);
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('viewerui').dataset.visible === 'false');
  await page.locator('#gallery').waitFor({ state: 'visible' });
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'viewer.vn', text: 'screen viewer:\n  image "[file]" at 0,0 size 1920,1080\n  text at 100,60 "[title] [position]/[total]"\n  button prev at 100,900 "<" action prev if total > 1\n  button next at 400,900 ">" action next if total > 1\n  button done at 1400,900 "Back" action close\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// ---- a project's `screen music` and `screen chapters` replace the starter music room and chapter select ----
play('music screen: a screen named music lists the tracks; a track plays, Stop and Back leave', async page => {
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['evening_theme'])), gameKey('music'));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleui [data-act="music"]').click();
  await until(page, () => document.getElementById('musicui').dataset.visible === 'true');
  assert.match(await page.locator('#musicui .sc-text').innerText(), /^ ?1 of 1/);
  const tracks = page.locator('#musicui [data-act="track"]');
  assert.deepEqual(await tracks.evaluateAll(els => els.map(e => [e.dataset.id, e.textContent, e.getAttribute('aria-disabled')])), [['1', 'Evening Theme', null]]);
  await tracks.nth(0).click();
  await until(page, () => /^Evening Theme/.test(document.querySelector('#musicui .sc-text').textContent));
  await page.locator('#musicui [data-act="stop"]').click();
  await until(page, () => /^ ?1 of 1/.test(document.querySelector('#musicui .sc-text').textContent));
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('musicui').dataset.visible === 'false');
  await page.getByRole('button', { name: 'New game' }).waitFor();
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'music.vn', text: 'screen music:\n  each tracks as t step 0,100:\n    button t at 100,150 size 600,80 "[t.title]" action track enabled t.unlocked\n  text at 100,60 "[now] [count] of [total]"\n  button s at 1000,900 "Stop" action stop\n  button done at 1400,900 "Back" action close\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

play('chapters screen: a screen named chapters lists the chapters; a locked one is disabled, an unlocked one starts there', async page => {
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['start'])), gameKey('chapters'));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleui [data-act="chapters"]').click();
  await until(page, () => document.getElementById('chaptersui').dataset.visible === 'true');
  const rows = page.locator('#chaptersui [data-act="chapter"]');
  assert.deepEqual(await rows.evaluateAll(els => els.map(e => [e.dataset.id, e.textContent, e.getAttribute('aria-disabled')])), [['1', 'The bench', null], ['2', 'Locked', 'true']]);
  await rows.nth(0).click();
  await until(page, () => document.getElementById('box').dataset.visible === 'true');
  assert.equal(await page.locator('#chaptersui').getAttribute('data-visible'), 'false');
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'chapters.vn', text: 'screen chapters:\n  each chapters as c step 0,100:\n    button c at 100,150 size 600,80 "[c.title]" action chapter enabled c.unlocked\n  button done at 1400,900 "Back" action close\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// ---- a project's `screen pause` replaces the stock pause menu ----
play('pause: a screen named pause is drawn in place of the stock menu and its actions run', async page => {
  await newGame(page);
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('pauseui').dataset.visible === 'true');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#pauseui [data-id]')].map(e => e.dataset.act)), ['resume', 'options']);
  await page.locator('#pauseui [data-act="options"]').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await until(page, () => document.getElementById('pauseui').dataset.visible === 'false');
  await page.locator('#optionsui [data-act="close"]').click();
  await until(page, () => document.getElementById('pauseui').dataset.visible === 'true');
  await page.locator('#pauseui [data-act="resume"]').click();
  await until(page, () => document.getElementById('pauseui').dataset.visible === 'false');
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'pause.vn', text: 'screen pause:\n  column anchor center gap 12:\n    button r "Resume" action resume\n    button o "Options" action options\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// ---- game.json `stage` sizes the canvas and the box; screens anchor to the project's edges ----
play('stage: a portrait stage sizes the canvas and #stage, and an anchored screen sits at its margins', async page => {
  assert.deepEqual(await page.evaluate(() => {
    const s = document.getElementById('stage'), c = document.getElementById('canvas');
    return [s.offsetWidth, s.offsetHeight, c.width, c.height];
  }), [1080, 1920, 1080, 1920]);
  await newGame(page);
  await until(page, () => document.getElementById('quickui').dataset.visible === 'true');
  // the box is scaled to fit the window; read the button back in stage pixels
  const at = await page.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect(), b = document.querySelector('#quickui [data-act="auto"]').getBoundingClientRect();
    return [Math.round((b.left - r.left) / r.width * 1080), Math.round((b.top - r.top) / r.height * 1920)];
  });
  // a lone 200x84 button, margin 10,40,60,0: 1080 - 40 - 200 = 840 across, 1920 - 60 - 84 = 1776 down
  assert.deepEqual(at, [840, 1776]);
  const fit = await page.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect();
    return [Math.round(r.width / r.height * 1000), r.height <= window.innerHeight];
  });
  assert.deepEqual(fit, [563, true]); // 1080/1920, scaled down to fit the window's height
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.game = { ...proj.game, stage: { width: 1080, height: 1920 } };
    proj.scripts.push({ file: 'qm.vn', text: 'screen quickmenu:\n  row anchor bottomright margin 10,40,60,0:\n    button auto "Auto" action auto\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// A silent half-second mono WAV: enough for the browser to decode and play.
function silentWav(seconds = 0.5, rate = 8000) {
  const n = Math.round(seconds * rate), buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40);
  buf.fill(128, 44);
  return buf;
}

play('voice: a line with a recording offers a replay button and V plays it again', async page => {
  await newGame(page);
  await textDone(page);
  assert.equal(await page.locator('#quickui [data-act="voice"]').isVisible(), true, 'the first line (joce) has a recording');
  await page.locator('#quickui [data-act="options"]').click();
  await page.locator('#optionsui [data-setting="voice"]').waitFor(); // the options have a voice slider
  await page.keyboard.press('Escape');
  await page.locator('#options').waitFor({ state: 'hidden' });
  const played = () => page.evaluate(() => window.__voiceStarts ?? 0);
  await page.keyboard.press('v');
  await page.locator('#quickui [data-act="voice"]').click();
  await until(page, () => (window.__voiceStarts ?? 0) >= 2);
  assert.ok(await played() >= 2);
  await page.evaluate(() => document.activeElement.blur()); // a focused button would take the Space
  await page.keyboard.press('Space'); // the next line has no recording
  await until(page, () => !document.querySelector('#quickui [data-act="voice"]'));
}, async context => {
  await context.addInitScript(() => {
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { if (this.buffer && this.buffer.duration < 1) window.__voiceStarts = (window.__voiceStarts ?? 0) + 1; return start.apply(this, a); };
  });
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.assets = [...(proj.assets ?? []), { file: 'voice/joce.wav', v: 1 }];
    await route.fulfill({ response: res, json: proj });
  });
  await context.route('**/assets/voice/joce.wav*', route => route.fulfill({ body: silentWav(), contentType: 'audio/wav' }));
});

// ---- timed menus: `menu ... timeout N:` with an `on timeout:` block ----
const withTimedStart = seconds => async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    const menu = `label start:\n  "Ready."\n  menu "Quick!" timeout ${seconds}:\n    "Stay":\n      "Stayed put."\n    on timeout:\n      "Time ran out."\n`;
    for (const s of proj.scripts) if (s.file === 'park.vn') s.text = s.text.replace('label start:\n', menu);
    await route.fulfill({ response: res, json: proj });
  });
};
const barScale = page => page.evaluate(() => {
  const m = /scaleX\(([\d.]+)\)/.exec(document.querySelector('#menu .timer i')?.style.transform ?? '');
  return m ? Number(m[1]) : null;
});

play('timed menu: the bar shows and, when the time runs out, the story takes the on timeout block', async page => {
  await newGame(page);
  await toChoice(page);
  assert.equal(await page.locator('#menu .timer').count(), 1);
  assert.match(await page.locator('#menuLive').textContent(), /^5 seconds to choose$/);
  await until(page, () => /Time ran out/.test(document.getElementById('text').textContent));
  assert.equal(await page.locator('#menu .timer').count(), 0);
}, withTimedStart(5));

play('timed menu: choosing an option in time ends the clock', async page => {
  await newGame(page);
  await toChoice(page);
  await page.keyboard.press('1');
  await until(page, () => /Stayed put/.test(document.getElementById('text').textContent));
  await page.waitForTimeout(3500);
  assert.match(await text(page), /Stayed put/); // the clock did not fire later
}, withTimedStart(3));

play('timed menu: opening the pause menu holds the bar', async page => {
  await newGame(page);
  await toChoice(page);
  await page.keyboard.press('Escape');
  await page.locator('#pauseui [data-act="resume"]').waitFor({ state: 'visible' });
  const held = await barScale(page);
  assert.ok(held > 0 && held <= 1);
  await page.waitForTimeout(1500);
  assert.equal(await barScale(page), held);
  assert.equal(await page.locator('#menu[data-visible="true"]').count(), 1);
}, withTimedStart(4));

play('timed menu: with Timed choices off there is no clock and the player can wait', async page => {
  await page.locator('#titleui [data-act="options"]').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await page.locator('#optionsui [data-id="access"]').click();
  await page.locator('#optionsui [data-id="timed_choices"]').click(); // open the list
  await page.locator('#optionsui [data-id="timed_choices.off"]').click(); // -> No time limit
  await until(page, () => /No time limit/.test(document.querySelector('#optionsui [data-id="timed_choices"]').textContent));
  await page.keyboard.press('Escape');
  await page.locator('#options').waitFor({ state: 'hidden' });
  await newGame(page);
  await toChoice(page);
  assert.equal(await page.locator('#menu .timer').count(), 0);
  await page.waitForTimeout(2800);
  assert.equal(await page.locator('#menu[data-visible="true"]').count(), 1);
}, withTimedStart(2));

test('voice dialog: add a take to a row, replace it after asking, flag and confirm an outdated one, match files dropped on the list', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Everything the dialog writes goes to these mocks: the sample project must not get recordings.
  const disk = {}; // name -> { file, sum }
  let lock = {};
  const uploads = [];
  await page.route('**/api/locales', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/voice', route => {
    if (route.request().method() === 'PUT') { lock = JSON.parse(route.request().postData()); return route.fulfill({ body: '{"ok":true}' }); }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ recordings: Object.fromEntries(Object.entries(disk).map(([n, d]) => [n, d.sum])), files: Object.fromEntries(Object.entries(disk).map(([n, d]) => [n, d.file])), lock }),
    });
  });
  await page.route('**/api/asset?*', route => {
    const u = new URL(route.request().url());
    const name = u.searchParams.get('voice'), replace = u.searchParams.get('replace') === '1';
    uploads.push({ name, replace });
    if (disk[name] && !replace) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ dest: `assets/voice/${disk[name].file}` }) });
    const sum = `sum${uploads.length}`;
    disk[name] = { file: `${name}.wav`, sum };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, dest: `assets/voice/${name}.wav`, sum }) });
  });
  await page.route('**/assets/voice/*', route => route.fulfill({ contentType: 'audio/wav', body: Buffer.from('RIFF') }));
  const wav = { name: 'take.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF') };
  try {
    await page.goto(`${base}editor/`);
    await page.locator('.monaco-editor .view-line').first().waitFor(); // the sample's scripts are loaded
    const open = async () => {
      await page.keyboard.press('Control+p');
      await page.keyboard.type('>Voice: Recordings');
      await page.keyboard.press('Enter');
      await page.locator('#voice .vo-row').first().waitFor();
    };
    const dialog = page.locator('#voice');
    const row = n => dialog.locator('.vo-row').nth(n);
    await open();
    const first = await row(0).getAttribute('data-name'), second = await row(1).getAttribute('data-name');
    assert.equal(await row(0).getAttribute('data-status'), 'missing');
    assert.match(await dialog.locator('.vo-summary').innerText(), /^0 of \d+ lines voiced/);
    assert.equal(await row(0).locator('.vo-play').isDisabled(), true, 'nothing to play yet');

    await row(0).locator('input[type=file]').setInputFiles(wav);
    await page.waitForFunction(n => document.querySelector(`#voice .vo-row[data-name="${n}"]`)?.dataset.status === 'recorded', first);
    assert.deepEqual(uploads, [{ name: first, replace: false }]);
    assert.equal(lock[first].sum, 'sum1', 'the lock entry is written at once');
    assert.ok(lock[first].text, 'with the line text');
    assert.match(await dialog.locator('.vo-summary').innerText(), /^1 of \d+ lines voiced/);

    // Play asks for the take's file by name (a mock serves it: the take is not on disk).
    const played = page.waitForRequest(r => r.url().includes(`/assets/voice/${first}.wav`));
    await row(0).locator('.vo-play').click();
    await played;

    // "Replace…" opens the file picker (which the input behind it answers).
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), row(0).locator('.vo-choose').click()]);
    assert.equal(chooser.isMultiple(), false);
    await chooser.setFiles(wav);
    await dialog.locator('.vo-ask:not([hidden])').waitFor();
    assert.match(await dialog.locator('.vo-ask-msg').innerText(), /already has a take/);
    await dialog.locator('.vo-ask-no').click();
    assert.equal(uploads.length, 2, 'declining sends nothing more');
    await row(0).locator('input[type=file]').setInputFiles(wav);
    await dialog.locator('.vo-ask-yes').click();
    for (let i = 0; lock[first].sum !== 'sum4' && i < 50; i++) await page.waitForTimeout(100);
    assert.deepEqual(uploads.at(-1), { name: first, replace: true });
    assert.equal(lock[first].sum, 'sum4', 'the replaced take is the one in the lock');

    // Dropped on the list: a file named after the second line is taken, the other is left over.
    await page.evaluate(([name]) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['RIFF'], `${name}.wav`, { type: 'audio/wav' }));
      dt.items.add(new File(['RIFF'], 'unlabelled.wav', { type: 'audio/wav' }));
      document.querySelector('#voice .vo-scroll').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [second]);
    await page.waitForFunction(n => document.querySelector(`#voice .vo-row[data-name="${n}"]`)?.dataset.status === 'recorded', second);
    assert.deepEqual(await dialog.locator('.vo-chip').allTextContents(), ['unlabelled.wav']);

    // A reworded line: the file is unchanged but the lock remembers other wording.
    lock = { ...lock, [first]: { sum: lock[first].sum, text: 'An older wording.' } };
    await dialog.locator('.close').click();
    await open();
    assert.equal(await row(0).getAttribute('data-status'), 'outdated');
    assert.equal(await row(0).locator('.vo-tag').count(), 2, 'old and new wording are shown');
    await dialog.locator('.vo-outdated').check();
    await page.waitForFunction(() => document.querySelectorAll('#voice .vo-row').length === 1);
    await row(0).locator('.vo-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('#voice .vo-row').length === 0);
    assert.notEqual(lock[first].text, 'An older wording.', 'Still fine takes the current wording');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('build dialog: errors block, warnings need a tick, go-to links, build with target and folder, result', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // The checks and the export are mocked: nothing is built into the sample project.
  let report = { findings: [{ check: 'script', severity: 'error', message: 'Unknown label "nowhere".', file: 'park.vn', line: 3 }], errors: 1, warnings: 0 };
  const languages = { source: 'en', text: ['de', 'fi'], voice: ['en', 'ja'] };
  const tasks = [], checks = [];
  await page.route('**/api/build-check*', route => {
    checks.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...report, languages }) });
  });
  await page.route('**/api/task?*', route => {
    tasks.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ contentType: 'application/x-ndjson', body: '{"out":"Exported \\"Mock\\" to X: 12 files, 3.4 MB\\n"}\n{"ok":true}\n' });
  });
  await page.route('**/api/locales', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/voice', route => route.fulfill({ contentType: 'application/json', body: '{"recordings":{},"files":{},"lock":{}}' }));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('.monaco-editor .view-line').first().waitFor();
    const dialog = page.locator('#build');
    const go = dialog.locator('.bd-go');
    const open = async () => {
      await page.keyboard.press('Control+p');
      await page.keyboard.type('>Build: Checks');
      await page.keyboard.press('Enter');
      await dialog.locator('.bd-summary').filter({ hasText: /error|passed/ }).waitFor();
    };
    await open();
    assert.equal(await dialog.locator('.bd-folder').inputValue(), 'build/web');
    assert.equal(await go.isDisabled(), true, 'an error blocks the build');
    assert.equal(await dialog.locator('.bd-badge[data-severity=error]').count(), 1);
    assert.match(await dialog.locator('.bd-title').first().innerText(), /errors/i);

    // The go-to link closes the dialog and gives the line back to the editor.
    await dialog.locator('.bd-goto').click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.monaco-editor') !== null), true, 'focus is back in the editor');

    // Warnings and a note: the tick enables Build; the note group is collapsed.
    report = { findings: [
      { check: 'ids', severity: 'warning', message: '2 lines have no id.', file: 'park.vn', line: 5, count: 2 },
      { check: 'untranslated', severity: 'warning', message: '4 strings are untranslated.', lang: 'fi', count: 4 },
      { check: 'unused-locale', severity: 'info', message: '1 entry matches no line.', lang: 'fi', count: 1 },
    ], errors: 0, warnings: 2 };
    await open();
    assert.equal(await go.isDisabled(), true, 'warnings wait for the tick');
    assert.equal(await dialog.locator('.bd-group[data-severity=info]').evaluate(el => el.open), false);
    await dialog.locator('.bd-ack-box').check();
    assert.equal(await go.isDisabled(), false);

    // A folder outside build/ is refused.
    await dialog.locator('.bd-folder').fill('assets');
    assert.equal(await go.isDisabled(), true);
    assert.equal(await dialog.locator('.bd-note').isVisible(), true);
    await dialog.locator('.bd-target').selectOption('desktop');
    await dialog.locator('.bd-folder').fill('build/desktop-test');
    await go.click();
    await dialog.locator('.bd-result[data-state=ok]').waitFor();
    assert.equal(tasks.length, 1);
    assert.deepEqual([tasks[0].get('name'), tasks[0].get('target'), tasks[0].get('out')], ['build', 'desktop', 'build/desktop-test']);
    const result = await dialog.locator('.bd-result').innerText();
    assert.match(result, /build\/desktop-test/);
    assert.match(result, /12 files, 3\.4 MB/);

    // Languages: a tick each, the source's voice is the default take; unticking one re-runs the checks and narrows the build.
    assert.deepEqual((await dialog.locator('.bd-langs label').allInnerTexts()).map(x => x.trim()), ['de', 'fi', 'en (default take)', 'ja']);
    assert.equal(tasks[0].has('locales') || tasks[0].has('voice'), false, 'all ticked: the build is unrestricted');
    await dialog.locator('.bd-langs [data-kind=text] label', { hasText: 'fi' }).locator('input').uncheck();
    await dialog.locator('.bd-summary').filter({ hasText: /error|passed/ }).waitFor();
    assert.equal(checks.at(-1).get('locales'), 'de');
    assert.equal(checks.at(-1).has('voice'), false);
    await dialog.locator('.bd-langs [data-kind=voice] label', { hasText: 'ja' }).locator('input').uncheck();
    await dialog.locator('.bd-summary').filter({ hasText: /error|passed/ }).waitFor();
    assert.equal(checks.at(-1).get('voice'), 'en');
    await dialog.locator('.bd-ack-box').check();
    await go.click();
    await dialog.locator('.bd-result[data-state=ok]').waitFor();
    assert.deepEqual([tasks[1].get('locales'), tasks[1].get('voice')], ['de', 'en']);

    // A translation finding opens the Translations dialog.
    await dialog.locator('.bd-goto', { hasText: 'Translations' }).first().click();
    await page.locator('#translations').waitFor();
    assert.equal(await dialog.isHidden(), true);
    await page.keyboard.press('Escape');

    // Re-run checks sees a fixed project; Esc closes.
    await open();
    report = { findings: [], errors: 0, warnings: 0 };
    await dialog.locator('.bd-rerun').click();
    await dialog.locator('.bd-summary', { hasText: 'All checks passed' }).waitFor();
    assert.equal(await go.isDisabled(), false);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

// ---- debug console (the dev preview's drawer) ----

play('debug console: set, eval and vars read the running story, story keys stay out, jump starts at a label, Escape closes', async page => {
  await newGame(page);
  await textDone(page);
  const before = await text(page);
  await page.locator('#debugBtn').click();
  const input = page.getByRole('textbox', { name: 'Debug command' });
  await until(page, () => document.activeElement?.getAttribute('aria-label') === 'Debug command');
  const log = page.locator('#debug .log');
  const run = async cmd => { await input.fill(cmd); await input.press('Enter'); };
  await run('set trust = 2');
  await run('trust * 10');
  await run('vars');
  await run('jump nowhere');
  const rows = await log.locator('div').allInnerTexts();
  assert.ok(rows.includes('> set trust = 2') && rows.includes('trust = 2'), `set echoes the value: ${JSON.stringify(rows)}`);
  assert.ok(rows.includes('20'), 'an expression is evaluated against the story variables');
  assert.equal(rows.filter(r => r === 'trust = 2').length, 2, 'vars lists the new value');
  assert.match(await log.locator('.err').last().innerText(), /No label "nowhere"/);

  await input.press('Space'); // typed into the field, not an advance
  assert.equal(await text(page), before);
  await input.press('ArrowUp');
  assert.equal(await input.inputValue(), 'jump nowhere', 'ArrowUp recalls the last command');
  await input.press('ArrowUp');
  assert.equal(await input.inputValue(), 'vars');

  await run('jump bench_talk');
  await until(page, () => /Sit down|Sit\. We need to talk/.test(document.getElementById('text').textContent));
  assert.match(await log.locator('div').last().innerText(), /New playthrough at bench_talk/);
  await input.press('Escape');
  await until(page, () => document.getElementById('debug').dataset.visible === 'false');
});

// ---- editor panels: the page with every write mocked (nothing reaches the sample project); `puts` collects them ----
function inEditor(name, fn, setup) {
  test(name, async t => {
    if (skipReason) { t.skip(skipReason); return; }
    const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
    const puts = [];
    await context.route(/\/api\/(script|locale|game|rig)(\?|$)/, route => {
      const r = route.request();
      if (r.method() !== 'PUT') return route.fallback();
      puts.push({ file: new URL(r.url()).searchParams.get('file'), body: r.postData() ?? '' });
      return route.fulfill({ json: { ok: true } });
    });
    await setup?.(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(`${base}editor/`);
      await page.locator('.monaco-editor .view-line').first().waitFor();
      await fn(page, puts);
      assert.deepEqual(errors, [], 'the page threw errors');
    } finally {
      await context.close();
    }
  });
}
const palette = async (page, query) => {
  await page.keyboard.press('Control+p');
  await page.locator('[aria-controls="paletteList"]').waitFor();
  await page.keyboard.type(query);
  await page.keyboard.press('Enter');
};
// Monaco draws spaces as no-break spaces: compare the rendered rows with those turned back.
const shownLine = (page, part) => until(page, part => [...document.querySelectorAll('.monaco-editor .view-line')].some(e => e.textContent.replace(/\s/g, ' ').includes(part)), part);
const activeLine = page => page.evaluate(() => document.querySelector('.monaco-editor .active-line-number')?.textContent ?? '');
/** Open a script and put the cursor inside `word` on the first line containing `needle` (End, then left: no pixel guessing). */
async function cursorIn(page, file, needle, word) {
  const lines = readFileSync(path.join(root, 'games/sample/script', file), 'utf8').split('\n');
  const n = lines.findIndex(l => l.includes(needle)) + 1;
  const line = lines[n - 1].replace(/\r$/, '');
  await palette(page, file);
  await until(page, f => document.querySelector('#tabs .tab[data-selected="true"]')?.textContent?.includes(f), file);
  await palette(page, `:${n}`);
  await until(page, n => document.querySelector('.monaco-editor .active-line-number')?.textContent === String(n), n);
  await page.keyboard.press('End');
  const inside = line.indexOf(word, line.indexOf(needle)) + 2; // two characters into the word
  for (let i = 0; i < line.length - inside; i++) await page.keyboard.press('ArrowLeft');
  return n;
}
const demoLocales = { 'locale/fi.json': `${JSON.stringify({ vbsv: 'Hauska tavata, [player].', bu9l: 'Nähdään, [player]. (Käyntejä: [demo_visits])' }, null, 2)}\n` };

inEditor('task output: a task streams into the Output panel, file:line links open the line, Close hides it', async page => {
  await page.route('**/api/task?*', route => route.fulfill({
    contentType: 'application/x-ndjson',
    body: '{"out":"Wrote locale/en.json\\n"}\n{"out":"park.vn:9: a line has no id\\n"}\n{"ok":false}\n',
  }));
  const output = page.locator('#taskOutput');
  assert.equal(await output.isHidden(), true);
  await palette(page, '>Export Strings');
  await until(page, () => /strings: failed/.test(document.getElementById('status').textContent));
  assert.equal(await page.locator('#taskOutputText').innerText(), 'Wrote locale/en.json\npark.vn:9: a line has no id');
  const link = page.locator('#taskOutputText a');
  assert.equal(await link.innerText(), 'park.vn:9');
  await link.click();
  await until(page, () => document.querySelector('.monaco-editor .active-line-number')?.textContent === '9');
  await page.locator('#taskOutputClose').click();
  await output.waitFor({ state: 'hidden' });
});

inEditor('translations dialog: progress, filter, edits saved as you type, changed source, Still correct, a new language', async (page, puts) => {
  const dialog = page.locator('#translations');
  await palette(page, '>Translations: Edit');
  const summary = dialog.locator('.tr-summary');
  await until(page, () => /translated/.test(document.querySelector('#translations .tr-summary').textContent));
  assert.match(await summary.innerText(), /^1 of \d+ translated · 1 with changed source · 1 unused entry in locale\/fi\.json$/);
  assert.equal(await dialog.locator('.tr-lang').inputValue(), 'fi');

  await dialog.locator('.tr-filter').fill('kx0c');
  await until(page, () => document.querySelectorAll('#translations .tr-row').length === 1);
  assert.match(await summary.innerText(), /· 1 shown$/);
  await dialog.locator('.tr-edit').fill('Istu. Meidän pitää puhua.');
  await until(page, () => /^2 of /.test(document.querySelector('#translations .tr-summary').textContent));
  for (let i = 0; i < 40 && !puts.some(p => p.file === 'fi.json'); i++) await page.waitForTimeout(100);
  assert.equal(JSON.parse(puts.find(p => p.file === 'fi.json').body).kx0c, 'Istu. Meidän pitää puhua.');

  await dialog.locator('.tr-filter').fill('');
  await dialog.locator('.tr-changed').check();
  await until(page, () => document.querySelectorAll('#translations .tr-row[data-outdated="true"]').length === 1);
  assert.match(await dialog.locator('.tr-was').innerText(), /Was: An older wording\./);
  await dialog.locator('.tr-ok').click();
  await until(page, () => !/changed source/.test(document.querySelector('#translations .tr-summary').textContent));
  // The edit above saved fi.src too (with the old j30k); Still correct saves it again with the current source.
  const j30k = () => JSON.parse(puts.filter(p => p.file === 'fi.src').at(-1)?.body ?? '{}').j30k;
  for (let i = 0; i < 40 && !/^Fine/.test(j30k() ?? ''); i++) await page.waitForTimeout(100);
  assert.match(j30k(), /^Fine\. Sit down/);
  await dialog.locator('.tr-changed').uncheck();

  await dialog.locator('.tr-new').fill('x');
  await dialog.locator('.tr-add').click();
  assert.match(await summary.innerText(), /A language code is 2-3 letters/);
  await dialog.locator('.tr-new').fill('de');
  await dialog.locator('.tr-new').press('Enter');
  assert.equal(await dialog.locator('.tr-lang').inputValue(), 'de');
  assert.match(await summary.innerText(), /^0 of \d+ translated/);

  // The built-in menu labels are rows too (ui.<key>, the page's own text as the source).
  await dialog.locator('.tr-filter').fill('ui.back');
  await until(page, () => document.querySelectorAll('#translations .tr-row').length === 1);
  assert.match(await dialog.locator('.tr-kind').innerText(), /menu label/);
  assert.equal(await dialog.locator('.tr-src').innerText(), 'Back');

  // A row's file:line closes the dialog and shows the line.
  await dialog.locator('.tr-filter').fill('j30k');
  await until(page, () => document.querySelectorAll('#translations .tr-row').length === 1);
  const where = await dialog.locator('.tr-where').innerText();
  await dialog.locator('.tr-where').click();
  await dialog.waitFor({ state: 'hidden' });
  await until(page, l => document.querySelector('.monaco-editor .active-line-number')?.textContent === l, where.split(':')[1]);

  await palette(page, '>Translations: Edit');
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
}, async context => {
  await context.route('**/api/locales', route => route.fulfill({ json: {
    'locale/en.json': '{}',
    'locale/fi.json': JSON.stringify({ j30k: 'Hyvä on. Istu.', zzzz: 'Ei käytössä.' }),
    'locale/fi.src': JSON.stringify({ j30k: 'An older wording.' }),
  } }));
});

inEditor('variable rename: F2 on a variable rewrites the scripts and the translation tables that use it', async (page, puts) => {
  const n = await cursorIn(page, 'demo.vn', 'Nice to meet you, [player]', 'player');
  await page.keyboard.press('F2');
  const box = page.locator('.rename-box input, .rename-input').first();
  await box.waitFor();
  assert.equal(await box.inputValue(), 'player');
  await box.fill('hero');
  await box.press('Enter');
  await shownLine(page, 'Nice to meet you, [hero]');
  for (let i = 0; i < 40 && !puts.some(p => p.file === 'fi.json'); i++) await page.waitForTimeout(100);
  const fi = puts.filter(p => p.file === 'fi.json');
  assert.equal(fi.length, 1, 'the table is written once');
  assert.deepEqual(JSON.parse(fi[0].body), { vbsv: 'Hauska tavata, [hero].', bu9l: 'Nähdään, [hero]. (Käyntejä: [demo_visits])' });
  assert.equal(await activeLine(page), String(n));
}, async context => {
  await context.route('**/api/locales', route => route.fulfill({ json: demoLocales }));
});

inEditor('variable rename: a cancelled F2 leaves the translation tables alone', async (page, puts) => {
  await cursorIn(page, 'demo.vn', 'Nice to meet you, [player]', 'player');
  await page.keyboard.press('F2');
  const box = page.locator('.rename-box input, .rename-input').first();
  await box.waitFor();
  await box.fill('hero');
  await box.press('Escape');
  await page.waitForTimeout(1500);
  assert.deepEqual(puts.filter(p => p.file === 'fi.json'), []);
}, async context => {
  await context.route('**/api/locales', route => route.fulfill({ json: demoLocales }));
});

inEditor('find all uses: Shift+F12 on a variable lists every use in a peek view', async page => {
  await cursorIn(page, 'demo.vn', 'Nice to meet you, [player]', 'player');
  await page.keyboard.press('Shift+F12');
  const peek = page.locator('.peekview-widget');
  await peek.waitFor();
  await until(page, () => /\(\d+\)/.test(document.querySelector('.peekview-widget .peekview-title')?.textContent ?? ''));
  const meta = await peek.locator('.peekview-title').innerText();
  assert.match(meta, /References \(3\)/, 'the input, the greeting and the goodbye (the comment that names it is no use)');
  await page.keyboard.press('Escape');
  await peek.waitFor({ state: 'hidden' });
});

inEditor('art drop: files dropped on an asset folder go there, elsewhere the server picks; the status says what came in', async page => {
  const uploads = [];
  await page.route('**/api/asset?*', route => {
    const q = new URL(route.request().url()).searchParams;
    uploads.push({ name: q.get('name'), folder: q.get('folder') });
    const dest = `assets/${q.get('folder') || 'bg'}/${q.get('name')}`;
    return route.fulfill(q.get('name') === 'bg_park_night.png' ? { status: 409, json: { dest } } : { json: { dest } });
  });
  const folder = page.locator('#sbList details[data-dir="bg"]');
  await folder.waitFor();
  const drag = (type, onFolder, names) => page.evaluate(([type, onFolder, names]) => {
    const dt = new DataTransfer();
    for (const n of names) dt.items.add(new File(['PNG'], n, { type: 'image/png' }));
    const d = document.querySelector('#sbList details[data-dir="bg"]');
    (onFolder ? d.querySelector('summary') : d.parentElement).dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [type, onFolder, names]);
  await drag('dragover', true, ['new_bg.png']);
  assert.match(await folder.getAttribute('class') ?? '', /\bdrop\b/, 'the folder under the pointer is marked');
  await drag('drop', true, ['new_bg.png', 'bg_park_night.png']);
  await until(page, () => /added/.test(document.getElementById('status').textContent));
  assert.equal(await page.locator('#status').innerText(), 'added assets/bg/new_bg.png not added: assets/bg/bg_park_night.png exists');
  assert.deepEqual(uploads, [{ name: 'new_bg.png', folder: 'bg' }, { name: 'bg_park_night.png', folder: 'bg' }]);
  assert.equal(await page.locator('#sbList .drop').count(), 0, 'the mark is gone after the drop');
  await drag('drop', false, ['loose.png']);
  for (let i = 0; i < 40 && uploads.length < 3; i++) await page.waitForTimeout(100);
  assert.deepEqual(uploads[2], { name: 'loose.png', folder: '' }, 'off a folder, the server routes by type');
});

inEditor('screens sidebar: a built-in screen row opens it in the preview and shows its starter code read-only', async page => {
  const frame = page.frameLocator('#preview');
  await frame.locator('#title:not([hidden]), #box[data-visible="true"]').first().waitFor();
  const screenRow = title => page.locator('#sbList .row', { has: page.locator('.item span:first-child', { hasText: new RegExp(`^${title}$`) }) }).locator('.item');
  await screenRow('Options').click();
  await frame.locator('#options').waitFor({ state: 'visible' });
  await shownLine(page, 'screen options');
  assert.equal(await screenRow('Options').getAttribute('aria-current'), 'true');
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.type('zzz');
  assert.ok(!(await page.locator('.monaco-editor .view-lines').innerText()).includes('zzz'), 'the starter code is read-only');
  await screenRow('History').click();
  await frame.locator('#history:not([hidden])').waitFor();
  assert.equal(await frame.locator('#options').isHidden(), true);
  assert.equal(await screenRow('History').getAttribute('aria-current'), 'true');
});

describe('browser', { concurrency: Math.max(1, Number(process.env.VN_BROWSER_JOBS) || 6) }, () => {
  for (const args of queued) nodeTest(...args);
});

test('theme panel: fields write the theme file, contrast warns, the gallery follows and click-to-inspect jumps to the component', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const saved = [];
  // The sample project has no theme file: add one to the project listing and catch its saves.
  await page.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    await route.fulfill({ response: res, json: { ...proj, themeTexts: { night: '{\n  "extends": "base",\n  "tokens": { "accent": "#e0a050" }\n}\n' } } });
  });
  await page.route('**/api/theme*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  try {
    await page.goto(`${base}editor/`);
    await page.keyboard.press('Control+p');
    await page.keyboard.type('>Theme: Panel');
    await page.keyboard.press('Enter');
    const panel = page.locator('#themePanel');
    await panel.locator('.td-field').first().waitFor();
    const field = (label) => panel.locator('.td-field', { has: page.locator(`label:text-is("${label}")`) });
    assert.equal(await field('accent').locator('input[type=text]').inputValue(), '#e0a050');
    assert.equal(await field('accent').locator('.td-src').innerText(), 'set here');
    assert.equal(await panel.locator('.td-warn').count(), 0, 'the default palette is readable');

    const tile = title => panel.locator(`iframe[title="${title}"]`);
    await tile('Title').waitFor();
    const themeStyle = async title => tile(title).evaluate(f => f.contentDocument?.getElementById('themeStyle')?.textContent ?? '');
    await until(page, () => [...document.querySelectorAll('#themePanel iframe')].every(f => f.contentDocument?.getElementById('themeStyle')?.textContent.includes('#e0a050')));
    assert.match(await themeStyle('Pause'), /--vn-accent: #e0a050/, 'the gallery renders the theme being edited');

    // A white surface under the light default text: the panel warns, the file is saved, every tile restyles.
    await field('surface').locator('input[type=text]').fill('#ffffff');
    await field('surface').locator('input[type=text]').press('Tab');
    await field('text').locator('.td-warn').waitFor();
    assert.match(await field('text').locator('.td-warn').innerText(), /^Contrast 1\.\d:1 with surface \(aim for 4\.5:1\)$/);
    for (let i = 0; !saved.length && i < 50; i++) await page.waitForTimeout(100);
    assert.deepEqual(JSON.parse(saved.at(-1)).tokens, { accent: '#e0a050', surface: '#ffffff' });
    await until(page, () => [...document.querySelectorAll('#themePanel iframe')].every(f => f.contentDocument?.getElementById('themeStyle')?.textContent.includes('--vn-surface: #ffffff')));

    // Clicking the selected options tab inside the gallery opens that component and state in the Components tab.
    await tile('Options').evaluate(f => f.contentDocument.querySelector('#tabAudio').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await panel.locator('.td-comp').waitFor();
    assert.equal(await panel.locator('.td-comp').inputValue(), 'tab');
    assert.equal(await panel.locator('.td-state').inputValue(), 'selected');
    await tile('Text box').evaluate(f => f.contentDocument.querySelector('#name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await until(page, () => document.querySelector('#themePanel .td-comp')?.value === 'namebox');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
