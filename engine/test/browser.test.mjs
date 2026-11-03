// Browser-level tests for the game shell: the dev server runs on the sample project and a real Chromium-family
// browser (driven by playwright-core) plays park.vn and demo.vn through the title screen, the text box, choices,
// skip/auto, rollback, quick save, menus, the name prompt, save/load screens, history, gallery and NVL.
// The browser is the system's Edge or Chrome (set VN_BROWSER to an executable to use another one). Without
// playwright-core or a browser the tests are skipped, so `npm test` still works everywhere.
// Tests hard-code the start of park.vn (see CLAUDE.md), and need the build in dist/ (`npm test` does that).
import { before, after, describe, test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
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

let server, browser, base, skipReason, snapshot;

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
  const port = await freePort();
  base =`http://localhost:${port}/`;
  server = spawn(process.execPath, ['preview/dev-server.mjs', '--no-build', '--no-art'], {
    cwd: root, env: { ...process.env, PORT: String(port), VN_DIST_ROOT: snapshot }, stdio: 'ignore',
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
  const buttons = await page.locator('#titleNav button:visible').allInnerTexts();
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
  assert.equal(await page.locator('#quick [aria-pressed="true"]').count(), 0);
});

play('with "skip unread" on, Tab skips through the lines and stops at the choice', async page => {
  await page.locator('#titleOptions').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await page.locator('#options [role="tab"]', { hasText: 'Game' }).click();
  await page.locator('#optSkip').selectOption('all');
  await page.keyboard.press('Escape');
  await page.locator('#options').waitFor({ state: 'hidden' });
  await newGame(page);
  await page.keyboard.press('Tab');
  await menuOpen(page);
  assert.equal(await page.locator('#menu button').count(), 2);
  assert.equal(await page.locator('#quick [aria-pressed="true"]').count(), 0); // the choice ended the skipping
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
  await page.locator('#pause').waitFor({ state: 'visible' });
  await page.locator('#pause').getByRole('button', { name: 'Options' }).click();
  await page.locator('#options').waitFor({ state: 'visible' });
  const tabs = await page.locator('#options [role="tab"]').allInnerTexts();
  assert.deepEqual(tabs, ['Audio', 'Game', 'Accessibility']);
  await page.locator('#options [role="tab"]', { hasText: 'Accessibility' }).click();
  assert.equal(await page.locator('#options [role="tab"][aria-selected="true"]').innerText(), 'Accessibility');
  await page.keyboard.press('Escape');
  await page.locator('#options').waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await page.locator('#pause').waitFor({ state: 'hidden' });
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

const slotCards = page => page.locator('#slotGrid .slot');
const slotButton = (page, n) => page.locator('#slotGrid .slot-main').nth(n);
const confirmYes = page => page.locator('#confirm').getByRole('button', { name: 'Yes' }).click();
async function openPause(page, button) {
  await page.keyboard.press('Escape');
  await page.locator('#pause').waitFor({ state: 'visible' });
  await page.locator('#pause').getByRole('button', { name: button }).click();
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
  await until(page, () => document.querySelector('#slotGrid .del'));
  assert.match(await slotButton(page, 0).innerText(), /Alice/);
  await slotButton(page, 0).click(); // a filled slot asks before overwriting
  await page.locator('#confirm').waitFor({ state: 'visible' });
  assert.match(await page.locator('#confirmText').innerText(), /Overwrite/);
  await page.locator('#confirm').getByRole('button', { name: 'No' }).click();
  await page.locator('#confirm').waitFor({ state: 'hidden' });
  // Back to the title and load it from there.
  await page.keyboard.press('Escape'); // closes the saves screen
  await page.locator('#saves').waitFor({ state: 'hidden' });
  await page.locator('#pause').getByRole('button', { name: 'Main menu' }).click();
  await confirmYes(page);
  await page.locator('#titleLoad').click();
  await page.locator('#saves').waitFor({ state: 'visible' });
  await slotButton(page, 0).click(); // no game is running, so no confirmation
  await until(page, s => document.getElementById('status').textContent === s, saved);
  assert.equal(await page.locator('#name').innerText(), 'Alice');
  // Delete it again.
  await openPause(page, 'Save');
  await page.locator('#slotGrid .del').click();
  await confirmYes(page);
  await until(page, () => !document.querySelector('#slotGrid .del'));
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some(k => /slot/i.test(k) && localStorage[k].includes('Alice'))), false);
});

play('load screen: empty slots are disabled and the Q and C pages list quick and choice saves', async page => {
  await newGame(page);
  await toChoice(page);
  await page.keyboard.press('F5');
  await page.keyboard.press('1'); // the choice writes a "before choice" autosave
  await until(page, () => /Lost\?/.test(document.getElementById('text').textContent));
  await openPause(page, 'Load');
  assert.equal(await page.locator('#slotGrid .slot-main:not([disabled])').count(), 0); // page 1 has no manual saves
  await page.locator('#savePages [aria-label="Quick save"]').click();
  assert.equal(await page.locator('#slotGrid .slot-main:not([disabled])').count(), 1);
  await page.locator('#savePages [aria-label="Choice autosaves"]').click();
  assert.ok(await page.locator('#slotGrid .slot-main:not([disabled])').count() >= 1);
});

play('choice autosave: loading the newest one goes back before the decision, with the menu open again', async page => {
  await newGame(page);
  await toChoice(page);
  await page.keyboard.press('1');
  await until(page, () => /Lost\?/.test(document.getElementById('text').textContent));
  await openPause(page, 'Load');
  await page.locator('#savePages [aria-label="Choice autosaves"]').click();
  assert.equal(await page.locator('#slotGrid .slot-main:not([disabled])').count(), 1);
  await page.locator('#slotGrid .slot-main:not([disabled])').first().click();
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
  await page.locator('#history').waitFor({ state: 'visible' });
  const rows = await page.locator('#historyList li').allInnerTexts();
  assert.match(rows[0], /^The park was nearly empty\./);
  assert.ok(rows.length >= 1 && !rows.some(r => /Nothing yet/.test(r)));
  await page.keyboard.press('Escape');
  await page.locator('#history').waitFor({ state: 'hidden' });
});

play('gallery: opens from the title screen, locked tiles are disabled, Escape goes back', async page => {
  await page.locator('#titleGallery').click();
  await page.locator('#gallery').waitFor({ state: 'visible' });
  const count = await page.locator('#galleryGrid .tile').count();
  assert.ok(count > 0);
  assert.match(await page.locator('#galleryCount').innerText(), new RegExp('^[0-9]+ / ' + count + '$'));
  assert.equal(await page.locator('#galleryGrid .tile:disabled').count() + await page.locator('#galleryGrid .tile:not(:disabled)').count(), count);
  await page.keyboard.press('Escape');
  await page.locator('#gallery').waitFor({ state: 'hidden' });
  await page.locator('#titleNav').waitFor({ state: 'visible' });
});

play('extras: music room and chapters start locked, unlock as the story plays, and a chapter starts a new playthrough there', async page => {
  await page.locator('#titleChapters').click();
  await page.locator('#chapters').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#chapterList .row').count(), 2);
  assert.equal(await page.locator('#chapterList .row:disabled').count(), 2);
  assert.equal(await page.locator('#chapterCount').innerText(), '0 / 2');
  await page.keyboard.press('Escape');
  await page.locator('#titleMusic').click();
  await page.locator('#musicList .row:disabled').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#musicRoom').waitFor({ state: 'hidden' });

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
  await page.locator('#pause').getByRole('button', { name: 'Main menu' }).click();
  await confirmYes(page);
  await page.locator('#titleNav').waitFor({ state: 'visible' });

  await page.locator('#titleMusic').click();
  await page.locator('#musicRoom').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#musicCount').innerText(), '1 / 1');
  await page.locator('#musicList .row').click();
  assert.match(await page.locator('#musicNow').innerText(), /Evening Theme/);
  await page.keyboard.press('Escape');
  await page.locator('#musicRoom').waitFor({ state: 'hidden' });

  await page.locator('#titleChapters').click();
  assert.equal(await page.locator('#chapterCount').innerText(), '2 / 2');
  await page.locator('#chapterList .row', { hasText: 'A talk' }).click();
  await until(page, () => document.getElementById('box').dataset.visible === 'true');
  await until(page, () => /Sit. We need to talk anyway/.test(document.getElementById('text').textContent));
});


play('achievements: the list shows endings and achievements apart with counts, and an unlock pops up the toast', async page => {
  await page.evaluate(() => localStorage.setItem('vn.evening-in-the-park.unlocked', JSON.stringify(['town_visit'])));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleAchievements').click();
  await page.locator('#achievements').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#achievementCount').innerText(), 'Endings 0 / 1 · Achievements 1 / 1');
  assert.deepEqual(await page.locator('#achievementList h3').allInnerTexts(), ['Endings', 'Achievements']);
  // Locked but not `hidden`: the title and description show (only hidden entries read "???").
  assert.match(await page.locator('#achievementList .ach-row[data-locked="true"]').innerText(), /^A thank-you note\s+Find what was left in town\.$/);
  assert.match(await page.locator('#achievementList .ach-row[data-locked="false"]').innerText(), /Into town\s+Leave the park behind\./);
  await page.keyboard.press('Escape');
  await page.locator('#achievements').waitFor({ state: 'hidden' });

  await page.evaluate(() => window.postMessage({ type: 'screen', name: 'achievement_toast' }, location.origin));
  await until(page, () => document.getElementById('achToast').dataset.show === 'true');
  assert.equal(await page.locator('#achToastHead').innerText(), 'ENDING REACHED'); // the sample's first entry is an ending
  assert.equal(await page.locator('#achToastTitle').innerText(), 'A thank-you note');
  assert.equal(await page.locator('#achToast').getAttribute('data-position'), 'topright');
});

// localStorage key of a per-game value (the sample's game id is the slug of its title).
const gameKey = key => `vn.evening-in-the-park.${key}`;

play('gallery: seen backgrounds are unlocked tiles that open a viewer, arrows page through it', async page => {
  // Playing shows bg_park_evening, which unlocks its tile; bg_park_night stays locked until it has been on screen.
  await newGame(page);
  await until(page, k => localStorage.getItem(k)?.includes('bg_park_evening'), gameKey('images'));
  await page.keyboard.press('Escape');
  await page.locator('#pause').getByRole('button', { name: 'Main menu' }).click();
  await confirmYes(page);
  await page.locator('#titleGallery').click();
  await page.locator('#gallery').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#galleryCount').innerText(), '1 / 2');
  const tiles = page.locator('#galleryGrid .tile');
  assert.equal(await tiles.nth(0).isDisabled(), false);
  assert.match(await tiles.nth(0).innerText(), /Evening park/);
  assert.equal(await tiles.nth(1).isDisabled(), true);
  assert.match(await tiles.nth(1).innerText(), /Locked/);
  await tiles.nth(0).click();
  await page.locator('#viewer').waitFor({ state: 'visible' });
  assert.match(await page.locator('#viewerTitle').innerText(), /^Evening park/);
  await page.keyboard.press('Escape'); // back to the grid, not the title
  await page.locator('#viewer').waitFor({ state: 'hidden' });
  await page.locator('#gallery').waitFor({ state: 'visible' });
});

play('gallery: with both images seen the viewer pages through them and wraps around', async page => {
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['bg_park_evening', 'bg_park_night'])), gameKey('images'));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleGallery').click();
  assert.equal(await page.locator('#galleryCount').innerText(), '2 / 2');
  await page.locator('#galleryGrid .tile').nth(0).click();
  const title = () => page.locator('#viewerTitle').innerText();
  assert.match(await title(), /^Evening park\s+1 \/ 2/);
  await page.keyboard.press('ArrowRight');
  assert.match(await title(), /^Night park\s+2 \/ 2/);
  await page.keyboard.press('ArrowRight');
  assert.match(await title(), /^Evening park\s+1 \/ 2/);
  await page.keyboard.press('ArrowLeft');
  assert.match(await title(), /^Night park\s+2 \/ 2/);
});

play('Continue is disabled without a save and resumes the newest one, showing its line', async page => {
  assert.equal(await page.locator('#continue').isDisabled(), true);
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  const saved = await status(page);
  await page.keyboard.press('Escape');
  await page.locator('#pause').getByRole('button', { name: 'Main menu' }).click();
  await confirmYes(page);
  await page.locator('#continue').waitFor({ state: 'visible' });
  await until(page, () => !document.getElementById('continue').disabled);
  assert.match(await page.locator('#continueInfo').innerText(), /late|park/i);
  await page.locator('#continue').click();
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
  await page.locator('#titleOptions').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await page.locator('#options [role="tab"]', { hasText: 'Game' }).click();
  assert.deepEqual(await page.locator('#optLang option').allInnerTexts(), ['en', 'fi']);
  await page.locator('#optLang').selectOption('fi');
  await page.keyboard.press('Escape');
  await page.locator('#options').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Uusi peli' }).waitFor(); // the title reloads in Finnish
  assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).lang, gameKey('settings')), 'fi');
  await page.locator('#titleNav button:visible', { hasText: 'Uusi peli' }).click();
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
  await page.locator('#titleOptions').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await page.locator('#options [role="tab"]', { hasText: 'Game' }).click();
  assert.deepEqual(await page.locator('#optLang option').allInnerTexts(), ['en', 'fi']);
  assert.equal(fetchedFinnish.length, 0, 'listed, not fetched, until picked');
  await page.locator('#optLang').selectOption('fi');
  await page.keyboard.press('Escape');
  await page.locator('#options').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Uusi peli' }).waitFor();
  await page.locator('#titleNav button:visible', { hasText: 'Uusi peli' }).click();
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
  assert.equal(await page.locator('#options [role="tab"][aria-selected="true"]').innerText(), 'Game');
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
  await page.evaluate(() => window.postMessage({ type: 'goto', file: 'demo.vn', line: 99 }, location.origin));
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

    page.once('dialog', d => d.accept());
    await row('demo_b.vn').click();
    await until(page, () => document.activeElement?.dataset.key === 'script/side/demo_b.vn');
    await page.keyboard.press('Delete');
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
    page.once('dialog', d => d.accept());
    await row.click();
    await until(page, () => document.activeElement?.dataset.key === 'script/demo.vn');
    await page.keyboard.press('Delete');
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

test('animation studio: the mouth and blink fields are written to rig.json by Apply', async t => {
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
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    const studio = page.locator('#animStudio');
    await studio.locator('.as-tab[data-tab="char"]').click();
    await studio.locator('.as-sp-vars').waitFor();
    const field =async (sel, v) => { await studio.locator(sel).fill(v); await studio.locator(sel).press('Tab'); };
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
    assert.deepEqual(rig.speak, { variants: ['open', 'neutral'], rate: 6 });
    assert.deepEqual(rig.blink, { every: [2, 6], dur: 0.2 });
    assert.ok(rig.animations && rig.pivots && rig.idle, 'the rest of the file stays');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: fills a 1280x720 window, every tab opens by keyboard, focus starts inside', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    const studio = page.locator('#animStudio');
    await studio.locator('.as-tab').first().waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.closest('#animStudio') !== null), true, 'focus starts inside the studio');
    const fits = await studio.locator('.as-card').evaluate(c => c.scrollHeight <= c.clientHeight + 1);
    assert.equal(fits, true, 'the studio does not need to scroll at 1280x720');
    const controls = { key: '.as-key', part: '.as-pick', char: '.as-sp-vars', stage: '.as-place-btn' };
    await studio.locator('.as-tab[data-tab="key"]').focus();
    for (const name of Object.keys(controls)) {
      assert.equal(await studio.locator(`.as-tab[data-tab="${name}"]`).getAttribute('aria-selected'), 'true', `${name} tab is selected`);
      assert.equal(await studio.locator(controls[name]).isVisible(), true, `${name} tab shows ${controls[name]}`);
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Escape');
    assert.equal(await studio.isHidden(), true, 'Esc closes the studio from a tab');
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

test('animation studio: the Parts tree dresses the stage, and picking shows the other pivots as one ring', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    const studio = page.locator('#animStudio');
    await studio.locator('.as-tab[data-tab="part"]').click();
    await studio.locator('.as-tree .as-row').first().waitFor();
    const kinds = await studio.locator('.as-tree .as-badge').allTextContents();
    assert.ok(['slot', 'layer', 'group'].every(k => kinds.includes(k)), `the tree names slots, layers and groups, saw ${kinds}`);
    assert.ok(await studio.locator('.as-tree img').count() > 0, 'parts and variants have thumbnails');
    const options = () => studio.locator('.as-part option').allTextContents();
    assert.ok(!(await options()).some(o => o.includes('hidden in this pose')), 'nothing is hidden by default');
    const none = studio.locator('.as-tree [data-variant="none"]').first();
    await none.click();
    assert.ok((await options()).some(o => o.includes('hidden in this pose')), 'a slot set to none hides its part');
    assert.equal(await none.getAttribute('aria-pressed'), 'true');
    await none.click(); // again: back to what the pose picks
    assert.ok(!(await options()).some(o => o.includes('hidden in this pose')));
    await studio.locator('.as-list button', { hasText: 'head_tilt' }).click();
    assert.notEqual(await studio.locator('.as-part').inputValue(), '', 'an animation that only keys parts opens at one of them');
    await studio.locator('.as-part').selectOption('face'); // opens the Parts tab
    assert.equal(await studio.locator('.as-tab[data-tab="part"]').getAttribute('aria-selected'), 'true');
    assert.equal(await studio.locator('.as-tree .as-row[data-part="face"]').getAttribute('aria-pressed'), 'true', 'the tree marks the chosen part');
    await studio.locator('.as-pick').click();
    const stage = page.frameLocator('#animStudio iframe');
    const visible = () => stage.locator('div[title]').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.title));
    let rings = [];
    for (let i = 0; !rings.length && i < 30; i++) { rings = await visible(); if (!rings.length) await page.waitForTimeout(100); }
    assert.equal(rings.length, 1, 'parts sharing a pivot are one ring');
    assert.ok(rings[0].includes('mouth') && !rings[0].includes('face'));
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
});

// ---- custom screens (sample/script/screens.vn): clicks, keys and a pad pick elements; the answer drives the story ----
const screensVn = readFileSync(path.join(root, 'sample/script/screens.vn'), 'utf8').split('\n');
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
  assert.equal(await page.locator('#quick').isHidden(), true);
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
  assert.equal(await page.locator('#newGame').isHidden(), true);
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
  await page.locator('#optBack').click();
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
  await page.locator('#pauseOptions').click();
  await until(page, () => document.getElementById('optionsui').dataset.visible === 'true');
  assert.equal(await page.locator('#options .panel').isHidden(), true);
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
  await page.locator('#resume').waitFor({ state: 'visible' });
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
  assert.equal(await page.locator('#saves .saves-panel').isHidden(), true);
  const slots = page.locator('#savesui [data-act="slot"]');
  assert.equal(await slots.count(), 6);
  assert.equal(await page.locator('#savesui [data-act="page"]').count(), 9); // Save has no auto/quick/choice pages
  assert.match(await slots.first().textContent(), /Slot 1 .*Empty/i);
  await slots.first().click(); // an empty slot saves at once
  await until(page, () => /Alice/.test(document.querySelector('#savesui [data-act="slot"]').textContent));
  await slots.first().click(); // a filled slot asks before overwriting
  await page.locator('#confirm').waitFor({ state: 'visible' });
  await until(page, () => document.getElementById('savesui').dataset.visible === 'false');
  await page.locator('#confirm').getByRole('button', { name: 'No' }).click();
  await until(page, () => document.getElementById('savesui').dataset.visible === 'true');
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
  await page.locator('#pause').waitFor({ state: 'visible' });
}, async context => {
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    proj.scripts.push({ file: 'saves.vn', text: 'screen saves:\n  each pages as pg at 100,50 step 140,0:\n    button pg at 0,0 "[pg.name]" action page\n  each slots as slot at 100,200 step 0,110:\n    button slot at 0,0 size 1100,96 "[slot.title] [slot.when] [slot.text]" action slot enabled mode == "save" or not slot.empty\n  button del at 1400,200 "Delete" action delete\n  button done at 1400,900 "Back" action close\n' });
    await route.fulfill({ response: res, json: proj });
  });
});

// ---- a project's `screen history` replaces the stock history panel, with a scroll area ----
play('history: a screen named history lists the lines in a scroll area that starts at the end; wheel and keys scroll it, close goes back', async page => {
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  await textDone(page);
  await page.keyboard.press('l');
  await until(page, () => document.getElementById('historyui').dataset.visible === 'true');
  assert.equal(await page.locator('#history .history-panel').isHidden(), true);
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

// ---- a project's `screen gallery` replaces the stock gallery ----
play('gallery screen: a screen named gallery draws the tiles; locked ones are disabled, a tile opens the viewer and Escape returns to it', async page => {
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['bg_park_evening'])), gameKey('images'));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleGallery').click();
  await until(page, () => document.getElementById('galleryui').dataset.visible === 'true');
  assert.equal(await page.locator('#gallery .saves-panel').isHidden(), true);
  const tiles = page.locator('#galleryui [data-act="tile"]');
  assert.deepEqual(await tiles.evaluateAll(els => els.map(e => [e.dataset.id, e.textContent, e.getAttribute('aria-disabled')])), [['1', 'Evening park', null], ['2', 'Locked', 'true']]);
  assert.equal(await page.locator('#galleryui .sc-scroll img.sc-img').count(), 1); // only the unlocked tile has its picture
  assert.match(await page.locator('#galleryui .sc-text').innerText(), /1 of 2/);
  await tiles.nth(0).click();
  await page.locator('#viewer').waitFor({ state: 'visible' });
  assert.match(await page.locator('#viewerTitle').innerText(), /^Evening park/);
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

// ---- a project's `screen viewer` replaces the stock picture viewer (here over the stock gallery) ----
play('viewer screen: a screen named viewer shows the picture and title; next and prev page and wrap, Escape returns to the gallery', async page => {
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['bg_park_evening', 'bg_park_night'])), gameKey('images'));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleGallery').click();
  await page.locator('#galleryGrid .tile').nth(0).click();
  await until(page, () => document.getElementById('viewerui').dataset.visible === 'true');
  const text = () => page.locator('#viewerui .sc-text').innerText();
  await until(page, () => /^Evening park 1\/2/.test(document.querySelector('#viewerui .sc-text')?.textContent ?? ''));
  assert.equal(await page.locator('#viewerui img.sc-img').count(), 1);
  assert.equal(await page.locator('#viewerTitle').isHidden(), true); // the stock title is replaced
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

// ---- a project's `screen music` and `screen chapters` replace the stock music room and chapter select ----
play('music screen: a screen named music lists the tracks; a track plays, Stop and Back leave', async page => {
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify(['evening_theme'])), gameKey('music'));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.locator('#titleMusic').click();
  await until(page, () => document.getElementById('musicui').dataset.visible === 'true');
  assert.equal(await page.locator('#musicRoom .saves-panel').isHidden(), true);
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
  await page.locator('#titleChapters').click();
  await until(page, () => document.getElementById('chaptersui').dataset.visible === 'true');
  assert.equal(await page.locator('#chapters .saves-panel').isHidden(), true);
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
  assert.equal(await page.locator('#resume').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#pauseui [data-id]')].map(e => e.dataset.act)), ['resume', 'options']);
  await page.locator('#pauseui [data-act="options"]').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await until(page, () => document.getElementById('pauseui').dataset.visible === 'false');
  await page.locator('#optBack').click();
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
  assert.equal(await page.locator('#quick [data-q="voice"]').isVisible(), true, 'the first line (joce) has a recording');
  assert.equal(await page.locator('#optVoice').count(), 1, 'the options have a voice slider');
  const played = () => page.evaluate(() => window.__voiceStarts ?? 0);
  await page.keyboard.press('v');
  await page.locator('#quick [data-q="voice"]').click();
  await until(page, () => (window.__voiceStarts ?? 0) >= 2);
  assert.ok(await played() >= 2);
  await page.evaluate(() => document.activeElement.blur()); // a focused button would take the Space
  await page.keyboard.press('Space'); // the next line has no recording
  await until(page, () => document.querySelector('#quick [data-q="voice"]').hidden === true);
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
  await page.locator('#pause').waitFor({ state: 'visible' });
  const held = await barScale(page);
  assert.ok(held > 0 && held <= 1);
  await page.waitForTimeout(1500);
  assert.equal(await barScale(page), held);
  assert.equal(await page.locator('#menu[data-visible="true"]').count(), 1);
}, withTimedStart(4));

play('timed menu: with Timed choices off there is no clock and the player can wait', async page => {
  await page.locator('#titleOptions').click();
  await page.locator('#options').waitFor({ state: 'visible' });
  await page.locator('#tabAccess').click();
  await page.locator('#optTimed').selectOption('off');
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
  const lines = readFileSync(path.join(root, 'sample/script', file), 'utf8').split('\n');
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
  assert.equal(await page.locator('#status').innerText(), 'added assets/bg/new_bg.png; assets/bg/bg_park_night.png exists');
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
  await frame.locator('#history').waitFor({ state: 'visible' });
  assert.equal(await frame.locator('#options').isHidden(), true);
  assert.equal(await screenRow('History').getAttribute('aria-current'), 'true');
});

describe('browser', { concurrency: Math.max(1, Number(process.env.VN_BROWSER_JOBS) || 6) }, () => {
  for (const args of queued) nodeTest(...args);
});
