// Browser-level tests for the game shell: the dev server runs on the sample project and a real Chromium-family
// browser (driven by playwright-core) plays park.vn and demo.vn through the title screen, the text box, choices,
// skip/auto, rollback, quick save, menus, the name prompt, save/load screens, history, gallery and NVL.
// The browser is the system's Edge or Chrome (set VN_BROWSER to an executable to use another one). Without
// playwright-core or a browser the tests are skipped, so `npm test` still works everywhere.
// Tests hard-code the start of park.vn (see CLAUDE.md), and need the build in dist/ (`npm test` does that).
import { before, after, describe, test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { inflateSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { launchBrowser, root, startDevServer } from './helpers.mjs';

let server, browser, base, skipReason, snapshot, sampleCopy;

// Every test has its own browser context (own localStorage, own mocked /api routes) and the dev server is read-only here,
// so they do not interact: they are collected and run VN_BROWSER_JOBS at a time (default 6; 1 runs them in order) by the suite at the
// end of the file. 6 jobs take ~100 s now (more tests, heavier pages) against ~400 s for 1. A test that fails only in a full
// run is a race with a loaded page (focus taken by a late load, an assertion right after an async layout): retry it with
// VN_BROWSER_JOBS=1, and see docs/design/flaky-tests.md before adding a fixed wait.
const queued = [];
// The suite at the end of the file runs the queue where it stands: a test registered after it would silently never run.
let queueRun = false;
const test = (...args) => {
  if (queueRun) throw new Error(`test "${args[0]}" is defined after the describe('browser') block, so it would never run: move it above`);
  queued.push(args);
};

before(async () => {
  ({ browser, skip: skipReason } = await launchBrowser());
  if (!browser) return;
  // The editor keeps loading after `load` (the project, the git status, the file tree, Monaco's workers) and takes the focus
  // from whatever a test has started on a loaded machine (a palette query, an Escape meant for a dialog): a page that opens
  // the editor is let settle first.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await newContext(...args);
    context.on('page', page => {
      const goto = page.goto.bind(page);
      page.goto = async (url, options) => {
        const response = await goto(url, options);
        if (/\/editor\/?(\?|$)/.test(url)) await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        return response;
      };
    });
    return context;
  };
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
  const started = await startDevServer({ env: { VN_DIST_ROOT: snapshot, VN_PROJECT: sampleCopy } });
  server = started.server;
  base = `${started.origin}/`;
});

after(async () => {
  await browser?.close();
  server?.kill();
  if (snapshot) rmSync(snapshot, { recursive: true, force: true });
});

/** Serves `/api/project` on `target` (a context or a page) as the real project changed by `edit(proj)`. */
const patchProject = (target, edit) => target.route('**/api/project', async route => {
  const res = await route.fetch();
  const proj = await res.json();
  await edit(proj);
  await route.fulfill({ response: res, json: proj });
});

/**
 * A test on a fresh browser context (`options` for newContext: empty localStorage, so no saves or settings leak between
 * tests) and one page in it, not yet navigated. `errors` collects the page's uncaught errors; the context closes afterwards.
 * Routes and init scripts added to the context in `fn` still apply to the page, as long as they come before its goto.
 */
function browserTest(name, options, fn) {
  test(name, async t => {
    if (skipReason) { t.skip(skipReason); return; }
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await fn({ t, context, page, errors });
    } finally {
      await context.close();
    }
  });
}

// The game on the title screen; `setup(context)` runs first (mocked routes).
function play(name, fn, setup) {
  browserTest(name, { viewport: { width: 1280, height: 760 } }, async ({ context, page, errors }) => {
    await setup?.(context);
    await page.goto(base);
    await page.getByRole('button', { name: 'New game' }).waitFor();
    await fn(page);
    assert.deepEqual(errors, [], 'the page threw errors');
  });
}

const text = page => page.locator('#text').innerText();
const status = page => page.locator('#status').innerText();
// A generous wait: it costs time only when a test is failing anyway, and a machine that is busy with something else
// (another build, a virus scan) stalled the typing timers past the old 8 s now and then, in a different test each time.
// A timeout says what the page looked like (a flake used to say only "Timeout 20000ms exceeded"): whether it was
// visible, the editor's toast and the palette's list.
const until = async (page, fn, arg) => {
  try {
    return await page.waitForFunction(fn, arg, { timeout: 20000 });
  } catch (e) {
    const seen = await page.evaluate(() => JSON.stringify({
      visibility: document.visibilityState, focus: document.hasFocus(),
      toast: document.querySelector('#toast span')?.textContent ?? null,
      palette: [...document.querySelectorAll('#paletteList li')].map(li => li.textContent).slice(0, 5),
      dialogs: [...document.querySelectorAll('dialog[open], #gitCommit:not([hidden])')].map(d => `${d.id || d.className}: ${d.textContent.replace(/\s+/g, ' ').slice(0, 200)}`),
    })).catch(() => 'the page is gone');
    throw new Error(`${e.message.split('\n')[0]}\nPage state: ${seen}`, { cause: e });
  }
};
// For a condition the test side sees (mocked saves, a value read through a locator): checks `done()` and waits `every` ms
// until it holds, at most `tries` times. It does not throw: the assert after it says what was wrong.
const poll = async (page, done, tries = 40, every = 100) => {
  for (let i = 0; i < tries && !(await done()); i++) await page.waitForTimeout(every);
};
// Bind parts… opens the picker in the right column: tick the parts by name and press Bind.
const bindParts = async (studio, ...names) => {
  await studio.locator('.ab-bind').click();
  for (const n of names) await studio.locator(`.ab-picklist label:has(span:text-is("${n}")) input`).check();
  await studio.locator('.ab-pickgo').click();
};
const newGame = async page => {
  await page.getByRole('button', { name: 'New game' }).click();
  await until(page, () => document.getElementById('box').dataset.visible === 'true');
};
const textDone = page => until(page, () => document.getElementById('box').dataset.done === 'true');
const menuOpen = page => until(page, () => document.getElementById('menu').dataset.visible === 'true');
// Click the stage's corner until the choice menu is up: finishes the typing and moves through the lines before it. Not Space:
// on a loaded page the menu can open between the check and the key, and Space on the menu's focused first option picks it
// (a click on the stage is ignored while a menu is open).
async function toChoice(page) {
  for (let i = 0; i < 12; i++) {
    if (await page.locator('#menu[data-visible="true"]').count()) return;
    await textDone(page).catch(() => {});
    await page.locator('#stage').click({ position: { x: 4, y: 4 } });
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
  await patchProject(context, proj => {
    for (const s of proj.scripts) if (s.file === 'park.vn') s.text = s.text.replace('The park was nearly empty. Only one bench was occupied.', LONG_LINE);
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

// UX round EP-1 and EP-4: the sample's characters open with the problems they had (the schema does not add its own), and the
// Problems count, which includes rigs that are not open, can be followed: a click opens one.
inEditor('problems: opening the rig.json tabs adds no schema warnings, and a click on the count opens a rig that has some', async page => {
  const count = () => page.locator('#problems').innerText();
  assert.equal(await count(), 'Problems: 3');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#tabs .tab [role=tab]')].filter(t => t.textContent.endsWith('rig.json')).length), 0);
  await page.locator('#problems').click();
  await until(page, () => document.querySelector('#tabs .tab[data-selected="true"] [role=tab]')?.textContent.endsWith('rig.json'));
  await page.locator('#sbList .item', { hasText: 'psd · rig.json' }).filter({ hasText: 'mina' }).first().click();
  await page.locator('#sbList .item', { hasText: 'psd · rig.json' }).filter({ hasText: 'robo' }).first().click();
  await page.waitForTimeout(800);
  assert.equal(await count(), 'Problems: 3', 'the sample rigs open clean');
});

// UX round PC-1 and PC-2. A key meant to read the line must not pick for the player as the choices come up: Space or Enter
// tapped as they appear, or held (auto-repeat) through them. And Tab onto the quick menu's Back must not leave it the next Space.
// The menu is waited for frame by frame, so the key follows it by a few milliseconds, as a player's second tap would.
const toChoiceAtOnce = async page => {
  let seen = false;
  const shown = page.evaluate(() => new Promise(r => { const tick = () => (document.getElementById('menu').dataset.visible === 'true' ? r() : requestAnimationFrame(tick)); tick(); }));
  shown.then(() => { seen = true; });
  for (let i = 0; i < 12 && !seen; i++) {
    await textDone(page).catch(() => {});
    if (seen) break;
    await page.locator('#stage').click({ position: { x: 4, y: 4 } });
    await Promise.race([page.waitForTimeout(150), shown]);
  }
  await shown;
};
play('choices: Space or Enter as the menu appears, or a held key, picks nothing; a press a moment later picks the focused option', async page => {
  await newGame(page);
  await toChoiceAtOnce(page);
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#menu').getAttribute('data-visible'), 'true', 'a tap as the choices appear picks nothing');
  await page.waitForTimeout(350); // the guard is over: a held key is the next case
  await page.keyboard.down('Space');
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(40); await page.keyboard.down('Space'); } // auto-repeat
  await page.keyboard.up('Space');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#menu').getAttribute('data-visible'), 'true', 'a key held through the choices picks nothing when let go');
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('menu').dataset.visible !== 'true');
  await until(page, () => /Sorry, I got lost|Don't flatter yourself|You didn't have to wait|Sorry/.test(document.getElementById('text').textContent) || document.getElementById('name').textContent !== '');
});

play('choices: Tab onto the quick menu, then a number key, leaves no button focused to undo the pick', async page => {
  await newGame(page);
  await toChoice(page);
  await page.waitForTimeout(400);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.getElementById('menu').contains(document.activeElement)), false, 'focus went on to the quick menu');
  await page.keyboard.press('2');
  await until(page, () => /Don't flatter yourself/.test(document.getElementById('text').textContent));
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'no button keeps the focus');
  await textDone(page);
  await page.keyboard.press('Space'); // the story goes on; it does not roll back to the menu
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#menu').getAttribute('data-visible') === 'true', false);
});

play('choices: arrow keys move focus and Enter picks', async page => {
  await newGame(page);
  await toChoice(page);
  await page.waitForTimeout(350); // an Enter before that is taken for the key that read the line (PC-1)
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "You didn't have to wait.");
  await page.keyboard.press('Enter');
  await until(page, () => /Don't flatter yourself/.test(document.getElementById('text').textContent));
});

// Script transforms run in the renderer: a picture attached to one whose condition holds moves, one whose condition is false
// stays put. The pictures are placeholders (no such files), well away from the characters and the text box.
play('transforms: an automatic transform moves its picture while its condition holds, and a false one does not', async page => {
  await newGame(page);
  await textDone(page);
  const box = await page.locator('canvas#canvas').boundingBox();
  const regions = {
    moving: { x: box.x, y: box.y + box.height * 0.06, width: box.width * 0.3, height: box.height * 0.4 },
    still: { x: box.x + box.width * 0.66, y: box.y + box.height * 0.14, width: box.width * 0.24, height: box.height * 0.28 },
  };
  const shots = { moving: [], still: [] };
  for (let i = 0; i < 8; i++) {
    for (const [name, clip] of Object.entries(regions)) shots[name].push(await page.screenshot({ clip }));
    await page.waitForTimeout(150);
  }
  const distinct = list => new Set(list.map(b => b.toString('base64'))).size;
  assert.ok(distinct(shots.moving) > 1, 'the picture on the running transform changes between frames');
  assert.equal(distinct(shots.still), 1, 'the picture whose condition is false does not move');
}, async context => {
  await patchProject(context, proj => {
    for (const s of proj.scripts) if (s.file === 'park.vn') {
      const NL = String.fromCharCode(10), block = (...l) => l.join(NL) + NL;
      s.text = s.text
        .replace('set trust = 0' + NL, block('transform lean while trust == 0:', '  rot=-12 0.4s', '  rot=12 0.8s', '  rot=0 0.4s', '', 'transform never while trust > 5:', '  rot=-30 0.4s', '  rot=30 0.4s', '', 'set trust = 0'))
        .replace('  music play evening_theme loop' + NL, block('  music play evening_theme loop', '  image show lamp prop/lamp at 300,300 anchor=center scale=1.5 keep', '  image show lamp2 prop/lamp2 at 1500,300 anchor=center keep', '  animate lamp lean auto', '  animate lamp2 never auto'));
    }
  });
});

// The 2D effects added after the first transforms, played in the real renderer: `camera roll` and zoom with a sustained
// `animate camera shake` (the view jitters and is turned), `move ... tint=` (the character's tint), a choreography, a burst and
// the glitch filter (a shader that has to compile). Each is read from vnStage() or the console, not from pixels.
play('camera shake, roll, tint, flash channels, choreography, burst and the glitch filter run without errors', async page => {
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  await newGame(page);
  await textDone(page);
  await page.locator('#stage').click({ position: { x: 4, y: 4 } }); // past the narration: alice shows and the effects start
  await until(page, () => window.vnStage().some(a => a.char === 'alice'));
  await page.waitForTimeout(900); // the choreography (0.6 s) has ended: only the shake still moves her
  const xs = new Set(), heights = [];
  for (let i = 0; i < 10; i++) {
    const alice = (await stageNow(page)).find(a => a.char === 'alice');
    xs.add(alice.bounds[0]); heights.push(alice.bounds[3]);
    await page.waitForTimeout(70);
  }
  assert.ok(xs.size > 3, `the sustained shake moves the view between frames (saw ${[...xs]})`);
  assert.ok(Math.min(...heights) > 1000, `zoom 1.2 and a roll make her bigger than the normal 940 (saw ${Math.min(...heights)})`);
  const alice = (await stageNow(page)).find(a => a.char === 'alice');
  assert.equal(alice.tint & 0xffffff, 0xff8040, 'move ... tint= multiplies her');
  assert.equal(alice.fxTint & 0xffffff, 0x40ff40, 'the tint= channel of a transform multiplies her on top');
  assert.equal(alice.flashing, 1, 'the flash= channel of a transform puts a filter on her');
  assert.equal(await page.evaluate(() => /Script error/.test(document.body.innerText)), false, 'the new commands and the choreography compile');
  assert.deepEqual(problems.filter(p => !/favicon|ERR_|Failed to load resource/.test(p)), [], 'no console errors or warnings (a shader that fails to compile logs one)');
}, async context => {
  await patchProject(context, proj => {
    for (const s of proj.scripts) if (s.file === 'park.vn') {
      const NL = String.fromCharCode(10), block = (...l) => l.join(NL) + NL;
      s.text = s.text
        .replace('set trust = 0' + NL, block('transform stain:', '  tint=#40ff40 0.05s', '  flash=#ff0000:0.5 0.05s', '  wait 3s', '  repeat', '', 'choreography entrance:', '  0s alice: x=0.02 0.3s', '  0.3s camera: rot=1 0.3s', '', 'set trust = 0'))
        .replace('  show alice neutral at center fade 0.4s' + NL, block('  show alice neutral at center', '  camera zoom 1.2 at center', '  camera roll 4', '  animate camera shake loop strength=2', '  move alice tint=#ff8040', '  burst sparkle at alice', '  filter glitch 0.4', '  perform entrance nowait', '  animate alice stain loop'));
    }
  });
});

// A live `scene` clears the filter, the tint and the weather, as docs/commands.md says (a running glitch used to survive it in the preview).
play('a scene clears a running filter, tint and weather', async page => {
  await newGame(page);
  await textDone(page);
  assert.deepEqual(await page.evaluate(() => window.vnWorld()), { filter: 'glitch', tint: 0.5, weather: 'snow' }, 'on before the scene');
  await page.locator('#stage').click({ position: { x: 4, y: 4 } });
  await until(page, () => /nearly empty/.test(document.getElementById('text')?.textContent ?? ''));
  assert.deepEqual(await page.evaluate(() => window.vnWorld()), { filter: null, tint: 0, weather: null }, 'the scene cleared them');
}, async context => {
  await patchProject(context, proj => {
    const NL = String.fromCharCode(10);
    for (const s of proj.scripts) if (s.file === 'park.vn') s.text = s.text.replace('  scene bg_park_evening fade 0.5s' + NL,
      ['  filter glitch 0.4', '  tint #ff0000 0.5', '  weather snow', '  "Before the scene."', '  scene bg_park_evening', ''].join(NL));
  });
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

// UX round PC-6: rolling back to a choice leaves the line before it in the text box, as the first visit did (and the save made
// there says that line, not the one the picked option led to).
play('PageUp back to a choice shows the line before it under the options', async page => {
  await newGame(page);
  await toChoice(page);
  const line = await text(page), who = await page.locator('#name').innerText();
  assert.ok(line.length > 0);
  await page.waitForTimeout(400); // the guard against a key meant for the line (PC-1)
  await page.keyboard.press('2');
  await until(page, () => /Don't flatter yourself/.test(document.getElementById('text').textContent));
  await textDone(page);
  await page.keyboard.press('PageUp');
  await menuOpen(page);
  assert.equal(await page.locator('#box').getAttribute('data-visible'), 'true');
  assert.equal(await text(page), line);
  assert.equal(await page.locator('#name').innerText(), who);
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
  await patchProject(context, proj => {
    proj.game = { ...proj.game, saveNames: true };
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
  await patchProject(context, proj => {
    proj.game = { ...proj.game, quickMenu: { items: ['options', 'auto', 'nonsense'], position: 'top', align: 'left' } };
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

play('title: with a save to go on from, the focus starts on Continue, so Enter does not start over (UX round PC-3)', async page => {
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.act), 'start', 'with no save, New game is first');
  await newGame(page);
  await textDone(page);
  await page.keyboard.press('Space');
  await until(page, () => document.getElementById('name').textContent === 'Alice');
  await page.keyboard.press('Escape');
  await page.locator('#pauseui').getByRole('button', { name: 'Main menu' }).click();
  await confirmYes(page);
  await until(page, () => document.activeElement?.dataset.act === 'continue');
});

// A second language is injected into the project the page fetches; the sample ships only English.
const withFinnish = async context => {
  await patchProject(context, proj => {
    proj.locales = { ...proj.locales, fi: { 'ui.new_game': 'Uusi peli', joce: 'Puisto oli melkein tyhjä.' } };
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
  await patchProject(context, proj => {
    proj.localeFiles = ['fi'];
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

// Touch gestures (docs/design/mobile.md, step 2): an exported game on an emulated phone, touches sent through the DevTools
// protocol (page.touchscreen only taps). `touch` is game.json's "touch" for the run.
async function onPhone(touch, fn, viewport = { width: 844, height: 390 }, setup) {
  const { compile, packProgram } = await import('../../dist/engine/src/index.js');
  const program = compile([{ file: 'touch.vn', text: 'label start:\n  "One."\n  "Two."\n  "Three."\n  "Four."\n  end' }]);
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  await setup?.(context);
  await context.route(url => url.pathname === '/', async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/<html\b/, '<html data-mode="game"') });
  });
  await context.route('**/project.json', async route => {
    const proj = await (await route.fetch({ url: new URL('/api/project', route.request().url()).href })).json();
    await route.fulfill({ json: { game: { ...proj.game, ...(touch ? { touch } : {}) }, assets: proj.assets, rigs: proj.rigs, locales: {}, program: packProgram(program, 'v1'), engine: '9.9.9' } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base);
    await page.getByRole('button', { name: 'New game' }).waitFor();
    await newGame(page);
    const cdp = await context.newCDPSession(page);
    // Each touch carries the time it happens at (`at`, ms after the gesture began): the page times gestures by the events'
    // timeStamps, so a loaded machine that delivers a lift late does not turn a quick swipe into a slow drag.
    let began = 0;
    const send = (type, x, y, at = 0, points = type === 'touchEnd' ? [] : [{ x, y, id: 0 }]) => {
      if (type === 'touchStart') began = Date.now() / 1000;
      return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points, timestamp: began + at / 1000 });
    };
    // A swipe or a hold on the stage's upper part, away from the text box and the quick bar. A swipe takes 120 ms. The touch
    // down goes out together with the first move (and a tap's down with its up): the long press is a real-time timer, and a
    // test process stalled between the two would let it fire.
    const swipe = async (dx, dy) => {
      const x = 422, y = 120;
      await Promise.all([send('touchStart', x, y), send('touchMove', x + dx / 6, y + dy / 6, 16)]);
      for (let i = 2; i <= 6; i++) { await page.waitForTimeout(15); await send('touchMove', x + (dx * i) / 6, y + (dy * i) / 6, i * 16); }
      await send('touchEnd', x + dx, y + dy, 120);
    };
    const hold = async ms => { await send('touchStart', 422, 120); await page.waitForTimeout(ms); await send('touchEnd', 422, 120, ms); };
    const tap = () => Promise.all([send('touchStart', 422, 120), send('touchEnd', 422, 120, 40)]);
    const advanceTo = async line => {
      // Compare only a line that has finished typing: a tap on a half-typed "One." finishes it, the next goes past it.
      const shown = async () => { await until(page, () => document.getElementById('box').dataset.done === 'true'); return text(page); };
      for (let i = 0; i < 8 && (await shown()) !== line; i++) {
        await tap();
        await page.waitForTimeout(200);
      }
      await until(page, l => document.getElementById('text').textContent === l && document.getElementById('box').dataset.done === 'true', line);
    };
    const twoFingerTap = async () => {
      await send('touchStart', 0, 0, 0, [{ x: 400, y: 120, id: 0 }, { x: 460, y: 120, id: 1 }]);
      await page.waitForTimeout(40);
      await send('touchEnd', 0, 0, 40);
    };
    await fn({ page, swipe, hold, tap, twoFingerTap, advanceTo });
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context.close();
  }
}

test('touch: a tap advances; swipe right rolls back, left does nothing, down hides the interface, up opens the history', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  await onPhone(null, async ({ page, swipe, advanceTo }) => {
    await advanceTo('Three.');
    await swipe(-150, 5);
    await page.waitForTimeout(300);
    assert.equal(await text(page), 'Three.', 'a swipe left never advances');
    await swipe(150, 5);
    await until(page, () => document.getElementById('text').textContent === 'Two.');
    await swipe(5, 120);
    await until(page, () => document.getElementById('stage').dataset.uiHidden === 'true');
    await swipe(5, 120); // the same swipe brings it back
    await until(page, () => document.getElementById('stage').dataset.uiHidden === 'false');
    await swipe(5, -120);
    await until(page, () => document.getElementById('historyui').dataset.visible === 'true');
    assert.equal(await text(page), 'Two.', 'the swipe up opened the history and moved nothing');
  });
});

test('touch: a long press opens the pause menu, a tap with two fingers too, and neither advances the story', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  await onPhone(null, async ({ page, hold, twoFingerTap, advanceTo }) => {
    await advanceTo('Two.');
    await hold(800);
    await page.locator('#pauseui [data-act="resume"]').waitFor({ state: 'visible' });
    assert.equal(await text(page), 'Two.');
    await page.keyboard.press('Escape');
    await page.locator('#pauseui [data-act="resume"]').waitFor({ state: 'hidden' });
    await page.waitForTimeout(500);
    assert.equal(await text(page), 'Two.', 'the click after a long press did not advance');
    await twoFingerTap();
    await page.locator('#pauseui [data-act="resume"]').waitFor({ state: 'visible' });
    assert.equal(await text(page), 'Two.');
  });
});

test('touch: the quick bar is enlarged to a tappable size and stays inside the window', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  await onPhone(null, async ({ page }) => {
    await page.locator('#quickui .sc-btn').first().waitFor({ state: 'visible' });
    await until(page, () => Number(document.getElementById('quickui').style.getPropertyValue('--quick-k')) > 1);
    const boxes = await page.locator('#quickui .sc-btn').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, h: r.height }; }));
    assert.ok(boxes.length >= 4);
    for (const b of boxes) {
      assert.ok(b.h >= 22, `a quick bar button is ${b.h.toFixed(1)} CSS px tall`);
      assert.ok(b.left >= -0.5 && b.right <= 844.5 && b.top >= -0.5 && b.bottom <= 390.5, 'inside the window');
    }
  });
});

test('touch: a tap just above a small button of the pause menu still presses it', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  await onPhone(null, async ({ page, hold, advanceTo }) => {
    await advanceTo('Two.');
    await hold(800);
    const resume = page.locator('#pauseui [data-act="resume"]');
    await resume.waitFor({ state: 'visible' });
    const r = await resume.boundingBox();
    assert.ok(r.height < 40, `the button is small on the phone (${r.height.toFixed(1)} CSS px)`);
    const x = r.x + r.width / 2, y = r.y - 5;
    assert.equal(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('button'), [x, y]), false, 'the tap lands beside the button');
    await page.touchscreen.tap(x, y);
    await resume.waitFor({ state: 'hidden' });
    assert.equal(await text(page), 'Two.', 'it pressed Resume, it did not advance the story');
  });
});

test('touch: dialogue text is never smaller than 16 CSS px on a small phone', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  await onPhone(null, async ({ page }) => {
    const shown = await page.evaluate(() => {
      const stage = document.getElementById('stage');
      const scale = stage.getBoundingClientRect().width / stage.offsetWidth;
      return parseFloat(getComputedStyle(document.getElementById('text')).fontSize) * scale;
    });
    assert.ok(shown >= 15.9, `the dialogue text is ${shown.toFixed(1)} CSS px`);
  }, { width: 640, height: 300 });
});

test('touch: the screen stays on (wake lock) while auto-advance runs, and is let go when it stops', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const fakeWakeLock = context => context.addInitScript(() => {
    window.__wake = { requests: 0, releases: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      window.__wake.requests++;
      return { release: async () => { window.__wake.releases++; }, addEventListener() {} };
    } } });
  });
  await onPhone(null, async ({ page, advanceTo }) => {
    await advanceTo('One.');
    assert.deepEqual(await page.evaluate(() => window.__wake), { requests: 0, releases: 0 });
    await page.keyboard.press('a');
    await until(page, () => window.__wake.requests === 1);
    await page.keyboard.press('a');
    await until(page, () => window.__wake.releases === 1);
  }, undefined, fakeWakeLock);
});

test('pwa export: "pwa": true writes a manifest and a service worker, and the game starts again with the network off', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const dir = mkdtempSync(path.join(tmpdir(), 'vn-pwa-'));
  let site, context;
  try {
    cpSync(path.join(root, 'games/demo'), path.join(dir, 'proj'), { recursive: true });
    const gameFile = path.join(dir, 'proj', 'game.json');
    writeFileSync(gameFile, JSON.stringify({ ...JSON.parse(readFileSync(gameFile, 'utf8')), pwa: true }));
    execFileSync(process.execPath, [path.join(root, 'tools/export-web.mjs'), '--no-build', '--no-playtest'], { env: { ...process.env, VN_PROJECT: path.join(dir, 'proj') }, stdio: 'ignore' });
    const web = path.join(dir, 'proj', 'build', 'web');
    const manifest = JSON.parse(readFileSync(path.join(web, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.display, 'fullscreen');
    assert.match(readFileSync(path.join(web, 'index.html'), 'utf8'), /<link rel="manifest" href="manifest.webmanifest">/);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
    site = http.createServer((req, res) => {
      const file = path.join(web, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
      if (!file.startsWith(web) || !existsSync(file)) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    });
    await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${site.address().port}/`;
    context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.getByRole('button', { name: 'New game' }).waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => 0));
    // the worker has all the files once it has installed: wait for the cache, then take the network away
    await until(page, async () => (await caches.keys()).some(k => k.startsWith('vn-')) && (await (await caches.open((await caches.keys())[0])).keys()).length > 100);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: 'New game' }).waitFor();
    assert.deepEqual(errors, [], 'the page threw errors');
  } finally {
    await context?.close();
    site?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('touch: game.json "touch": { "gestures": false } leaves only the tap', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  await onPhone({ gestures: false }, async ({ page, swipe, hold, advanceTo }) => {
    await advanceTo('Three.');
    await swipe(150, 5);
    await page.waitForTimeout(300);
    assert.equal(await text(page), 'Three.', 'a swipe does not roll back');
    await hold(800); // a hold is only a tap here: no pause menu
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#pauseui [data-act="resume"]').isVisible(), false, 'no pause menu');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-gestures')), false);
  });
});

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
  await page.waitForTimeout(350); // an A before that is taken for the press that read the line (PC-1)
  await tap(page, 0);
  await until(page, () => /Don't flatter yourself/.test(document.getElementById('text').textContent));
}, withPad);

play('gamepad: A pressed as the choices appear picks nothing; a press a moment later picks the focused option', async page => {
  await newGame(page);
  await toChoiceAtOnce(page);
  await tap(page, 0);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#menu').getAttribute('data-visible'), 'true', 'a press as the choices appear picks nothing');
  await page.waitForTimeout(400); // the guard is over
  await tap(page, 0);
  await until(page, () => document.getElementById('menu').dataset.visible === 'false');
}, withPad);

play('NVL: narration fills a full-screen page, a clear starts a new one, off returns to the box', async page => {
  const nvlOn = readFileSync(path.join(root, 'games/sample/script/demo.vn'), 'utf8').split('\n').findIndex(l => l.trim() === 'nvl on') + 1; // not a fixed line: the demo grows above it
  await page.evaluate(line => window.postMessage({ type: 'goto', file: 'demo.vn', line }, location.origin), nvlOn);
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
  await patchProject(context, proj => {
    for (const s of proj.scripts) if (s.file === 'park.vn') s.text = s.text.replace('label start:\n', 'label start:\n  jump nowhere\n');
  });
};

browserTest('a script error shows a banner over the black stage, and clicking it opens the problem list', { viewport: { width: 1280, height: 760 } }, async ({ context, page }) => {
  await withBrokenStart(context);
  await page.goto(base);
  const banner = page.locator('#errBanner');
  await banner.waitFor({ state: 'visible' });
  assert.match(await banner.innerText(), /Script error: Unknown label "nowhere" \(park\.vn:\d+\)/);
  await banner.click();
  assert.equal(await page.locator('#diag').getAttribute('data-visible'), 'true');
});

browserTest('editor: the preview error banner jumps to the line of the error', { viewport: { width: 1400, height: 850 } }, async ({ context, page }) => {
  await withBrokenStart(context);
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
});

test('editor: Follow preview leaves the view where the author types; the autosave and its reload do not pull it to the story (UX round EA-4)', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 600 } });
  await context.route('**/api/script?*', r => r.fulfill({ json: { ok: true } })); // the typing autosaves: the sample stays as it is
  const page = await context.newPage();
  try {
    await page.goto(`${base}editor/`);
    await page.locator('.monaco-editor .view-line').first().waitFor();
    await page.locator('.tab', { hasText: 'park.vn' }).first().click();
    // The preview plays park.vn from its start and reports its line near the top; Follow (on) marks it.
    await until(page, () => !!document.querySelector('.vn-preview-line'));
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('# a note at the end');
    // After the autosave the preview reloads and reports its line again (the save is mocked here, so the report is sent by hand).
    const line = await page.evaluate(() => document.querySelector('.vn-preview-line') ? 1 : 0);
    assert.equal(line, 0, 'the preview line is out of view while typing at the end');
    const preview = page.frames().find(f => f.url().includes('/editor/') === false && f !== page.mainFrame() && f.parentFrame() === page.mainFrame());
    await preview.evaluate(() => parent.postMessage({ type: 'position', file: 'park.vn', line: 13 }, location.origin));
    await page.waitForTimeout(500);
    const visible = await page.locator('.monaco-editor .view-line', { hasText: '# a note at the end' }).count();
    assert.equal(visible, 1, 'the line being typed is still in view');
  } finally { await context.close(); }
});

test('editor: a script changed outside while its tab had unsaved edits is not overwritten; the bar compares, keeps mine or takes theirs (UX round EL-18)', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const THEIRS = 'label start:\n  "Changed in another editor."\n';
  const puts = [];
  let refuse = 1; // the next save(s) find the file changed on disk
  await context.route('**/api/script?*', r => {
    if (r.request().method() !== 'PUT') return r.fallback();
    puts.push({ base: r.request().headers()['x-vn-base'], body: r.request().postData() });
    if (refuse > 0) { refuse--; return r.fulfill({ status: 409, json: { conflict: true, text: THEIRS } }); }
    return r.fulfill({ json: { ok: true } });
  });
  const page = await context.newPage();
  try {
    await page.goto(`${base}editor/`);
    await page.locator('.monaco-editor .view-line').first().waitFor();
    await page.locator('.tab', { hasText: 'park.vn' }).first().click();
    await page.locator('#editor .view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('# mine');
    const bar = page.locator('#conflictBar');
    await bar.waitFor({ state: 'visible' });
    assert.ok(puts[0].base && /^[0-9a-f]{8}$/.test(puts[0].base), 'the save names the version it started from');
    assert.match(await page.locator('.tab', { hasText: 'park.vn' }).first().textContent(), /⚠/);
    await page.waitForTimeout(1200);
    assert.equal(puts.length, 1, 'nothing more is saved until the author chooses');
    // Compare: the diff over the editor, the version on disk on the left.
    await bar.getByRole('button', { name: 'Compare' }).click();
    await page.locator('.conflict-diff .monaco-diff-editor').waitFor();
    assert.match((await page.locator('.conflict-diff').textContent()).replace(/ /g, ' '), /Changed in another editor/);
    await bar.getByRole('button', { name: 'Close compare' }).click();
    // Take theirs: the disk text in the tab; Ctrl+Z brings mine back, and that saves over theirs on purpose.
    await bar.getByRole('button', { name: 'Take theirs' }).click();
    assert.equal(await bar.isHidden(), true);
    const code = () => page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
    assert.equal(await code(), THEIRS);
    await page.locator('#editor .view-lines').click();
    await page.keyboard.press('Control+z');
    assert.match(await code(), /# mine$/, 'Ctrl+Z brings mine back');
    // Keep mine, after another outside change: the save goes through, based on the outside version.
    refuse = 1;
    await page.keyboard.type(' too');
    await bar.waitFor({ state: 'visible' });
    const before = puts.length;
    await bar.getByRole('button', { name: 'Keep mine' }).click();
    await poll(page, () => puts.length !== before, 30);
    const kept = puts.at(-1);
    assert.match(kept.body, /# mine too/, 'mine is written');
    assert.equal(await bar.isHidden(), true);
    const { textHash } = await import('../../dist/engine/src/index.js');
    assert.equal(kept.base, textHash(THEIRS), 'based on the outside version now, so the server takes it');
  } finally { await context.close(); }
});

browserTest('editor: dialogs keep Tab inside, Esc closes them wherever focus is, and focus goes back to the button (UX round EL-5, EP-9, EP-12)', { viewport: { width: 1400, height: 850 } }, async ({ page, errors }) => {
  await page.route('**/api/build-check*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ findings: [], errors: 0, warnings: 0, languages: { source: 'en', text: [], voice: [] } }) }));
  await page.goto(`${base}editor/`);
  await page.locator('.monaco-editor .view-line').first().waitFor();
  const inside = sel => page.evaluate(sel => !!document.activeElement?.closest(sel), sel);
  const hidden = sel => page.locator(sel).evaluate(el => el.hidden);
  const focusedId = () => page.evaluate(() => document.activeElement?.id ?? '');

  // From a toolbar button: 40 Tabs never leave the dialog, Esc closes it, and the button has the focus again.
  for (const [button, dialog] of [['#buildBtn', '#build'], ['#translateBtn', '#translations'], ['#voiceBtn', '#voice'], ['#outlineBtn', '#outline'], ['#helpBtn', '#help']]) {
    await page.locator(button).click();
    await page.locator(`${dialog}:not([hidden])`).waitFor();
    await page.locator(`${dialog} [role="dialog"]`).waitFor();
    await until(page, sel => !!document.activeElement?.closest(sel), dialog); // the dialog takes the focus once its first load is done
    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
    assert.equal(await inside(dialog), true, `${dialog}: Tab stays inside`);
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Tab');
    assert.equal(await inside(dialog), true, `${dialog}: Shift+Tab stays inside`);
    await page.keyboard.press('Escape');
    await until(page, sel => document.querySelector(sel).hidden, dialog);
    assert.equal(await focusedId(), button.slice(1), `${dialog}: focus is back on its button`);
  }

  // Focus that fell onto the page (a button that disabled itself) no longer makes Esc dead: it closes the dialog from there.
  await page.locator('#buildBtn').click();
  await page.locator('#build:not([hidden])').waitFor();
  await page.evaluate(() => document.activeElement?.blur());
  assert.equal(await focusedId(), '', 'nothing has the focus');
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('build').hidden);

  // Opened from the palette, Outline and Theme Panel keep the focus the palette handed them: Esc closes them, typing does not
  // reach the script behind.
  for (const [command, dialog] of [['>Story: Show Outline', '#outline'], ['>Theme: Panel', '#themePanel']]) {
    const before = await page.evaluate(() => monaco.editor.getModels().map(m => m.getValue()).join('\n'));
    await palette(page, command);
    await page.locator(`${dialog}:not([hidden])`).waitFor();
    await until(page, sel => !!document.activeElement?.closest(sel), dialog);
    await page.keyboard.type('zzz');
    assert.equal(await page.evaluate(() => monaco.editor.getModels().map(m => m.getValue()).join('\n')), before, `${dialog}: typing leaves the script alone`);
    await page.keyboard.press('Escape');
    assert.equal(await hidden(dialog), true, `${dialog}: Esc closes it`);
  }
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('editor: the top bar fits at laptop widths, and a narrow window shows the preview over the code instead of dropping it (UX round EL-1, EL-2)', { viewport: { width: 1024, height: 768 } }, async ({ page }) => {
  await page.goto(`${base}editor/`);
  await page.locator('.monaco-editor .view-line').first().waitFor();
  const onScreen = sel => page.locator(sel).evaluate(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= document.getElementById('main').getBoundingClientRect().top + 1; });
  const barFits = async () => assert.deepEqual(
    await page.evaluate(() => ({ scroll: document.getElementById('bar').scrollWidth - document.getElementById('bar').clientWidth, page: document.documentElement.scrollWidth - innerWidth })),
    { scroll: 0, page: 0 }, 'the bar neither scrolls nor overflows the page');
  for (const width of [1024, 960, 901]) {
    await page.setViewportSize({ width, height: 768 });
    await barFits();
    assert.equal(await onScreen('#problems'), true, `${width}px: Problems is on screen, above the panes`);
    assert.equal(await onScreen('#status'), true, `${width}px: the status is on screen`);
    assert.equal(await page.evaluate(() => document.getElementById('preview').getBoundingClientRect().width > 250), true, `${width}px: the preview pane is beside the code`);
  }

  // 900 px and below: the preview is not a pane any more; showing it covers the code and the Editor button goes back.
  await page.setViewportSize({ width: 800, height: 700 });
  const previewShown = () => page.evaluate(() => getComputedStyle(document.getElementById('preview')).display !== 'none');
  assert.equal(await previewShown(), false, 'no room for the pane at 800 px');
  assert.equal(await page.locator('#paneBack').isVisible(), false, 'no Editor button while the code is showing');
  await page.locator('#playHere').click();
  await until(page, () => getComputedStyle(document.getElementById('preview')).display !== 'none');
  const cover = await page.evaluate(() => { const p = document.getElementById('preview').getBoundingClientRect(), m = document.getElementById('main').getBoundingClientRect(); return { w: Math.round(p.width - m.width), h: Math.round(p.height - m.height) }; });
  assert.deepEqual(cover, { w: 0, h: 0 }, 'the preview covers the code');
  await page.locator('#paneBack').click();
  assert.equal(await previewShown(), false, 'the Editor button brings the code back');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.monaco-editor')), true, 'the code has the focus');
  await palette(page, '>Preview: Show or Hide Pane');
  await until(page, () => getComputedStyle(document.getElementById('preview')).display !== 'none');
  assert.match(await page.locator('#status').innerText(), /preview shown/);
  await page.keyboard.press('Alt+1');
  assert.equal(await previewShown(), false, 'Alt+1 returns to the code');
  await page.setViewportSize({ width: 1200, height: 700 });
  assert.equal(await previewShown(), true, 'widening the window puts the pane beside the code again');

  // The Files panel covers the code in a narrow window instead of leaving it 150 px; opening a file puts it away.
  await page.setViewportSize({ width: 500, height: 700 });
  const editorWidth = () => page.locator('#editor').evaluate(el => el.getBoundingClientRect().width);
  await page.keyboard.press('Alt+3'); // shows the panel and focuses its filter
  await page.locator('#sidebar:not([hidden])').waitFor();
  assert.equal(await editorWidth() > 450, true, 'the code keeps its width under the panel');
  await page.locator('#sbList .item', { hasText: 'park.vn' }).click();
  await until(page, () => document.getElementById('sidebar').hidden);
});

browserTest('files panel: headings carry their add icons, right-click and Shift+F10 open a menu, Reveal posts the path', { viewport: { width: 1400, height: 850 } }, async ({ context, page }) => {
  const revealed = [];
  await context.route('**/api/reveal?*', route => { revealed.push(new URL(route.request().url()).searchParams.get('path')); return route.fulfill({ json: { ok: true } }); });
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
  await poll(page, () => revealed.length, 20);
  assert.deepEqual(revealed, ['script/park.vn']);
});

browserTest('files panel: F2 renames a script through the palette, Delete removes it after a confirm', { viewport: { width: 1400, height: 850 } }, async ({ context, page, errors }) => {
  const calls = [];
  for (const route of ['move', 'delete']) {
    await context.route(`**/api/${route}?*`, r => {
      const q = Object.fromEntries(new URL(r.request().url()).searchParams);
      calls.push({ route, ...q });
      return r.fulfill({ json: { ok: true, to: q.to } });
    });
  }
  await context.route('**/api/script?*', r => r.fulfill({ json: { ok: true } })); // closing a tab saves it
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
});

browserTest('files panel: a delete toast offers Undo, and Restore from Trash lists the entries and puts one back', { viewport: { width: 1400, height: 850 } }, async ({ context, page, errors }) => {
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

  await palette(page, '>Files: Restore from Trash');
  const items = page.locator('#paletteList li');
  await until(page, () => document.querySelectorAll('#paletteList li .detail').length === 2);
  // The detail is drawn inside the label's .main span.
  assert.deepEqual(await items.locator('.detail').allInnerTexts(), ['deleted 1 min ago, 2.0 KB', 'replaced 3 h ago, 3.0 MB']);
  const labels = await items.locator('.main').allInnerTexts();
  assert.ok(labels[0].startsWith('script/demo.vn') && labels[1].startsWith('assets/bg/old.png and 1 more'), JSON.stringify(labels));
  await palette(page, '#trash:old'); // reopens the picker if the palette lost the focus meanwhile: see `palette`
  await until(page, () => document.querySelector('#toast span')?.textContent === 'restored assets/bg/old.png');
  assert.deepEqual(calls.at(-1), { route: 'restore', id: 'entry-old' });
  assert.deepEqual(errors, []);
});

browserTest('files panel: renaming an asset rewrites the scripts that name it and says so in a toast', { viewport: { width: 1400, height: 850 } }, async ({ context, page, errors }) => {
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
  await poll(page, () => saved['park.vn'] && saved['screens.vn'] && saved['demo.vn'] && saved['game.json'], 50);
  assert.match(saved['game.json'] ?? '', /"image": "night_park"/, 'the gallery entry in game.json follows');
  assert.match(saved['park.vn'] ?? '', /^ {2}scene night_park dissolve 1\.2s$/m, 'a scene name follows');
  assert.doesNotMatch(saved['park.vn'], /bg_park_night/);
  assert.match(saved['park.vn'], /scene bg_park_evening fade/, 'the other background is left alone');
  assert.match(saved['screens.vn'] ?? '', /image "bg\/night_park\.png" size/, 'a quoted path follows');
  assert.match(saved['demo.vn'] ?? '', /image show photo bg\/night_park at/, 'a path without the extension keeps none');
  assert.deepEqual(errors, []);
});

browserTest('git commit dialog: the bar counts changes, the dialog lists them, ignores, and commits with the message', { viewport: { width: 1400, height: 850 } }, async ({ context, page, errors }) => {
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
  // The focus moves after the rows are drawn (the dialog saves, reads the status, renders, then focuses).
  await until(page, () => document.activeElement?.classList.contains('gd-message')); // focus starts in the message

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
  await palette(page, '>Git: Commit All Changes');
  await until(page, () => document.querySelector('#gitCommit .gd-kind')?.textContent === 'conflict');
  assert.deepEqual(await dialog.locator('.gd-note[data-kind="blocker"]').allInnerTexts(), ['Resolve the merge conflict in script/park.vn first.']);
  await message.fill('anything');
  assert.equal(await go.isDisabled(), true, 'blocked');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(posts.length, 2, 'nothing more was posted');
  assert.deepEqual(errors, []);
});

// The studio's sections are header buttons (aria-expanded) over a body; open one if it is closed.
const openSection = async (studio, id) => {
  const head = studio.locator(`.as-sect[data-sect="${id}"] .as-sect-head`);
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
};
/** The pad's two axis sliders as "head_x 0, head_y 0" (the pad shows no text of its own). */
const padReadout = async studio => `head_x ${await studio.locator('.ap-row[data-ctl="head_x"] .ap-num').inputValue()}, head_y ${await studio.locator('.ap-row[data-ctl="head_y"] .ap-num').inputValue()}`;
/** The + in the Parameters header opens a menu: New parameter or New pad (Model mode). */
const addControl = async (studio, kind) => {
  await studio.locator('.ap-add').click();
  await studio.locator('.ctxmenu:visible button', { hasText: kind === 'pad' ? 'New pad' : 'New parameter' }).click();
};

browserTest('animation studio: a section is dragged to the other column or moved with Alt+arrows, the layout is kept, Reset layout and a narrow window show the first one', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const open = async () => {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Animate' }).first().click();
    await page.locator('#animStudio .as-timeline').waitFor();
    return page.locator('#animStudio');
  };
  let studio = await open();
  const column = (zone) => studio.locator(`.as-dock[data-zone="${zone}"] > .as-sect:not([hidden])`).evaluateAll(els => els.map(e => e.dataset.sect));
  // A resize or a click re-lays the docks out a moment later: poll for the order, then assert it (for the message).
  const columnBecomes = async (zone, want) => {
    await poll(page, async () => JSON.stringify(await column(zone)) === JSON.stringify(want), 100);
    assert.deepEqual(await column(zone), want);
  };
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
  await columnBecomes('left', ['sel', 'poses', 'tree', 'params']);
  await columnBecomes('right', ['keyforms']); // Model has its own sections, in the order kept (Physics and Reactions are in the strip under the stage)
  await studio.locator('.as-modes [data-mode="animate"]').click();

  // A narrow window shows the first layout and no grab buttons; the kept layout comes back when it widens.
  await page.setViewportSize({ width: 800, height: 800 });
  await columnBecomes('left', ['poses', 'params', 'tree']);
  assert.equal(await studio.locator('.as-sect[data-sect="sel"] .as-sect-grab').isVisible(), false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await columnBecomes('left', ['sel', 'poses', 'tree', 'params']);

  await studio.locator('[data-t="resetdock"]').click();
  await columnBecomes('left', ['poses', 'params', 'tree']);
  await columnBecomes('right', ['sel', 'frames', 'place']);
  assert.equal(await page.evaluate(() => localStorage.getItem('vn.editor.studioDock')), null);
  assert.equal(await studio.locator('[data-t="resetdock"]').isVisible(), false);
  assert.deepEqual(errors, []);
});

browserTest('animation studio: a section can sit in a second left column beside the first, and the side columns fold away when dragged to the window edge', { viewport: { width: 1280, height: 800 } }, async ({ page, errors }) => {
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
});

browserTest('animation studio: Model | Animate, Model hides the picker and timeline, Animate brings them back, and the Parts tree is a keyboard list', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
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
  assert.equal(await studio.locator('.as-automatic').isVisible(), false, 'the Automatic line edits the animation on show, so it stays with Animate mode');
  assert.deepEqual(await sections(), ['poses', 'params', 'tree', 'keyforms', 'sel']);
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
  assert.equal(await studio.locator('.as-rig').isVisible(), true, 'rig setup is in the strip under the stage');
  assert.equal(await studio.locator('.as-rig-panel:visible').count(), 0, 'which starts folded');
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
  // Each click first chooses the whole character (the first row), which puts its gizmo up: the spot clicked is near the middle of the
  // stage but clear of the gizmo's handles, or the press grabs the gizmo instead of choosing a part.
  const frameBox = await studio.locator('.as-stage iframe').boundingBox(), stageFrame = page.frames().find(fr => fr.url().includes('studio='));
  await studio.locator('.as-tree .as-row').first().click();
  let handles = [];
  for (let i = 0; i < 20 && !handles.length; i++) {
    await page.waitForTimeout(100);
    handles = await stageFrame.evaluate(() => [...document.querySelectorAll('svg polygon, svg rect, svg circle[r="64"], svg line[stroke="#ff5d5d"], svg line[stroke="#59d96a"], svg circle[data-bone]')]
      .map(e => { const r = e.getBoundingClientRect(); return [r.left - 14, r.top - 14, r.right + 14, r.bottom + 14]; }));
  } // a bone's pivot dot takes a click within 10 px, so the spot keeps clear of them too
  const spot = [0.6, 0.5, 0.7, 0.45, 0.75].flatMap(fy => [0.5, 0.42, 0.58].map(fx => [frameBox.width * fx, frameBox.height * fy]))
    .find(([x, y]) => handles.every(([l, t, r, b]) => x < l || x > r || y < t || y > b));
  assert.ok(spot, `a spot near the middle clear of the gizmo (handles ${JSON.stringify(handles.map(h => h.map(Math.round)))})`);
  const clickMid = async () => { await studio.locator('.as-tree .as-row').first().click(); await page.mouse.click(frameBox.x + spot[0], frameBox.y + spot[1]); await page.waitForTimeout(300); return sum(); };
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
});

browserTest('animation studio: the Model button opens Model mode, and dragging on the stage moves the chosen pivot in one undo step', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
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
});

browserTest('animation studio: bones are edited in the Properties section of Model mode (new bone, parent, part on a bone, pivot, rename, remove) and written by Apply', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Animate' }).first().click();
  const studio = page.locator('#animStudio');
  await studio.locator('.as-tree .as-row[data-part="head"]').waitFor();
  assert.equal(await studio.locator('.as-detail select').count(), 0, 'Animate mode does not edit bones');
  assert.equal(await studio.locator('.as-bone-new').count(), 0);
  await studio.locator('.as-modes [data-mode="model"]').click();
  const choose = name => studio.locator(`.as-tree .as-row[data-part="${name}"]`).click();
  const select = name => studio.locator(`.as-sub[data-sub="transform"] select[data-bone-for="${name}"]`);
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
  // renaming it carries the bangs along
  await choose('bone');
  await studio.locator('.as-sub[data-sub="transform"] .as-bone-name').fill('fringe');
  await studio.locator('.as-sub[data-sub="transform"] .as-bone-name').press('Enter');
  await studio.locator('.as-tree .as-row[data-part="fringe"]').waitFor();
  assert.equal(await studio.locator('.as-sub[data-sub="transform"] .as-bone-name').inputValue(), 'fringe', 'the renamed bone stays chosen');
  await choose('bangs');
  assert.equal(await select('bangs').inputValue(), 'fringe', 'the part follows the renamed bone');
  // removing it puts the bangs back on the head
  await choose('fringe');
  await studio.locator('.as-sub[data-sub="transform"] .as-bone-del').click();
  await choose('bangs');
  assert.equal(await select('bangs').inputValue(), 'head');
  await studio.locator('[data-t="apply"]').click();
  for (let i = 0; JSON.parse(saved.at(-1)).bones.bone && i < 50; i++) await page.waitForTimeout(100);
  rig = JSON.parse(saved.at(-1));
  assert.equal(rig.bones.bone, undefined);
  assert.equal(rig.bones.fringe, undefined);
  assert.equal(rig.parts.bangs.bone, 'head');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: the Automatic line of an animation is written to rig.json by Apply', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  // The editor autosaves a rig.json edit; catch the request so the sample project is left alone.
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Animate' }).first().click(); // the picker and the Automatic line belong to Animate mode
  const studio = page.locator('#animStudio');
  await studio.locator('.as-anim').selectOption('blink');
  assert.equal(await studio.locator('.as-every-min').inputValue(), '3', 'the blink animation of the sample starts every 3 to 6 seconds');
  assert.equal(await studio.locator('.as-every-max').inputValue(), '6');
  assert.match(await studio.locator('.as-auto-hint').textContent(), /^Starts by itself every 3 to 6 s/, 'the line says in words what the fields mean');
  const field = async (sel, v) => { await studio.locator(sel).fill(v); await studio.locator(sel).press('Tab'); };
  await field('.as-every-min', '2');
  await field('.as-every-max', '1'); // a range that runs backwards is not kept
  assert.equal(await studio.locator('.as-every-max').inputValue(), '6');
  await field('.as-while', 'speaking and mood >');
  assert.equal(await studio.locator('.as-while').inputValue(), '', 'a condition that does not parse is not kept');
  await field('.as-while', 'speaking');
  await studio.locator('[data-t="apply"]').click();
  for (let i = 0; !saved.length && i < 50; i++) await page.waitForTimeout(100);
  assert.ok(saved.length, 'the rig.json tab was not saved');
  const rig = JSON.parse(saved.at(-1));
  assert.deepEqual(rig.animations.blink.auto, { every: { min: 2, max: 6 }, while: 'speaking' });
  assert.ok(rig.animations.talk.auto && rig.pivots && !rig.autonomous, 'the rest of the file stays');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: the Parameters section moves a pad and a slider, keys them into parameter lanes, and saves a pose', { viewport: { width: 1280, height: 720 } }, async ({ page, errors }) => {
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
  assert.equal(await studio.locator('.ap-row[data-ctl="head_x"] .ap-num').inputValue(), String(Number((await padReadout(studio)).match(/head_x (\S+),/)[1])), 'the axis slider follows the pad');
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
  assert.match(await padReadout(studio), /head_x 0, head_y 0/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape'); // the first one warns about unapplied changes
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: Model mode previews the parameters and keys them as keyforms (no timeline, no Key changed), and says pivots belong to the rest pose', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo
  const studio = page.locator('#animStudio');
  await openSection(studio, 'poses');
  await openSection(studio, 'params');
  await studio.locator('.ap-pad').waitFor();
  assert.equal(await studio.locator('.ap-row .ap-key').first().isVisible(), true, 'the key button is there in Model mode: it keys a keyform of the chosen part');
  assert.equal(await studio.locator('.ap-row .ap-key').first().isDisabled(), true, 'but with no part chosen there is nothing to key');
  assert.equal(await studio.locator('.ap-target, .ap-kf').count(), 0, 'no part-first keyed target or Keyform row: the Bind block under the controls is the one place');
  assert.equal(await studio.locator('.as-focus').getAttribute('data-param'), '', 'no parameter is active until the author picks one');
  assert.equal(await studio.locator('.ap-key-all').isVisible(), false, 'Key changed writes timeline keys: Animate only');
  assert.equal(await studio.locator('.ap-keyedit').isVisible(), false);
  assert.equal(await studio.locator('.ap-pose-save').isVisible(), true, 'poses stay: they are rig data');
  assert.equal(await studio.locator('.as-rest-note').isVisible(), false, 'nothing to say while the parameters are at their defaults');
  const pad = await studio.locator('.ap-pad').boundingBox();
  await page.mouse.click(pad.x + pad.width * 0.9, pad.y + pad.height * 0.5);
  assert.match(await padReadout(studio), /head_x 0\.[0-9]+/);
  // The note is Properties': the pad alone in focus shows the Parameter section instead, a part shows Properties.
  await studio.locator('.as-tree .as-row[data-part="torso"]').click();
  assert.equal(await studio.locator('.as-rest-note').isVisible(), true, 'a parameter is off its default: the stage shows that pose');
  await studio.locator('.ap-reset-all').click();
  assert.equal(await studio.locator('.as-rest-note').isVisible(), false);
  assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true, 'previewing changes nothing in the working copy');
  assert.deepEqual(errors, [], 'the page threw errors');
});

/** `get()` once it equals `want` (deepEqual), read again for up to 5 s: for a page that applies a dialog's answer after the click. */
async function settles(page, get, want) {
  let got = await get();
  for (let i = 0; !util.isDeepStrictEqual(got, want) && i < 50; i++) { await page.waitForTimeout(100); got = await get(); }
  return got;
}

// Rotates the chosen part with the gizmo's ring, `deg` degrees clockwise on the screen, in one drag.
async function dragRing(page, deg) {
  const ring = page.frames().find(f => f.url().includes('studio=')).locator('svg circle[r="64"]');
  await ring.waitFor({ timeout: 10000 });
  // The overlay is redrawn as the stage changes, so the ring can be between copies (attached, no box) for a moment.
  let b = await ring.boundingBox();
  for (let i = 0; !b && i < 50; i++) { await page.waitForTimeout(100); b = await ring.boundingBox(); }
  assert.ok(b, 'the gizmo ring is on the stage');
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2, r = b.width / 2, a = (deg * Math.PI) / 180;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  await page.mouse.move(cx + r * Math.cos(a / 2), cy + r * Math.sin(a / 2), { steps: 4 });
  await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

browserTest('animation studio: the tool row is icon buttons with names, key letters and groups, its toggles report their state, and it fits a phone', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Animate' }).nth(1).click(); // robo
  const studio = page.locator('#animStudio');
  const row = studio.locator('.as-gizmo');
  await row.waitFor();
  const btn = name => row.getByRole('button', { name, exact: true });
  const shown = () => row.locator('.si-btn').evaluateAll(els => els.filter(e => e.getClientRects().length).map(e => [e.getAttribute('aria-label'), e.textContent.trim(), !!e.querySelector('svg.si[aria-hidden="true"]')]));
  // Icons carry no text; the accessible name is the label. Animate has no Pivot, Warp or Mask.
  assert.deepEqual(await shown(), [['Move', '', true], ['Rotate', '', true], ['Scale', '', true], ['Fit', '', true], ['Auto-key', '', true], ['Key', '', true]]);
  // World axes is an option of Move, Rotate and Scale: it sits in the tool options bar under the row.
  const bar = studio.locator('.as-toolbar'), world = bar.getByRole('button', { name: 'World axes', exact: true });
  for (const [gz, name, key] of [['pivot', 'Pivot', 'Q'], ['move', 'Move', 'W'], ['rotate', 'Rotate', 'E'], ['scale', 'Scale', 'R'], ['warp', 'Warp', 'D'], ['weights', 'Weights', 'B'], ['mask', 'Mask', 'M']]) {
    const b = row.locator(`[data-gz="${gz}"]`);
    assert.equal(await b.getAttribute('aria-label'), name);
    assert.ok((await b.getAttribute('title')).startsWith(`${name} (${key})`), `the tooltip names the tool and its key: ${await b.getAttribute('title')}`);
    assert.equal(await b.getAttribute('aria-keyshortcuts'), key);
  }
  assert.match(await world.getAttribute('title'), /^World axes \(X\)/);
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
  assert.equal(await world.getAttribute('aria-pressed'), 'false');
  await world.click();
  assert.equal(await world.getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('x');
  assert.equal(await world.getAttribute('aria-pressed'), 'false', 'X toggles it too');
  assert.equal(await btn('Auto-key').getAttribute('aria-pressed'), 'true');
  assert.equal(await btn('Key').getAttribute('aria-pressed'), null);
  assert.equal(await btn('Key').isDisabled(), true, 'nothing previewed yet');
  // Auto-key on keys a drag at once; off, the drag previews and Key writes it.
  await studio.locator('.as-more').click();
  await page.locator('.ctxmenu button', { hasText: 'New animation' }).click();
  await studio.locator('.as-name input').fill('icon_tools');
  await studio.locator('.as-name button[type="submit"]').click();
  await studio.locator('.as-tree .as-row[data-part="face"]').click();
  await btn('Rotate').click();
  const shownAnim = await studio.locator('.as-anim').inputValue();
  assert.equal(await bar.locator('.atb-line').textContent(), `poses face · a drag keys ${shownAnim} at the playhead`, 'the bar says where a drag keys');
  const keys = () => studio.locator('.tl-key').count();
  const k0 = await keys();
  await dragRing(page, 30);
  const k1 = await keys();
  assert.ok(k1 > k0, 'Auto-key wrote a key at the playhead');
  await btn('Auto-key').click();
  assert.equal(await btn('Auto-key').getAttribute('aria-pressed'), 'false');
  assert.match(await bar.locator('.atb-line').textContent(), /a drag previews, Key writes it into /);
  const rotField = studio.locator('.as-gz-nums [data-g="rot"]');
  const rot0 = await rotField.inputValue();
  assert.notEqual(Number(rot0), 0, 'the playhead fields show the new key');
  await studio.locator('.as-slider').fill('500');
  assert.notEqual(await rotField.inputValue(), rot0, 'the playhead fields follow the scrub (SA-2)');
  await dragRing(page, 30);
  assert.equal(await keys(), k1, 'with Auto-key off a drag only previews');
  assert.equal(await btn('Key').isDisabled(), false);
  await btn('Key').click();
  assert.ok(await keys() > k1, 'Key wrote the previewed drag');
  assert.equal(await btn('Key').isDisabled(), true);
  const note = studio.locator('.as-note');
  assert.match(await note.textContent(), /^Keyed /, 'Key says what it wrote');
  // SA-12: an edit with no note of its own (here a scrub that keys nothing, then K with nothing previewed and Shift+K twice) keeps it;
  // a change of what is chosen drops it, and the hint (with K and Shift+K) shows.
  await page.keyboard.press('Shift+K');
  await page.keyboard.press('Shift+K');
  assert.match(await note.textContent(), /^Keyed /, 'toggling Auto-key leaves the note');
  assert.equal(await btn('Auto-key').getAttribute('aria-pressed'), 'false', 'Shift+K twice is back to off');
  await studio.locator('.as-tree .as-row[data-part]:not([data-part="face"])').first().click();
  await page.waitForFunction(() => document.querySelector('#animStudio .as-note')?.textContent === '');
  assert.match(await note.getAttribute('data-hint'), /K key the drags/, 'the hint names K while Auto-key is off');
  await studio.locator('.as-tree .as-row[data-part="face"]').click();
  // SR-12, SR-17: W, then E typed on the stage and a drag at once from inside the ring (not on its line) rotates: the press waits for the
  // editor's answer to E. Key writes it as a rot key; Ctrl+Z takes it back for the steps below.
  const stage = page.frames().find(f => f.url().includes('studio='));
  const ringBox = await stage.locator('svg circle[r="64"]').boundingBox(), rc = [ringBox.x + ringBox.width / 2, ringBox.y + ringBox.height / 2];
  const laneKeys = ch => studio.locator(`.tl-key[data-ch="${ch}"]`).count();
  await studio.locator('.as-slider').fill('250'); // a time with no key yet
  const [rotN, xN] = [await laneKeys('rot'), await laneKeys('x')];
  await stage.evaluate(() => window.focus());
  await page.keyboard.press('w');
  await page.waitForTimeout(300);
  await page.keyboard.press('e');
  await page.mouse.move(rc[0] + 30, rc[1]);
  await page.mouse.down();
  await page.mouse.move(rc[0] + 25, rc[1] + 20, { steps: 3 });
  await page.mouse.move(rc[0], rc[1] + 30, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await btn('Key').click();
  assert.equal(await laneKeys('rot'), rotN + 1, 'the drag from inside the ring rotated');
  assert.equal(await laneKeys('x'), xN, 'and did not move (the old tool)');
  await page.keyboard.press('Control+z');
  assert.equal(await laneKeys('rot'), rotN);
  // SA-5: rot keys at 0 and 0.5 ease back to rest by 1, and a hollow diamond there says so; a double-click holds the pose.
  const restEnd = studio.locator('.tl-rest[data-ch="rot"]');
  assert.deepEqual(await restEnd.evaluateAll(els => els.map(e => e.getAttribute('data-rest'))), ['1']);
  const k2 = await keys();
  await restEnd.dblclick();
  assert.equal(await keys(), k2 + 1, 'the double-click added a key at the end');
  assert.equal(await restEnd.count(), 0, 'the pose now holds: no rest left on the rot lane');
  // SA-8: the unkeyed channels fold to thin rows, and the times sit in a ruler over the lanes; a double-click on a fold opens it.
  const folds = studio.locator('.tl-fold');
  assert.deepEqual(await folds.evaluateAll(els => els.map(e => e.getAttribute('data-fold'))), ['x', 'y', 'scale', 'opacity']);
  assert.equal(await studio.locator('.as-ruler .tl-tick').count(), 5, 'the ruler holds the times');
  assert.equal(await studio.locator('.as-timeline .tl-tick').count(), 0);
  await folds.first().dblclick();
  assert.equal(await keys(), k2 + 2, 'the fold took a key');
  assert.deepEqual(await folds.evaluateAll(els => els.map(e => e.getAttribute('data-fold'))), ['y', 'scale', 'opacity'], 'x opened');
  // Key times are shown and typed in seconds (time-units.md part 2); a new Length asks whether the keys stretch or keep their times.
  const rotKeys = () => studio.locator('.tl-key[data-ch="rot"]').evaluateAll(els => els.map(e => e.getAttribute('aria-label').replace(/, value.*/, '')));
  const durField = studio.locator('.as-dur'), tField = studio.locator('[data-f="t"]'), dialog = page.locator('dialog.ask');
  const d0 = Number(await durField.inputValue());
  assert.deepEqual(await rotKeys(), ['rot key at 0 s', `rot key at ${+(d0 / 2).toFixed(2)} s`, `rot key at ${+d0.toFixed(2)} s`], 'the timeline names key times in seconds');
  if (d0 !== 1) { // a 1 s animation from here: stretched, the keys sit at 0, 0.5 and 1 s
    await durField.fill('1');
    await durField.press('Enter');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Stretch keys' }).click();
  }
  assert.deepEqual(await rotKeys(), ['rot key at 0 s', 'rot key at 0.5 s', 'rot key at 1 s']);
  await durField.fill('2');
  await durField.press('Enter');
  await dialog.waitFor();
  assert.match(await dialog.locator('p').textContent(), /goes from 1 s to 2 s/);
  await dialog.getByRole('button', { name: 'Keep key times' }).click();
  assert.deepEqual(await rotKeys(), ['rot key at 0 s', 'rot key at 0.5 s', 'rot key at 1 s'], 'the keys kept their seconds in a 2 s animation');
  assert.equal(await studio.locator('.tl-rest[data-ch="rot"]').getAttribute('data-rest'), '1', 'nothing at the new end: the rot lane rests there again');
  await studio.locator('.tl-key[data-ch="rot"]').nth(1).click();
  assert.equal(await tField.inputValue(), '0.5', 'the key field is in seconds');
  assert.match(await studio.locator('.as-key option:checked').textContent(), /^0\.5 s · rot /);
  await tField.fill('1.5');
  await tField.press('Enter');
  assert.deepEqual(await rotKeys(), ['rot key at 0 s', 'rot key at 1 s', 'rot key at 1.5 s'], 'typed seconds place the key');
  await durField.fill('4');
  await durField.press('Enter');
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await durField.inputValue(), '2', 'Cancel puts the old Length back');
  await durField.fill('1');
  await durField.press('Enter');
  await dialog.waitFor();
  assert.match(await dialog.locator('p').textContent(), /removes 1 key after 1 s/, 'shortening says what keeping the times would remove');
  await dialog.getByRole('button', { name: 'Stretch keys' }).click();
  const stretched = ['rot key at 0 s', 'rot key at 0.5 s', 'rot key at 0.75 s'];
  assert.deepEqual(await settles(page, rotKeys, stretched), stretched, 'stretched: each key at the same point of the animation');
  // Model mode: the deform group and Pivot come in, keying goes.
  await studio.locator('.as-modes button', { hasText: 'Model' }).click();
  assert.deepEqual((await shown()).map(s => s[0]), ['Pivot', 'Move', 'Rotate', 'Scale', 'Warp', 'Weights', 'Mask', 'Fit']);
  assert.deepEqual(await row.getByRole('group').evaluateAll(els => els.map(e => e.getAttribute('aria-label'))), ['Transform tools', 'Deform tools', 'View']);
  assert.equal(await btn('Pivot').getAttribute('aria-pressed'), 'false', 'Model keeps the tool in hand (Move at the start); Pivot is one click away');
  await btn('Warp').click();
  assert.equal(await btn('Warp').getAttribute('aria-pressed'), 'true');
  assert.equal(await btn('Pivot').getAttribute('aria-pressed'), 'false');
  // SA-7: the transport row (Play, Loop, scrub, time, Length) fits its column at 1024 px and on a phone; it wraps instead.
  await studio.locator('.as-modes button', { hasText: 'Animate' }).click();
  for (const width of [1024, 375, 320]) {
    await page.setViewportSize({ width, height: 700 });
    const tr = await studio.locator('.as-transport').evaluate(el => {
      el.querySelector('.as-dur').scrollIntoView({ block: 'center' }); // the narrow layouts scroll one column
      const box = el.getBoundingClientRect(), kids = [...el.children].map(c => c.getBoundingClientRect());
      const dur = el.querySelector('.as-dur').getBoundingClientRect(), hit = document.elementFromPoint(dur.right - 3, dur.top + dur.height / 2);
      return { over: el.scrollWidth - el.clientWidth, out: kids.filter(k => k.left < box.left - 0.5 || k.right > box.right + 0.5).length, durHit: !!hit?.closest('.as-transport') };
    });
    assert.equal(tr.over, 0, `the transport does not overflow at ${width} px`);
    assert.equal(tr.out, 0, `every transport control is inside its row at ${width} px`);
    assert.ok(tr.durHit, `the Length field is not covered at ${width} px`);
  }
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
});

browserTest('animation studio: undo and redo go to what they change, and say it (ES-5, SA-9)', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Animate' }).nth(1).click(); // robo
  const studio = page.locator('#animStudio'), undo = studio.locator('[data-t="undo"]'), redo = studio.locator('[data-t="redo"]');
  const anim = studio.locator('.as-anim'), dur = studio.locator('.as-dur'), note = studio.locator('.as-note');
  await anim.waitFor();
  assert.equal(await undo.getAttribute('title'), 'Undo (Ctrl+Z)');
  // A Length set in wave, then nod shown: undo goes back to wave and says what it undid.
  await anim.selectOption('wave');
  const was = await dur.inputValue();
  await dur.fill('3');
  await dur.press('Enter');
  await page.locator('dialog.ask').getByRole('button', { name: 'Stretch keys' }).click();
  const step = `Undo: wave: Length ${was} s → 3 s (Ctrl+Z)`;
  assert.equal(await settles(page, () => undo.getAttribute('title'), step), step, 'the button names its step');
  await anim.selectOption('nod');
  await undo.click();
  assert.equal(await anim.inputValue(), 'wave', 'undo shows the animation it changed');
  assert.equal(await dur.inputValue(), was);
  assert.equal(await note.textContent(), `Undid: wave: Length ${was} s → 3 s`);
  assert.equal(await redo.getAttribute('title'), `Redo: wave: Length ${was} s → 3 s (Ctrl+Y)`);
  await anim.selectOption('nod');
  await redo.click();
  assert.equal(await anim.inputValue(), 'wave', 'redo too');
  assert.equal(await dur.inputValue(), '3');
  assert.equal(await note.textContent(), `Redid: wave: Length ${was} s → 3 s`);
  // A key typed in Animate, then Model: Ctrl+Z goes back to Animate to take the key away.
  await studio.locator('.as-tree .as-row[data-part="arm_r"]').click();
  const rot = studio.locator('.as-gz-nums [data-g="rot"]');
  await rot.fill('20');
  await rot.press('Enter');
  assert.match(await undo.getAttribute('title'), /^Undo: wave: key (added|on arm_r changed)/);
  await studio.locator('.as-modes [data-mode="model"]').click();
  await studio.locator('.as-tree').click({ position: { x: 4, y: 4 } }); // the focus away from any field, so Ctrl+Z is the studio's
  await page.keyboard.press('Control+z');
  assert.equal(await studio.getAttribute('data-mode'), 'animate', 'undo switches to the mode its change is in');
  assert.match(await note.textContent(), /^Undid: wave: key (added|on arm_r changed)/);
  assert.deepEqual(errors, []);
});

browserTest('animation studio: in the narrow layout the wheel over the stage scrolls the column and Ctrl+wheel zooms (SA-6)', { viewport: { width: 1280, height: 800 } }, async ({ page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Animate' }).nth(1).click(); // robo (a phone-wide editor keeps the Characters list behind a button)
  const studio = page.locator('#animStudio'), iframe = studio.locator('.as-stage iframe');
  await iframe.waitFor();
  await page.setViewportSize({ width: 390, height: 780 }); // the studio is open: its layout goes narrow and tells the stage
  const stageFrame = () => page.frames().find(fr => fr.url().includes('studio='));
  await poll(page, () => stageFrame()?.getByText(/Ctrl\+wheel zooms/).count(), 50);
  const label = stageFrame().getByText(/zooms, middle-drag/);
  assert.match(await label.textContent(), /Ctrl\+wheel zooms/, 'the hint names the zoom gesture of the narrow layout');
  await iframe.scrollIntoViewIfNeeded();
  const box = await iframe.boundingBox(), zoom = async () => (await label.textContent()).match(/^\d+%/)[0];
  const z0 = await zoom(), top0 = box.y;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(80); }
  let top1 = top0;
  for (let i = 0; i < 20 && top1 === top0; i++) { await page.waitForTimeout(50); top1 = (await iframe.boundingBox()).y; }
  assert.ok(top1 < top0, `the column scrolled (stage top ${top0} → ${top1})`);
  assert.equal(await zoom(), z0, 'a plain wheel does not zoom');
  const b2 = await iframe.boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await poll(page, async () => (await zoom()) !== z0, 20, 50);
  assert.notEqual(await zoom(), z0, 'Ctrl+wheel zooms');
  // A wide window: the wheel zooms again, and the hint says so.
  await page.setViewportSize({ width: 1280, height: 800 });
  await poll(page, async () => !(/Ctrl\+wheel/.test(await label.textContent())), 20, 50);
  assert.match(await label.textContent(), /\(wheel zooms/);
  assert.deepEqual(errors, []);
});

browserTest('animation studio: the focus header stays pinned over the right column, its ▾ lists and verbs follow the focus, and Esc closes them with the focus back', { viewport: { width: 1440, height: 900 } }, async ({ t, page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button[title*="studio for robo in Model mode"]').click();
  const studio = page.locator('#animStudio'), focus = studio.locator('.as-focus'), dock = studio.locator('.as-dock[data-zone="right"]');
  await studio.locator('.ap-pad').waitFor();
  const verbs = () => focus.locator('.ab-acts button[data-verb]:visible').evaluateAll(bs => bs.map(b => `${b.textContent}${b.disabled ? ' (off)' : ''}`));
  const focused = () => page.evaluate(() => document.activeElement?.className ?? '');
  const partPick = focus.locator('.ab-partslot .ab-crumbpick'), paramPick = focus.locator('.ab-paramslot .ab-crumbpick');
  // Nothing in focus: a line that says so, no verbs, no pickers.
  assert.equal(await focus.getAttribute('data-kind'), 'none');
  assert.match(await focus.locator('.ab-crumb').textContent(), /^Nothing in focus/);
  assert.deepEqual(await verbs(), []);
  // A parameter: Bind parts…, and the part word's ▾ lists the parts bound to it; Esc closes the list and gives the focus back to its ▾.
  await studio.locator('.ap-row[data-ctl="breathe"] > label').click();
  assert.equal(await focus.getAttribute('data-kind'), 'param');
  assert.equal(await focus.locator('.ab-crumb').textContent(), 'no part › breathe');
  assert.deepEqual(await verbs(), ['Bind parts…']);
  assert.equal(await paramPick.isVisible(), false, 'no part: nothing to list what moves it');
  await partPick.click();
  assert.equal(await focus.locator('.ab-partpop').isVisible(), true);
  assert.deepEqual(await focus.locator('.ab-pname').allTextContents(), ['torso'], 'the parts bound to breathe');
  assert.equal(await focused(), 'ab-part', 'the list takes the focus');
  await page.keyboard.press('Escape');
  assert.equal(await focus.locator('.ab-partpop').isVisible(), false);
  assert.equal(await studio.isVisible(), true, 'Esc closed the list only');
  assert.equal(await focused(), 'ab-crumbpick', 'and the focus is back on its ▾');
  // Choosing from the list chooses the part: a keyform, three verbs (short names, full names for a screen reader).
  await partPick.click();
  await focus.locator('.ab-part', { hasText: 'torso' }).click();
  assert.equal(await focus.locator('.ab-partpop').isVisible(), false, 'a choice closes the list');
  assert.equal(await focus.getAttribute('data-kind'), 'keyform');
  assert.match(await focus.locator('.ab-crumb').textContent(), /^torso › breathe @ 0/);
  // torso is bound to breathe by its warp, so the choice took the Warp tool, which copies no keys: the verb stays, disabled, and says why.
  assert.equal(await studio.locator('[data-gz="warp"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await verbs(), ['Bind parts…', 'Bind to…', 'Copy keys… (off)']);
  assert.match(await focus.locator('.ab-copykeys').getAttribute('title'), /^Only pose keys are copied/);
  assert.equal(await focus.locator('.ab-more').isVisible(), true, "a keyform's copy and paste are under the row's ⋯");
  // Pinned: in a short window the column scrolls (at 1440 x 900 this state fits since step 4c); the header does not move with it, and keeps its height.
  await page.setViewportSize({ width: 1440, height: 520 });
  await until(page, () => { const d = document.querySelector('#animStudio .as-dock[data-zone="right"]'); return d.scrollHeight > d.clientHeight; });
  const top = await focus.evaluate(e => Math.round(e.getBoundingClientRect().top));
  assert.equal(await focus.evaluate(e => Math.round(e.getBoundingClientRect().height)), 64);
  assert.ok(await dock.evaluate(e => e.scrollHeight > e.clientHeight), 'the sections overflow the column');
  await dock.evaluate(e => { e.scrollTop = e.scrollHeight; });
  assert.ok(await dock.evaluate(e => e.scrollTop) > 0);
  assert.equal(await focus.evaluate(e => Math.round(e.getBoundingClientRect().top)), top, 'the header stayed where it was');
  assert.ok(await focus.evaluate(e => e.getBoundingClientRect().bottom) <= await dock.evaluate(e => e.getBoundingClientRect().top) + 1, 'the sections scroll under it, not over it');
  await page.setViewportSize({ width: 1440, height: 900 });
  await studio.locator('[data-gz="move"]').click();
  assert.deepEqual(await verbs(), ['Bind parts…', 'Bind to…', 'Copy keys…']);
  assert.equal(await focus.locator('.ab-copykeys').getAttribute('aria-label'), 'Copy keys from…');
  const row = await focus.locator('.ab-acts').evaluate(e => ({ lines: new Set([...e.querySelectorAll('button')].filter(b => !b.hidden).map(b => Math.round(b.getBoundingClientRect().top))).size, cut: [...e.querySelectorAll('button')].some(b => !b.hidden && b.scrollWidth > b.clientWidth + 1) }));
  assert.deepEqual(row, { lines: 1, cut: false }, 'the three verbs fit one line, none cut off');
  // The parameter word's ▾ lists what moves torso; Esc closes it the same way.
  await paramPick.click();
  assert.deepEqual(await focus.locator('.ab-aff').allTextContents(), ['breathewarp'], 'breathe, by its warp (the badge)');
  await page.keyboard.press('Escape');
  assert.equal(await focus.locator('.ab-parampop').isVisible(), false);
  assert.equal(await focused(), 'ab-crumbpick');
  // Copy keys… opens the inline picker in single-choice mode with its two options; Esc closes it and the focus goes back to the verb.
  await focus.locator('.ab-copykeys').click();
  const picker = focus.locator('.ab-picker');
  assert.equal(await picker.isVisible(), true);
  assert.equal(await picker.locator('.ab-picktitle').textContent(), 'Copy keys onto torso from');
  assert.equal(await picker.locator('.ab-mirror').isVisible(), true);
  assert.equal(await picker.locator('.ab-reverse').isVisible(), true);
  assert.equal(await picker.locator('.ab-picksub').isVisible(), false, 'no subtree option: one source');
  assert.ok(await picker.locator('.ab-picklist input[type="radio"]').count() > 0, 'one source: radio buttons');
  assert.equal(await picker.locator('.ab-pickgo').isDisabled(), true, 'nothing picked yet');
  await page.keyboard.press('Escape');
  assert.equal(await picker.isVisible(), false);
  assert.equal(await studio.isVisible(), true);
  assert.equal(await focused(), 'ab-copykeys');
  // Choose one and copy: the studio's copyKeys runs, as one undo step.
  await focus.locator('.ab-copykeys').click();
  await picker.locator('.ab-picklist input[type="radio"]').first().check();
  await picker.locator('.ab-mirror').check();
  await picker.locator('.ab-pickgo').click();
  assert.match(await studio.locator('.as-note').textContent(), /^torso took the keys of .*poses mirrored \(Ctrl\+Z undoes it\)\.$/);
  await studio.locator('[data-t="undo"]').click();
  // A part alone: Bind to parameter… and Copy keys from… by their full names; copying waits for a parameter.
  await focus.locator('.ab-partslot .ab-crumbbtn').click(); // up to torso alone
  assert.equal(await focus.getAttribute('data-kind'), 'part');
  assert.equal(await focus.locator('.ab-crumb').textContent(), 'torso › no parameter');
  assert.deepEqual(await verbs(), ['Bind to parameter…', 'Copy keys from… (off)']);
  assert.match(await focus.locator('.ab-copykeys').getAttribute('title'), /choose one first/);
  // Animate mode has no header.
  await studio.locator('.as-modes [data-mode="animate"]').click();
  assert.equal(await focus.isVisible(), false);
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: Physics and Reactions are tabs in a strip under the stage, folded by default; a tab opens it, the open tab folds it, and it is kept', { viewport: { width: 1280, height: 800 } }, async ({ t, context, page, errors }) => {
  // A dock layout stored while the two were sections of the right column (one of them moved to the left): they are dropped, the rest kept.
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vn.editor.studioDock', JSON.stringify({ left: ['poses', 'params', 'tree', 'reactions'], left2: [], right: ['keyforms', 'param', 'sel', 'frames', 'physics', 'place'] })); sessionStorage.setItem('seeded', '1'); }
  });
  const openModel = async () => {
    await page.goto(`${base}editor/`);
    await page.locator('button.anim', { hasText: 'Model' }).nth(0).click(); // mina: six physics chains, no poses
    const studio = page.locator('#animStudio');
    await studio.locator('.as-tree .as-row[data-part="hair_back"]').waitFor();
    return studio;
  };
  let studio = await openModel();
  const strip = studio.locator('.as-rig'), tab = id => strip.locator(`.as-rig-tab[data-rig="${id}"]`), panel = id => strip.locator(`.as-rig-panel[data-rig="${id}"]`);
  const px = (loc, side = 'height') => loc.evaluate((e, side) => Math.round(e.getBoundingClientRect()[side]), side);
  const stageH = () => px(studio.locator('.as-stage'));
  assert.equal(await studio.locator('.as-sect[data-sect="physics"], .as-sect[data-sect="reactions"]').evaluateAll(els => els.filter(e => !e.hidden).length), 0, 'no Physics or Reactions section in any column');
  assert.deepEqual(await studio.locator('.as-dock[data-zone="left"] > .as-sect:not([hidden])').evaluateAll(els => els.map(e => e.dataset.sect)), ['poses', 'params', 'tree']);
  assert.equal(await studio.locator('[data-t="resetdock"]').isVisible(), false, 'the stored layout less the two is the default one');
  // Folded: the tab row alone, under the stage, the whole width of the middle column.
  assert.equal(await strip.isVisible(), true);
  assert.equal(await px(strip), 32);
  assert.deepEqual(await strip.locator('[role="tab"]').evaluateAll(els => els.map(e => [e.dataset.rig, e.getAttribute('aria-selected')])), [['physics', 'true'], ['reactions', 'false']]);
  assert.match(await tab('physics').textContent(), /^Physics6 chains$/);
  assert.equal(await panel('physics').isVisible(), false);
  assert.equal(await strip.evaluate(e => e.getBoundingClientRect().top >= document.querySelector('#animStudio .as-stage').getBoundingClientRect().bottom), true, 'under the stage');
  const s0 = await stageH(), w0 = await px(studio.locator('.as-stage'), 'width');
  // Folded, the stage keeps its size whatever the tool.
  for (const gz of ['warp', 'weights', 'move']) { await studio.locator(`.as-gizmo [data-gz="${gz}"]`).click(); assert.equal(await stageH(), s0, `the stage keeps its height with ${gz}`); }
  // A tab click opens the strip on that tab at a fixed height; the stage gives up the difference and keeps its width.
  await tab('physics').click();
  assert.equal(await px(strip), 240);
  assert.equal(await stageH(), s0 - 208);
  assert.equal(await px(studio.locator('.as-stage'), 'width'), w0);
  assert.equal(await panel('physics').isVisible(), true);
  assert.equal(await panel('physics').locator('.ph-chain').count(), 6);
  assert.equal(await panel('physics').evaluate(e => e.scrollHeight > e.clientHeight), true, 'the six chains scroll inside the strip');
  // Each chain is fields, not JSON: three tables (inputs, segments, outputs) with a ▾ for what a row reads or writes.
  const ph = panel('physics'), field = k => ph.locator(`[data-phk="${k}"]`), rowsOf = (list, n = 0) => ph.locator('.ph-chain').nth(n).locator(`.ph-${list} tbody tr:not(.ph-problem-row)`);
  assert.equal(await ph.locator('textarea').count(), 0);
  assert.equal(await ph.locator('.ph-table').count(), 18);
  assert.equal(await field('hair.inputs.0.src').inputValue(), 'b:head');
  assert.equal(await field('hair.inputs.0.channel').inputValue(), 'c:rot');
  // A number typed and Tab: the chain changes (one undo step), and the focus goes on to the next field across the rebuild.
  await field('hair.inputs.0.weight').fill('1.2');
  await page.keyboard.press('Tab');
  assert.equal(await field('hair.inputs.0.weight').inputValue(), '1.2');
  assert.equal(await studio.locator('.as-note').textContent(), 'Chain "hair": input 1 weight 1.2.');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.phk), 'hair.inputs.0.smoothing', 'the focus moved on to smoothing');
  assert.equal(await studio.locator('[data-t="undo"]').isDisabled(), false);
  // + adds a row like the last; ✕ removes it; a chain's only row keeps its ✕ off.
  assert.equal(await ph.locator('.ph-chain').first().locator('.ph-inputs .ph-x').first().isDisabled(), true, 'the only input cannot go');
  await field('hair.inputs.add').click();
  assert.equal(await rowsOf('inputs').count(), 2);
  await ph.locator('.ph-chain').first().getByRole('button', { name: 'Remove input 2' }).click();
  assert.equal(await rowsOf('inputs').count(), 1);
  // A problem shows at its row: a segment's mass of 0.
  await field('hair.segments.0.mass').fill('0');
  await page.keyboard.press('Enter');
  assert.equal(await ph.locator('.ph-chain').first().locator('.ph-segments .ph-bad').count(), 1);
  assert.match(await ph.locator('.ph-chain').first().locator('.ph-segments .ph-problem').textContent(), /segments\[0\]\.mass: must be more than 0/);
  // The chain's own wind: on, its numbers, off.
  const wind = ph.locator('.ph-chain').first().locator('.ph-wind input[type="checkbox"]');
  const hadWind = await wind.isChecked();
  await wind.click();
  assert.equal(await field('hair.wind.strength').count(), hadWind ? 0 : 1);
  for (let i = 0; i < 5; i++) await studio.locator('[data-t="undo"]').click(); // weight, add, remove, mass, wind
  assert.equal(await field('hair.inputs.0.weight').inputValue(), '1.6', 'undo walks the edits back');
  assert.equal(await ph.locator('.ph-bad').count(), 0);
  // Shake still runs, and stops when its tab goes.
  const shake = panel('physics').locator('.ph-shake').first();
  await shake.click();
  assert.equal(await panel('physics').locator('.ph-shake').first().getAttribute('aria-pressed'), 'true');
  await tab('reactions').click();
  assert.equal(await px(strip), 240, 'another tab: the same height');
  assert.equal(await panel('reactions').isVisible(), true);
  assert.equal(await panel('physics').isVisible(), false);
  assert.equal(await panel('physics').locator('.ph-shake[aria-pressed="true"]').count(), 0, 'the shake stopped with its tab');
  // Reactions: Add reaction needs a pose; Test variables work.
  await panel('reactions').locator('.ar-add').click();
  assert.match(await studio.locator('.as-note').textContent(), /Save a pose first/);
  await panel('reactions').locator('.ar-addvar').click();
  assert.equal(await panel('reactions').locator('.ar-vars input[aria-label="Variable name"]').inputValue(), 'var1');
  // The tabs are a tablist: arrows go along them (open, they switch the tab), the selected one takes Tab.
  await tab('reactions').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.rig), 'physics');
  assert.equal(await tab('physics').getAttribute('aria-selected'), 'true');
  assert.equal(await panel('physics').isVisible(), true);
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.rig), 'reactions');
  assert.deepEqual(await strip.locator('[role="tab"]').evaluateAll(els => els.map(e => e.tabIndex)), [-1, 0]);
  // The open tab folds the strip; the stage gets its height back.
  await tab('reactions').click();
  assert.equal(await px(strip), 32);
  assert.equal(await stageH(), s0);
  assert.equal(await strip.locator('.as-rig-fold').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('vn.editor.studioLayout'))).rig, { tab: 'reactions', open: false }, 'kept with the layout');
  // Folded, the arrows only move the focus; the chevron opens it on the kept tab.
  await page.keyboard.press('ArrowRight');
  assert.equal(await px(strip), 32);
  await strip.locator('.as-rig-fold').click();
  assert.equal(await panel('reactions').isVisible(), true);
  // Kept over a reload; Animate has no strip.
  studio = await openModel();
  assert.equal(await px(strip), 240);
  assert.equal(await panel('reactions').isVisible(), true);
  await studio.locator('.as-modes [data-mode="animate"]').click();
  assert.equal(await strip.isVisible(), false);
  assert.equal(await studio.locator('.as-timeline').isVisible(), true);
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: the tool options bar shows the tool\'s options, keeps one height, and Esc from it steps back in order with the focus kept', { viewport: { width: 1440, height: 900 } }, async ({ page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(0).click(); // mina: bones, and a skinned hair_back
  const studio = page.locator('#animStudio'), row = n => studio.locator(`.as-tree .as-row[data-part="${n}"]`);
  const bar = studio.locator('.as-toolbar'), label = bar.locator('.atb-mode'), tool = gz => studio.locator(`.as-gizmo [data-gz="${gz}"]`);
  const focused = () => page.evaluate(() => { const a = document.activeElement; return a?.dataset.gz ?? a?.getAttribute('aria-label') ?? a?.className; });
  const height = () => bar.evaluate(e => Math.round(e.getBoundingClientRect().height));
  const stageH = () => studio.locator('.as-stage').evaluate(e => Math.round(e.getBoundingClientRect().height));
  await row('hair_back').waitFor();
  await row('hair_back').click();
  // One panel per tool, never empty, and the same height at every tool: the stage does not move on a tool change.
  const h0 = await height(), s0 = await stageH();
  for (const [gz, shows] of [['move', /^poses hair_back · this character has no parameters: \+ in Parameters adds one$/], ['pivot', /^Pivot · hair_back$/], ['warp', /^Warp · hair_back$/], ['mask', /^Mask · hair_back$/], ['weights', /^Weights · Add on /], ['rotate', /^poses hair_back/]]) {
    await tool(gz).click();
    const text = gz === 'move' || gz === 'rotate' ? await bar.locator('.atb-line').textContent() : await label.textContent();
    assert.match(text, shows, `${gz}: ${text}`);
    assert.equal(await bar.locator('.atb:not([hidden])').count(), 1, `one panel with ${gz}`);
    assert.equal(await height(), h0, `the bar keeps its height with ${gz}`);
    assert.equal(await stageH(), s0, `the stage keeps its height with ${gz}`);
  }
  await tool('weights').click();
  await bar.locator('.aww-modebtn[data-brush="select"]').click();
  assert.equal(await height(), h0, 'Select mode, with the most controls, fits the same bar');
  assert.equal(await bar.locator('.atb[data-bar="weights"]').evaluate(e => e.scrollHeight <= e.parentElement.clientHeight + 1), true, 'and its panel fits inside it');
  // The status line is one line whatever it says.
  assert.equal(await studio.locator('.as-note').evaluate(e => getComputedStyle(e).whiteSpace), 'nowrap');
  // [ and ] change the brush radius, Shift the strength.
  await bar.locator('.aww-modebtn[data-brush="add"]').click();
  const radius = bar.locator('.aww-radius'), strength = bar.locator('.aww-strength');
  await tool('weights').focus();
  await page.keyboard.press(']');
  assert.equal(await radius.inputValue(), '36');
  await page.keyboard.press('[');
  assert.equal(await radius.inputValue(), '30');
  await page.keyboard.press('Shift+BracketRight');
  assert.equal(await strength.inputValue(), '0.3');
  // Esc: an open ▾ panel first (the focus back on its button), then the selection, then Move (the focus on the pressed tool button), then close.
  await bar.locator('.aww-modebtn[data-brush="select"]').click();
  await bar.locator('.aww-all').click();
  const setValue = bar.locator('.aww-setvalue');
  await setValue.click();
  await bar.locator('.aww-value').focus();
  await page.keyboard.press('Escape');
  assert.equal(await bar.locator('.aww-num').isVisible(), false, 'Esc closes the panel');
  assert.equal(await focused(), 'Set value…', 'and gives the focus back to its button');
  assert.equal(await tool('weights').getAttribute('aria-pressed'), 'true', 'the tool stays');
  await page.keyboard.press('Escape');
  await until(page, () => document.querySelector('#animStudio .aww-selhint').textContent === '');
  assert.equal(await tool('weights').getAttribute('aria-pressed'), 'true', 'the second Esc clears the selection');
  assert.ok(await bar.evaluate(e => e.contains(document.activeElement)), `Set value went with the selection: the focus stays in the bar (${await focused()})`);
  await page.keyboard.press('Escape');
  await until(page, () => document.querySelector('#animStudio .as-gizmo [data-gz="move"]').getAttribute('aria-pressed') === 'true');
  assert.equal(await focused(), 'move', 'back on Move, the focus is on the Move button, not the page');
  // Pivot: Same pivot for… takes its own Esc; then Pivot goes back to Move.
  await tool('pivot').click();
  const share = bar.getByRole('button', { name: 'Same pivot for…' });
  await share.click();
  assert.equal(await bar.locator('.as-share').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await bar.locator('.as-share').isVisible(), false);
  assert.equal(await tool('pivot').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await tool('move').getAttribute('aria-pressed'), 'true');
  assert.equal(await focused(), 'move');
  // Warp: its first button is All; with nothing chosen, Esc there goes back to Move.
  await tool('warp').click();
  const all = bar.getByRole('button', { name: 'Choose all points' });
  assert.equal(await all.isVisible(), true, 'the Warp bar has the selection of hair_back\'s mesh');
  assert.equal(await bar.locator('.atb[data-bar="warp"]').evaluate(e => e.scrollHeight <= e.parentElement.clientHeight + 1), true, 'and fits the bar');
  await all.focus();
  await page.keyboard.press('Escape');
  await until(page, () => document.querySelector('#animStudio .as-gizmo [data-gz="move"]').getAttribute('aria-pressed') === 'true');
  assert.equal(await focused(), 'move');
  // Rotate: World axes is its first button; Esc there goes back to Move, the next one closes the studio.
  await tool('rotate').click();
  await bar.getByRole('button', { name: 'World axes' }).focus();
  await page.keyboard.press('Escape');
  assert.equal(await tool('move').getAttribute('aria-pressed'), 'true');
  assert.equal(await studio.isVisible(), true);
  await page.keyboard.press('Escape');
  await until(page, () => document.querySelector('#animStudio').hidden);
  assert.deepEqual(errors, []);
});

browserTest('animation studio: in Model mode a gizmo drag writes the chosen part\'s keyform at the keyed parameter value, one undo step per drag, with a mark on the track', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
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
  assert.equal(await studio.locator('.as-focus').getAttribute('data-param'), 'arm_r_lift');
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
  await poll(page, () => saved.length, 50); // the rig.json tab is saved a moment after Apply
  const rig = JSON.parse(saved.at(-1));
  assert.deepEqual(rig.keyforms.filter(k => k.target === 'arm_r'), [{ target: 'arm_r', param: 'arm_r_lift', keys: [{ at: 0 }, { at: 0.5, rot: 35 }, { at: 1, rot: 70 }] }]);
  // Animate mode is what it was: no Bind block, no editing, its key button keys the animation.
  await studio.locator('.as-modes [data-mode="animate"]').click();
  assert.equal(await studio.locator('.ab').isVisible(), false);
  assert.equal(await studio.locator('[data-sect="param"]').isVisible(), false, 'no Parameter section in Animate');
  assert.equal(await studio.locator('.ap-add').isVisible(), false, 'the + for new controls is Model mode only');
  assert.equal(await studio.locator('.ap-tick').count(), 0, 'no marks: Animate shows the timeline\'s keys instead');
  await openSection(studio, 'poses');
  assert.equal(await studio.locator('.ap-key-all').isVisible(), true);
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: a pad writes the grid corner nearest its dot, a grid grows, and parameters can be created, renamed, re-ranged and deleted', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo: head_turn is a pad over head_x and head_y
  const studio = page.locator('#animStudio');
  await studio.locator('.ap-pad').waitFor();
  const undo = studio.locator('[data-t="undo"]'), note = studio.locator('.as-note');
  await studio.locator('.as-tree .as-row[data-part="eyes"]').click();
  assert.equal(await studio.locator('.as-focus').getAttribute('data-param'), '', 'eyes has no keyform: no parameter is active until the author picks one');
  const pad = await studio.locator('.ap-pad').boundingBox();
  await page.mouse.click(pad.x + pad.width - 2, pad.y + pad.height * 0.5); // the pad is picked by using it; this is the right-hand corner of the middle row
  assert.equal(await studio.locator('.as-focus').getAttribute('data-param'), 'head_turn');
  assert.equal(await studio.locator('.as-row[data-part="eyes"]').getAttribute('aria-pressed'), 'false', 'eyes is not moved by the pad: the pad replaces it in focus');
  assert.equal(await studio.locator('.ap-corner').count(), 0, 'no grid yet');
  await studio.locator('[data-gz="move"]').click();
  // A drag does not bind: Bind parts… and a click on the part make the grid first.
  await bindParts(studio, 'eyes');
  assert.equal(await studio.locator('.ap-corner').count(), 9, 'binding made the grid: min, default and max on each axis');
  assert.equal(await studio.locator('.ap-corner.ap-authored').count(), 0);
  const frame = page.frames().find(f => f.url().includes('studio='));
  const arrow = frame.locator('svg polygon[fill="#ff5d5d"]'); // the x arrow of the move gizmo
  await arrow.waitFor({ timeout: 10000 });
  const a = await arrow.first().boundingBox(), ax = a.x + a.width / 2, ay = a.y + a.height / 2;
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(ax + 20, ay, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert.equal(await studio.locator('.ap-corner').count(), 9);
  assert.equal(await studio.locator('.ap-corner.ap-authored').count(), 1, 'one corner is posed');
  assert.ok(Number(await studio.locator('[data-bf="dx"]').inputValue()) > 0, 'the corner holds the move');
  assert.match(await note.textContent(), /^Wrote eyes at head_x 1, head_y 0 as a keyform/);
  await undo.click();
  assert.equal(await studio.locator('.ap-corner.ap-authored').count(), 0, 'one undo takes the pose back; the grid stays');
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
  const editor = studio.locator('[data-sect="param"] .apm-slider');
  assert.equal(await editor.isVisible(), true, 'a new parameter shows in the Parameter section');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('apm-name')), true, 'its name ready to type');
  await editor.locator('.apm-name').fill('smile');
  await editor.locator('.apm-name').press('Enter');
  assert.equal(await studio.locator('.ap-row[data-ctl="smile"]').count(), 1, 'renamed');
  await editor.locator('.apm-max').fill('3');
  await editor.locator('.apm-max').press('Enter');
  assert.deepEqual(await studio.locator('.ap-row[data-ctl="smile"] input[type="range"]').evaluate(e => [e.min, e.max]), ['-1', '3'], 'the range follows');
  assert.equal(await editor.locator('.apm-range').textContent(), '-1 to 3, default 0', 'and the range line');
  await editor.locator('.apm-name').fill('arm_r_lift');
  await editor.locator('.apm-name').press('Enter');
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
  assert.equal(await studio.locator('.ap-padrow').count(), pads0, 'New pad only opens a form: nothing is picked or made yet');
  const draft = studio.locator('.ap-draft');
  assert.deepEqual(await draft.locator('select').evaluateAll(e => e.map(s => s.options[s.selectedIndex].text)), ['＋ New parameter', '＋ New parameter'], 'both axes start as new parameters');
  await draft.locator('input[type="text"]').fill('my pad');
  assert.equal(await draft.locator('input[type="text"]').inputValue(), 'my_pad', 'a space becomes _ as you type');
  await draft.locator('.ap-apply').click();
  assert.equal(await studio.locator('.ap-padrow').count(), pads0 + 1, 'Create made the pad');
  assert.equal(await studio.locator('.ap-row[data-ctl="my_pad_x"]').count(), 1, 'over a new parameter');
  await studio.locator('.ap-padrow.ap-active .ap-del-btn').click();
  assert.equal(await studio.locator('.ap-padrow').count(), pads0, 'the ✕ on a pad deletes the pad');
  await studio.locator('.ap-row[data-ctl="smile"] label').click(); // smile alone in focus: its Parameter section
  await studio.locator('[data-t="apply"]').click();
  await poll(page, () => saved.length, 50); // the rig.json tab is saved a moment after Apply
  const rig = JSON.parse(saved.at(-1));
  assert.deepEqual(rig.parameters.find(p => p.id === 'smile'), { id: 'smile', min: -1, max: 3, default: 0 });
  const grid = rig.keyforms.find(k => k.target === 'eyes');
  assert.deepEqual(grid.params, ['head_x', 'head_y']);
  assert.deepEqual(grid.grid.x, [-1, 0, 0.5, 1]);
  await studio.locator('[data-sect="param"] .apm-slider .apm-delete').click();
  assert.equal(await studio.locator('.ap-row[data-ctl="smile"]').count(), 0, 'deleted');
  await undo.click();
  assert.equal(await studio.locator('.ap-row[data-ctl="smile"]').count(), 1, 'undo brings it back');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: Model mode is parameter first: the author picks the parameter, picking a part binds it with keys at rest, posing writes a key, and a part lists what moves it', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo
  const studio = page.locator('#animStudio');
  await studio.locator('.ap-pad').waitFor();
  // The focus header names the active parameter; its part word's ▾ lists the bound parts, its parameter word's ▾ what moves the part.
  const focus = studio.locator('.as-focus'), active = () => focus.getAttribute('data-param');
  const note = studio.locator('.as-note'), bound = studio.locator('.ab-part'), undo = studio.locator('[data-t="undo"]');
  const partPick = focus.locator('.ab-partslot .ab-crumbpick'), paramPick = focus.locator('.ab-paramslot .ab-crumbpick');
  const closePop = async (pick, pop) => { if (await focus.locator(pop).isVisible()) await pick.click(); };
  const movedBy = async name => { await paramPick.click(); await studio.locator('.ab-aff', name ? { hasText: name } : {}).click(); };
  const unbind = async name => {
    await partPick.click();
    await (name ? studio.locator('.ab-item', { hasText: name }) : studio.locator('.ab-item').first()).locator('.ab-unbind').click();
    await closePop(partPick, '.ab-partpop');
  };
  assert.equal(await studio.locator('.as-modes [data-mode="model"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await studio.locator('.as-modes [data-mode="keyform"]').count(), 0, 'Model and Animate are the only modes');
  assert.equal(await studio.locator('.as-sect[data-sect="params"] .as-sect-head').getAttribute('aria-expanded'), 'true');
  assert.equal(await studio.locator('.ab').isVisible(), true, 'the Bind block is under the controls');
  assert.equal(await studio.locator('.ap-target, .ap-kf').count(), 0, 'no part-first keyed target line');
  assert.equal(await studio.locator('[data-gz="pivot"]').isVisible(), true, 'the Pivot tool is still in Model');
  assert.equal(await studio.locator('[data-gz="move"]').getAttribute('aria-pressed'), 'true', 'Model starts on Move, so a click on the stage picks parts');
  assert.equal(await studio.locator('.as-sect[data-sect="sel"]').isVisible(), true);
  assert.equal(await active(), '', 'no parameter is active until the author picks one');
  assert.equal(await studio.locator('.ap-row.ap-active, .ap-padrow.ap-active').count(), 0);
  // With no active parameter a click on a part of the stage only selects it: nothing is bound.
  const stage = await studio.locator('.as-stage iframe').boundingBox();
  const spineRow = studio.locator('.as-row[data-part="spine"]'), torsoRow = studio.locator('.as-row[data-part="torso"]');
  for (let i = 0; i < 20 && (await torsoRow.getAttribute('aria-pressed')) !== 'true'; i++) { // the art may still be loading: a click on nothing picks nothing
    await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5); // the middle of the robo: the torso, which sits on the spine
    await page.waitForTimeout(400);
  }
  assert.equal(await torsoRow.getAttribute('aria-pressed'), 'true', 'the click chose the torso: the part, not its bone (docs/design/studio-stage-modes.md)');
  assert.equal(await spineRow.getAttribute('aria-pressed'), 'false');
  assert.equal(await bound.count(), 0);
  assert.equal(await studio.locator('.as-bind').count(), 0, 'and there are no ticks in the tree while no parameter is active');
  // Nothing is guessed: choosing a part that one parameter moves does not make that parameter active; its button jumps there.
  await studio.locator('.as-tree .as-row[data-part="arm_r"]').click();
  assert.equal(await active(), '');
  assert.deepEqual(await studio.locator('.ab-aff').allTextContents(), ['arm_r_lift'], 'the parameters that move the chosen part');
  await movedBy();
  assert.equal(await active(), 'arm_r_lift');
  assert.equal(await studio.locator('.ap-row[data-ctl="arm_r_lift"]').evaluate(e => e.classList.contains('ap-active')), true, 'the active row is highlighted');
  // One line to a control: only the active row shows reset and delete, the others keep their width for the slider; no row has an edit button (its properties are the Parameter section).
  assert.equal(await studio.locator('.ap-row[data-ctl="arm_r_lift"] .ap-reset').isVisible(), true, 'the active row shows reset and delete');
  assert.equal(await studio.locator('.ap-row[data-ctl="eye_open"] .ap-reset').isVisible(), false, 'another row shows only its key button');
  assert.equal(await studio.locator('.ap-edit-btn').count(), 0);
  assert.equal(await studio.locator('.ap-row[data-ctl="eye_open"] .ap-key').isVisible(), true);
  assert.equal(await bound.count(), 1, 'arm_r is bound to arm_r_lift already (the sample rig)');
  assert.match(await bound.first().textContent(), /^arm_rpose2 keys · 1 posed$/);
  // A new parameter becomes the active one. A click on a part of the stage binds it: keys at min, default and max, all at rest.
  await addControl(studio, 'param');
  const editor = studio.locator('[data-sect="param"] .apm-slider .apm-name');
  await editor.fill('wave');
  await editor.press('Enter');
  assert.equal(await active(), 'wave');
  assert.equal(await bound.count(), 0);
  assert.match(await note.getAttribute('data-hint'), /^No parts are bound to wave yet. Press Bind parts…/, 'what to do next is the status line\'s hint');
  // A click only chooses, and the focus is one thing: a part that wave does not move replaces wave as the parameter in focus.
  // (Each try is a few pixels from the last, so it is a new click on a new spot, not the next part of a cycle.)
  const clickTorso = async i => { await page.mouse.click(stage.x + stage.width * 0.5 + (i % 2) * 9, stage.y + stage.height * 0.5); await page.waitForTimeout(400); };
  await torsoRow.click();
  assert.equal(await active(), '', 'torso is not moved by wave: choosing it replaces the parameter');
  await studio.locator('.ap-row[data-ctl="wave"] > label').click();
  assert.equal(await active(), 'wave');
  assert.equal(await torsoRow.getAttribute('aria-pressed'), 'false');
  for (let i = 0; i < 20 && (await torsoRow.getAttribute('aria-pressed')) !== 'true'; i++) await clickTorso(i);
  assert.equal(await torsoRow.getAttribute('aria-pressed'), 'true', 'the click on the stage chose the torso');
  assert.equal(await active(), '', 'a click only chooses, and torso is not moved by wave');
  assert.doesNotMatch(await note.textContent(), /^Bound/);
  await studio.locator('.ap-row[data-ctl="wave"] > label').click(); // and a parameter replaces a part it does not move
  assert.equal(await active(), 'wave');
  assert.equal(await torsoRow.getAttribute('aria-pressed'), 'false');
  assert.equal(await bound.count(), 0, 'nothing was bound by any of it');
  // Bind parts… opens a picker in the right column; the stage and the left lists never answer it.
  const bindBtn = studio.locator('.ab-bind'), picker = studio.locator('.ab-picker');
  assert.equal(await bindBtn.textContent(), 'Bind parts…');
  await bindBtn.click();
  assert.equal(await picker.isVisible(), true);
  await studio.locator('.as-tree .as-row[data-part="forearm_r"]').click();
  assert.equal(await bound.count(), 0, 'a click in the tree binds nothing while the picker is open');
  assert.equal(await picker.isVisible(), false, 'choosing another part closes a picker that belonged to the focus');
  await studio.locator('.ap-row[data-ctl="wave"] > label').click();
  await bindBtn.click();
  await page.keyboard.press('Escape');
  assert.equal(await picker.isVisible(), false, 'Esc closes the picker only');
  assert.equal(await studio.isVisible(), true);
  await bindParts(studio, 'spine');
  assert.match(await note.textContent(), /^Bound spine to wave: keys at -1, 0, 1, all at rest/);
  assert.equal(await bound.count(), 1);
  assert.match(await bound.first().textContent(), /^spinepose3 keys$/, 'three keys, none posed');
  assert.equal(await studio.locator('.ap-row[data-ctl="wave"] .ap-tick').count(), 3, 'a mark on the track for each key');
  assert.equal(await studio.locator('.as-bind[data-bind="spine"]').textContent(), '✓', 'and its mark in the Parts tree');
  await undo.click();
  assert.equal(await bound.count(), 0, 'binding is one undo step');
  await studio.locator('[data-t="redo"]').click();
  // The picker lists only what is not bound yet. The mark in the tree is a display, not a button.
  assert.equal(await studio.locator('button.as-bind').count(), 0, 'the marks are not buttons');
  await bindBtn.click();
  assert.equal(await studio.locator('.ab-picklist label', { hasText: /^spine/ }).count(), 0, 'spine is bound already: not offered');
  await studio.locator('.ab-pickfilter').fill('forearm_r');
  assert.equal(await studio.locator('.ab-picklist label').count(), 1, 'the filter narrows the list');
  await page.keyboard.press('Escape');
  await bindParts(studio, 'forearm_r');
  assert.equal(await bound.count(), 2);
  await unbind('forearm_r'); // the ✕ in the part word's ▾ unbinds
  assert.equal(await bound.count(), 1);
  await studio.locator('.as-row[data-part="torso"]').click();
  assert.equal(await active(), '', 'a click on a row only chooses (and replaces the parameter)');
  await studio.locator('.ap-row[data-ctl="wave"] > label').click();
  assert.equal(await bound.count(), 1, 'nothing was bound by it');
  // Click a key, pose there with the gizmo: one undo step, the key is posed, the others stay at rest.
  await studio.locator('.as-row[data-part="spine"]').click();
  assert.deepEqual(await studio.locator('.ab-key').allTextContents(), ['-1', '0', '1']);
  await studio.locator('.ab-key', { hasText: /^1$/ }).click();
  assert.equal(await studio.locator('.ap-row[data-ctl="wave"] .ap-num').inputValue(), '1', 'the slider went to the key');
  // The focus in words: the part, the parameter, the value, and whether a key is there. Previous and next walk the keys; a word goes up.
  const crumb = studio.locator('.ab-crumb');
  assert.equal(await crumb.textContent(), 'spine › wave @ 1 · key');
  assert.equal(await studio.locator('.ab-next').isDisabled(), true, 'the last key has no next');
  await studio.locator('.ab-prev').click();
  assert.equal(await studio.locator('.ap-row[data-ctl="wave"] .ap-num').inputValue(), '0');
  assert.equal(await crumb.textContent(), 'spine › wave @ 0 · key');
  await studio.locator('.ab-next').click();
  assert.equal(await studio.locator('.ap-row[data-ctl="wave"] .ap-num').inputValue(), '1');
  await studio.locator('.ap-row[data-ctl="wave"] .ap-num').fill('0.5');
  await studio.locator('.ap-row[data-ctl="wave"] .ap-num').press('Enter');
  assert.equal(await crumb.textContent(), 'spine › wave @ 0.5 · no key here: a drag adds one');
  await studio.locator('.ab-key', { hasText: /^1$/ }).click();
  await studio.locator('.ab-crumbbtn', { hasText: 'wave' }).click(); // up to the parameter alone
  assert.equal(await crumb.textContent(), 'no part › wave', 'the missing half of the focus is named, with its ▾');
  assert.equal(await spineRow.getAttribute('aria-pressed'), 'false');
  await studio.locator('.as-row[data-part="spine"]').click(); // and a part wave moves pairs with it again
  assert.equal(await crumb.textContent(), 'spine › wave @ 1 · key');
  await studio.locator('.ab-crumbbtn', { hasText: 'spine' }).click(); // up to the part alone
  assert.equal(await crumb.textContent(), 'spine › no parameter');
  assert.equal(await active(), '');
  await movedBy('wave'); // a parameter that moves it (the ▾ after its word) pairs with it
  assert.equal(await crumb.textContent(), 'spine › wave @ 1 · key');
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
  await studio.locator('.as-row[data-part="spine"]').click();
  await studio.locator('.as-row[data-part="torso"]').click({ modifiers: ['Control'] });
  assert.equal(await studio.locator('.as-row[data-part="spine"]').getAttribute('aria-pressed'), 'true', 'the spine stays the chosen part');
  assert.equal(await bound.count(), 1, 'adding does not bind by itself');
  assert.match(await note.textContent(), /^Added torso to the chosen parts \(2\).* torso is not bound to wave: a drag leaves it out/, 'adding says the part is not bound');
  await dragRing(page, 15);
  assert.match(await note.textContent(), /^Wrote spine at wave = 1 as a keyform\. Ctrl\+Z undoes the whole drag\. torso is not bound to wave, so it did not move/, 'a drag writes the bound part and does not bind the other');
  assert.equal(await bound.count(), 1);
  await undo.click();
  await bindParts(studio, 'torso'); // the picker binds it; the chosen set (spine) stays
  await studio.locator('.as-row[data-part="spine"]').click();
  await studio.locator('.as-row[data-part="torso"]').click({ modifiers: ['Control'] });
  assert.equal(await bound.count(), 2);
  await dragRing(page, 15);
  assert.match(await note.textContent(), /^Wrote 2 parts \(spine, torso\) at wave = 1 as keyforms/);
  await undo.click();
  assert.equal(await bound.count(), 2, 'the binding stays; the drag was one step');
  await studio.locator('[data-t="redo"]').click();
  await studio.locator('.as-row[data-part="spine"]').click(); // a plain click drops the added part from the chosen set
  await dragRing(page, 5);
  assert.match(await note.textContent(), /^Wrote spine at wave = 1 as a keyform/);
  await undo.click();
  await unbind('torso'); // unbind it again so the rest of the test sees one bound part
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
  assert.equal(await active(), 'head_turn');
  assert.equal(await bound.count(), 0, 'no part has a grid on this pad yet');
  await bindParts(studio, 'eyes');
  assert.match(await note.textContent(), /^Bound eyes to head_turn: a 3 × 3 grid of corners, all at rest/);
  assert.equal(await studio.locator('.ap-corner').count(), 9);
  assert.equal(await studio.locator('.ap-corner.ap-authored').count(), 0);
  await studio.locator('.ab-size select').selectOption('2');
  await bindParts(studio, 'mouth');
  assert.match(await note.textContent(), /^Bound mouth to head_turn: a 2 × 2 grid/, 'the size applies to the next part bound');
  assert.equal(await studio.locator('.ap-corner').count(), 4, 'and the pad shows the corners of the chosen part');
  const pad = await studio.locator('.ap-pad').boundingBox();
  await page.mouse.click(pad.x + pad.width - 3, pad.y + 3);
  assert.match(await padReadout(studio), /head_x 1, head_y 1/, 'the dot snapped onto the corner');
  // What moves a part, from the other side: choose head, its parameters are buttons, one makes that parameter active.
  await studio.locator('.as-tree .as-row[data-part="head"]').click();
  assert.deepEqual(await studio.locator('.ab-aff').allTextContents(), ['head_x', 'head_y']);
  await movedBy('head_y');
  assert.equal(await active(), 'head_y');
  assert.equal(await studio.locator('.ap-padrow').evaluate(e => e.classList.contains('ap-active')), true, 'one axis of a pad highlights the pad');
  // Unbind with the ✕: the keys it made go.
  await studio.locator('.ap-row[data-ctl="wave"] > label').click();
  await unbind();
  assert.equal(await bound.count(), 0);
  assert.match(await note.textContent(), /^Unbound spine from wave/);
  await undo.click();
  assert.equal(await bound.count(), 1, 'undo binds it again, posed key included');
  // A gizmo drag needs a part and a parameter in focus together: with a part alone the gizmo is locked (no handles, the bar says why); once the part is bound it drags and writes.
  await studio.locator('.as-tree .as-row[data-part="forearm_r"]').click();
  assert.equal(await active(), '', 'forearm_r is not moved by wave');
  const stageFrame = page.frames().find(f => f.url().includes('studio='));
  await stageFrame.locator('svg [data-gizmo-lock]').waitFor({ timeout: 10000 });
  assert.equal(await stageFrame.locator('svg circle[r="64"]').count(), 0, 'a locked gizmo has no ring to drag');
  assert.match(await studio.locator('.atb-line').textContent(), /no parameter is active|is bound to no parameter/);
  await studio.locator('.ap-row[data-ctl="wave"] > label').click();
  await studio.locator('.ap-row[data-ctl="wave"] .ap-num').fill('1');
  await studio.locator('.ap-row[data-ctl="wave"] .ap-num').press('Enter');
  assert.equal(await bound.count(), 1);
  await bindParts(studio, 'forearm_r');
  assert.equal(await bound.count(), 2);
  await dragRing(page, 15);
  assert.match(await note.textContent(), /^Wrote forearm_r at wave = 1/);
  await undo.click();
  assert.equal(await bound.count(), 2, 'the binding stays; the drag was one step');
  await studio.locator('[data-t="redo"]').click();
  // The other direction: choose a part, press Bind to parameter…, tick the parameter in the picker (Esc cancels).
  await studio.locator('.as-tree .as-row[data-part="torso"]').click();
  const bindTo = studio.locator('.ab-bindto');
  await bindTo.click();
  assert.equal(await picker.isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await picker.isVisible(), false);
  await bindTo.click();
  await studio.locator('.ap-row[data-ctl="eye_open"] > label').click(); // the parameters on the left only choose the focus
  assert.equal(await studio.locator('.ab-item', { hasText: 'torso' }).count(), 0, 'choosing eye_open bound nothing');
  await studio.locator('.as-tree .as-row[data-part="torso"]').click();
  await bindTo.click();
  await studio.locator('.ab-picklist label:has(span:text-is("eye_open")) input').check();
  await studio.locator('.ab-pickgo').click();
  assert.match(await note.textContent(), /^Bound torso to eye_open/);
  assert.equal(await active(), 'eye_open');
  assert.equal(await picker.isVisible(), false, 'one go, then it closes');
  assert.equal(await studio.locator('.ab-item', { hasText: 'torso' }).count(), 1);
  await unbind('torso'); // back to what the Apply check below expects
  assert.equal(await studio.locator('.ab-item', { hasText: 'torso' }).count(), 0);
  // Apply writes the keyforms.
  await studio.locator('[data-t="apply"]').click();
  await poll(page, () => saved.length, 50); // the rig.json tab is saved a moment after Apply
  const rig = JSON.parse(saved.at(-1));
  const spine = rig.keyforms.filter(k => k.target === 'spine' && k.param === 'wave');
  assert.equal(spine.length, 1);
  assert.deepEqual(spine[0].keys.map(k => k.at), [-1, 0, 1]);
  assert.deepEqual(spine[0].keys.map(k => Object.keys(k).length > 1), [false, false, true], 'only the posed key holds a pose');
  assert.ok(rig.keyforms.some(k => k.target === 'forearm_r' && k.param === 'wave'));
  // The warp is keyed to the active parameter (the header names it; Keyforms has its keys) and has no slider or parameter choice of its own.
  await studio.locator('.ap-row[data-ctl="breathe"] > label').click();
  assert.deepEqual(await bound.allTextContents(), ['torsowarp2 keys · 1 posed']);
  await studio.locator('.as-tree .as-row[data-part="torso"]').click();
  await studio.locator('[data-gz="warp"]').click();
  assert.equal(await studio.locator('.as-focus').getAttribute('data-param'), 'breathe');
  assert.match(await studio.locator('.ab .ab-formtext').textContent(), /^the warp of torso at /);
  assert.equal(await studio.locator('.aw-param').isVisible(), false);
  assert.equal(await studio.locator('.aw-range').isVisible(), false, 'every slider is in the Parameters section');
  // Animate mode has no Bind block and no ticks in the tree, and no Pivot tool.
  await studio.locator('.as-modes [data-mode="animate"]').click();
  assert.equal(await studio.locator('.ab').isVisible(), false);
  assert.equal(await studio.locator('[data-gz="pivot"]').isVisible(), false);
  assert.equal(await studio.locator('.as-bind').count(), 0, 'no ticks in the tree');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: the keyboard reaches the studio from the stage, Esc steps back before it closes, focus survives redraws', { viewport: { width: 1280, height: 800 } }, async ({ page, errors }) => {
  const active = () => page.evaluate(() => { const a = document.activeElement; return a === document.body ? 'BODY' : [...a.classList].join(' ') || a.tagName; });
  const isOpen = () => page.evaluate(() => !document.querySelector('#animStudio').hidden);
  await page.goto(`${base}editor/`);
  // Animate: the stage gives back Space, Tab and Esc (they were the game's skip, advance and menu keys there).
  await page.locator('button.anim', { hasText: 'Animate' }).nth(1).click(); // robo
  const studio = page.locator('#animStudio');
  await studio.locator('.as-tree .as-row').first().waitFor();
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelector('svg.studio-gizmo'));
  await studio.locator('.as-anim').selectOption('wave');
  const stage = await studio.locator('.as-stage iframe').boundingBox();
  const clickStage = () => page.mouse.click(stage.x + 20, stage.y + 20);
  await clickStage();
  await page.keyboard.press('Space');
  await until(page, () => document.querySelector('#animStudio .as-play')?.textContent === 'Pause');
  await page.keyboard.press('Space');
  await until(page, () => document.querySelector('#animStudio .as-play')?.textContent === 'Play');
  await page.keyboard.press('Tab');
  assert.equal(await active(), 'as-play', 'Tab moves on from the stage to Play');
  // A click on a key gives it the focus, so Delete removes it (the click on empty stage chose the whole character: back to the arm wave keys).
  await studio.locator('.as-tree .as-row[data-part="arm_r"]').click();
  const keys = studio.locator('.as-timeline [data-key]');
  const n = await keys.count();
  await keys.first().click({ force: true });
  assert.match(await active(), /tl-key/, 'the clicked key has the focus');
  await page.keyboard.press('Delete');
  await until(page, n => document.querySelectorAll('#animStudio .as-timeline [data-key]').length === n - 1, n);
  // Esc in a field puts back the typing; Ctrl+Z after a commit is the studio's undo, and the field keeps the focus.
  const dur = studio.locator('.as-dur'), was = await dur.inputValue();
  await dur.fill('2.5');
  await dur.press('Escape');
  assert.equal(await isOpen(), true, 'Esc in a field with a typed edit does not close the studio');
  assert.equal(await dur.inputValue(), was);
  await dur.fill('3');
  await dur.press('Enter');
  // The animation has keys: the studio asks whether they stretch or keep their times; Enter takes the default (stretch).
  await page.locator('dialog.ask').waitFor();
  await page.keyboard.press('Enter');
  await page.locator('dialog.ask').waitFor({ state: 'detached' });
  assert.equal(await dur.inputValue(), '3');
  await dur.focus();
  await page.keyboard.press('Control+z');
  assert.equal(await dur.inputValue(), was, 'Ctrl+Z from the field undid the committed length');
  assert.equal(await active(), 'as-dur');
  await page.keyboard.press('Control+y'); // the key delete and the length are undone and redone; leave the length changed
  // Model, Warp tool with points selected: Esc clears them, then goes back to Move, and only then closes (with the guard: there are edits).
  await page.locator('#animStudio .as-modes button[data-mode="model"]').click();
  await studio.locator('.as-tree .as-row[data-part="torso"]').click();
  await studio.locator('.ap-row[data-ctl="breathe"] > label').click();
  await studio.locator('[data-gz="warp"]').click();
  await studio.locator('.aw-all').click();
  const tool = () => page.evaluate(() => document.querySelector('#animStudio [data-gz][aria-pressed="true"]')?.dataset.gz);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.equal(await isOpen(), true, 'the first Esc clears the selection');
  assert.equal(await tool(), 'warp');
  await page.keyboard.press('Escape');
  await until(page, () => document.querySelector('#animStudio [data-gz="move"]')?.getAttribute('aria-pressed') === 'true');
  assert.notEqual(await active(), 'BODY', 'the Warp bar that went hands the focus on');
  // A click on a key of the Keys row keeps the studio's keys working (the row is redrawn under the pointer).
  await studio.locator('.as-tree .as-row[data-part="arm_r"]').click();
  await studio.locator('.ap-row[data-ctl="arm_r_lift"] > label').click();
  await studio.locator('.ab-key').last().click();
  assert.match(await active(), /ab-key/);
  await page.keyboard.press('e');
  assert.equal(await tool(), 'rotate');
  // The Parameter section: Tab after a changed field goes on to the next field, though the palette is rebuilt.
  await studio.locator('.as-focus .ab-paramslot .ab-crumbbtn').click(); // up from the keyform to arm_r_lift alone
  const editor = studio.locator('[data-sect="param"] .apm-slider');
  const min = editor.locator('.apm-min');
  await min.fill('-0.5');
  await min.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('label')?.firstChild?.textContent?.trim()), 'max');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: a parameter alone shows its Parameter section; a keyform copies and pastes its pose, mirrored, one undo step each', { viewport: { width: 1440, height: 900 } }, async ({ t, page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo
  const studio = page.locator('#animStudio');
  await studio.locator('.as-tree .as-row[data-part="head"]').waitFor();
  const shown = id => studio.locator(`.as-sect[data-sect="${id}"]`).isVisible();
  const section = studio.locator('[data-sect="param"]');
  // Nothing in focus: Keyforms and Properties, no Parameter section; the palette's rows have no edit button.
  assert.deepEqual([await shown('keyforms'), await shown('sel'), await shown('param')], [true, true, false]);
  assert.equal(await studio.locator('.ap-edit-btn').count(), 0, 'the palette is a control surface');
  // breathe alone: the Parameter section in place of Keyforms and Properties, with its range line and fields.
  await studio.locator('.ap-row[data-ctl="breathe"] > label').click();
  assert.deepEqual([await shown('keyforms'), await shown('sel'), await shown('param')], [false, false, true]);
  const slider = section.locator('.apm-slider');
  assert.equal(await slider.locator('.apm-range').textContent(), '0 to 1, default 0');
  assert.equal(await slider.locator('.apm-name').inputValue(), 'breathe');
  assert.equal(await slider.locator('.apm-ease').inputValue(), 'inout');
  assert.equal(await slider.locator('.apm-cat').inputValue(), 'Body');
  await slider.locator('.apm-default').fill('0.5');
  await slider.locator('.apm-default').press('Enter');
  assert.equal(await slider.locator('.apm-range').textContent(), '0 to 1, default 0.5');
  await studio.locator('[data-t="undo"]').click();
  assert.equal(await slider.locator('.apm-range').textContent(), '0 to 1, default 0', 'one undo step');
  // A pad: its own name and category, and its two parameters, each a way to that axis's fields.
  await studio.locator('.ap-padrow[data-ctl="pad:head_turn"] > label').click();
  assert.equal(await section.locator('.apm-pad').isVisible(), true);
  assert.equal(await section.locator('.apm-slider').isVisible(), false);
  assert.equal(await section.locator('.apm-pad .apm-name').inputValue(), 'head_turn');
  assert.deepEqual(await section.locator('.apm-axisbtn').allTextContents(), ['head_x', 'head_y']);
  await section.locator('.apm-axisbtn').first().click();
  assert.equal(await section.locator('.apm-slider .apm-name').inputValue(), 'head_x');
  assert.match(await section.locator('.apm-axis').textContent(), /An axis of the pad head_turn/);
  assert.equal(await section.locator('.apm-slider .apm-cat').isDisabled(), true, "an axis stays in its pad's category");
  // A part that head_x moves: the keyform, so Keyforms and Properties again.
  await studio.locator('.as-tree .as-row[data-part="head"]').click();
  assert.deepEqual([await shown('keyforms'), await shown('sel'), await shown('param')], [true, true, false]);
  // Copy form at key 1 through the action row's ⋯; Paste needs something copied first.
  const key = at => studio.locator('.ab-key', { hasText: new RegExp(`^${at}$`) }).click();
  const rot = () => studio.locator('[data-bf="rot"]').inputValue();
  await key(-1);
  assert.equal(await rot(), '-8');
  assert.equal(await studio.locator('.ab-pasteform').isDisabled(), true);
  assert.match(await studio.locator('.ab-pasteform').getAttribute('title'), /^Nothing copied yet/);
  await key(1);
  await studio.locator('.as-focus .ab-more').click();
  assert.deepEqual(await page.locator('.ctxmenu:not([hidden]) button').allTextContents(), ['Copy form', 'Paste form', 'Paste mirrored']);
  await page.locator('.ctxmenu:not([hidden]) button', { hasText: 'Copy form' }).click();
  assert.match(await studio.locator('.as-note').textContent(), /^Copied the pose of head at head_x = 1:/);
  // Paste at -1, then Paste mirrored there: each is one undo step.
  await key(-1);
  await studio.locator('.ab-pasteform').click();
  assert.equal(await rot(), '8', 'pasted as copied');
  assert.equal(await studio.locator('[data-bf="dx"]').inputValue(), '0.012');
  await studio.locator('.ab-pastemirror').click();
  assert.equal(await rot(), '-8', 'mirrored: rotation and x move change sign');
  assert.equal(await studio.locator('[data-bf="dx"]').inputValue(), '-0.012');
  await studio.locator('[data-t="undo"]').click();
  assert.equal(await rot(), '8', 'one undo takes the mirrored paste back');
  await studio.locator('[data-t="undo"]').click();
  assert.equal(await rot(), '-8', 'and one more the first paste');
  // Reset puts the key back to rest; a key between keys has nothing to reset.
  await studio.locator('.ab-reset').click();
  assert.equal(await rot(), '0');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: the Warp tool shows the lattice of the chosen part, a point drag is one undo step, a preset writes keys', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo: its torso has a 2x3 warp on `breathe`
  const studio = page.locator('#animStudio');
  await studio.locator('.as-tree .as-row[data-part="torso"]').waitFor();
  const stageFrame = () => page.frames().find(f => f.url().includes('studio='));
  const handles = () => stageFrame().evaluate(() => [...document.querySelectorAll('svg circle[stroke="#000"]')].map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]));
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelector('svg.studio-gizmo'));
  await studio.locator('.as-tree .as-row[data-part="torso"]').click();
  const breathe = studio.locator('.ap-row[data-ctl="breathe"] .ap-num');
  const setBreathe = async v => { await breathe.fill(String(v)); await breathe.press('Enter'); };
  await studio.locator('.ap-row[data-ctl="breathe"] > label').click(); // the warp is keyed to the active parameter: the author picks it
  assert.equal(await studio.locator('[data-gz="warp"]').isVisible(), true, 'the Warp tool is in the tool row in Model mode');
  assert.equal((await handles()).length, 0, 'no lattice before the Warp tool is chosen');
  await page.keyboard.press('d'); // the tool's key
  assert.equal(await studio.locator('[data-gz="warp"]').getAttribute('aria-pressed'), 'true');
  const deform = studio.locator('.as-sub[data-sub="deform"]');
  assert.equal(await deform.getAttribute('data-open'), 'false', 'a warp to edit: Deform stays folded (the bar and the stage have the tool)');
  assert.equal(await deform.locator('.as-sub-sum').textContent(), 'Lattice 2×3');
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 12);
  assert.equal(await studio.locator('.as-focus').getAttribute('data-param'), 'breathe', 'the header names the parameter the warp is keyed to');
  assert.equal(await studio.locator('.aw-param').count(), 0, 'Deform has no parameter choice or slider of its own');
  // The warp's keyform is in Keyforms: its key strip and the Point row; Properties has neither.
  const keyBtns = studio.locator('.ab .ab-keybtns button');
  assert.equal(await keyBtns.count(), 2);
  assert.equal(await studio.locator('.ab .ab-points .aw-pt').isVisible(), true, 'the Point row stands in place of the pose fields');
  assert.equal(await studio.locator('.ab .ab-form label').first().isVisible(), false, 'no pose fields for a warp');
  for (const cls of ['.aw-pt', '.aw-form', '.aw-keys', '.aw-delkey', '.aw-reset', '.aw-active']) assert.equal(await studio.locator(`.as-sect[data-sect="sel"] ${cls}`).count(), 0, `${cls} is not in Properties`);
  assert.equal(await studio.locator('.ap-row[data-ctl="breathe"] .ap-tick').count(), 2, 'the slider track has a mark at each key of the warp');
  assert.equal(await studio.locator('.ap-row[data-ctl="lean"] .ap-tick').count(), 0, 'a parameter the warp is not keyed to has none');
  // The slider value selects the keyform: on the key at 1, a drag changes that key, and the point follows the pointer.
  await setBreathe(1);
  assert.match(await studio.locator('.ab .ab-formtext').textContent(), /^the warp of torso at 1 \(a key\): a drag changes it$/);
  assert.equal(await studio.locator('.ab .ab-keyhere').textContent(), 'Remove this key');
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
  assert.match(await studio.locator('.ab .ab-formtext').textContent(), /^the warp of torso at 0\.5: between keys/);
  const half = (await handles())[4];
  await page.mouse.move(box.x + half[0], box.y + half[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + half[0] + 12, box.y + half[1]);
  await page.mouse.up();
  assert.deepEqual(await keyBtns.allTextContents(), ['0', '0.5', '1']);
  assert.equal(await studio.locator('.ab .ab-keybtns button[aria-pressed="true"]').textContent(), '0.5', 'the key the slider is on');
  await studio.locator('.ab .ab-keyhere').click(); // Remove this key
  assert.deepEqual(await keyBtns.allTextContents(), ['0', '1'], 'Remove this key removes the warp key at the value');
  await studio.locator('[data-t="undo"]').click();
  await studio.locator('[data-t="undo"]').click();
  assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true);
  // Add key here holds the shape on show; ‹ goes to the key before.
  assert.equal(await studio.locator('.ab .ab-keyhere').textContent(), 'Add key here');
  await studio.locator('.ab .ab-keyhere').click();
  assert.deepEqual(await keyBtns.allTextContents(), ['0', '0.5', '1']);
  assert.match(await studio.locator('.ab .ab-formtext').textContent(), /at 0\.5 \(a key\)/);
  await studio.locator('[data-t="undo"]').click();
  await studio.locator('.ab .ab-prev').click();
  assert.equal(await breathe.inputValue(), '0');
  // Copy the shape at 1, paste it at 0.5 (a new key with the same moves), then Reset the chosen point there.
  await setBreathe(1);
  await studio.locator('.aw-pick').selectOption('3'); // the sample's breathe key at 1 moves point 3 in
  const dx1 = await studio.locator('.aw-dx').inputValue();
  assert.equal(dx1, '-0.006');
  assert.equal(await studio.locator('.ab .ab-pasteform').isDisabled(), true, 'nothing copied yet');
  await studio.locator('.ab .ab-copyform').click();
  await setBreathe(0.5);
  assert.equal(await studio.locator('.ab .ab-pastemirror').isDisabled(), false, 'a lattice pastes mirrored too');
  await studio.locator('.ab .ab-pasteform').click();
  assert.deepEqual(await keyBtns.allTextContents(), ['0', '0.5', '1']);
  assert.equal(await studio.locator('.aw-dx').inputValue(), dx1, 'point 3 moves at 0.5 as it does at 1');
  assert.equal(await studio.locator('.ab .ab-reset').isDisabled(), false, 'a point is chosen');
  await studio.locator('.ab .ab-reset').click();
  assert.equal(await studio.locator('.aw-dx').inputValue(), '0', 'Reset took the chosen point back to rest in this keyform');
  await studio.locator('[data-t="undo"]').click();
  await studio.locator('[data-t="undo"]').click();
  assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true);
  // A part with no warp (legs; the face is in the head group warp): Add warp gives it the default lattice and turns the tool on; a preset writes keys for a parameter.
  await studio.locator('.as-tree .as-row[data-part="legs"]').click();
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 0); // a part without a warp has no lattice
  assert.equal(await deform.getAttribute('data-open'), 'true', 'no warp: Deform opens by itself');
  assert.equal(await deform.locator('.as-sub-sum').textContent(), 'No warp');
  assert.equal(await studio.locator('.aw-addbtn').getAttribute('aria-label'), 'Add warp to legs', "Add warp is the line's verb");
  await studio.locator('.aw-addbtn').click();
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 25);
  assert.equal(await deform.locator('.as-sub-sum').textContent(), 'Lattice 4×4');
  assert.equal(await studio.locator('.aw-remove').getAttribute('aria-label'), 'Remove warp', 'the new warp can be removed from the line');
  // A parameter that does not move the part leaves it out of the focus: bind the warp with Bind parts… (the Warp tool binds warps) to key it.
  await studio.locator('.ap-row[data-ctl="breathe"] > label').click();
  await bindParts(studio, 'legs');
  await studio.locator('.aw-presetbtn').click(); // Presets ▾ in the tool options bar
  await studio.locator('.aw-preset').selectOption('sway');
  await studio.locator('.aw-write').click();
  assert.equal(await studio.locator('.aw-presets').isVisible(), false, 'Write keys closes the panel, which would cover the key strip');
  assert.deepEqual(await studio.locator('.ab .ab-keybtns button').allTextContents(), ['0', '1'], 'rest at the default, the bend at the far end');
  assert.match(await page.locator('.as-note').textContent(), /Sway written as the keys of breathe/);
  // Moving the slider to a key shows the shape: the lattice moves with it.
  const rest = await handles();
  await studio.locator('.ab .ab-keybtns button', { hasText: '1' }).last().click();
  let bent = rest;
  for (let i = 0; i < 40 && !(bent[24][0] > rest[24][0] + 1.5); i++) { await page.waitForTimeout(100); bent = await handles(); } // the stage answers a moment after the slider
  assert.ok(bent[24][0] > rest[24][0] + 1.5 && Math.abs(bent[24][1] - rest[24][1]) < 0.5 && Math.abs(bent[0][0] - rest[0][0]) < 0.5, `the bottom row bends sideways, the top row stays (${rest[24]} ${bent[24]} / ${rest[0]} ${bent[0]})`);
  // Leaving the tool folds Deform again, as the tool opened it.
  await studio.locator('[data-gz="move"]').click();
  assert.equal(await deform.getAttribute('data-open'), 'false', 'folded when the tool is left');
  // Animate mode has neither the tool nor Deform.
  await studio.locator('.as-modes [data-mode="animate"]').click();
  assert.equal(await studio.locator('[data-gz="warp"]').isVisible(), false);
  assert.equal(await deform.isVisible(), false);
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 0); // the lattice is gone
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: a group warp shows its lattice for each member, a target choice, its members, and Add group warp from a bone', { viewport: { width: 1280, height: 800 } }, async ({ context, page, errors }) => {
  await withoutRoboFrameTracks(context);
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo: head_warp is a 3x3 group warp over face, eyes and mouth
  const studio = page.locator('#animStudio');
  await studio.locator('.as-tree .as-row[data-part="face"]').waitFor();
  const count = () => page.frames().find(f => f.url().includes('studio=')).evaluate(() => document.querySelectorAll('svg circle[stroke="#000"]').length);
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelector('svg.studio-gizmo'));
  await studio.locator('.as-tree .as-row[data-part="face"]').click();
  await page.keyboard.press('d');
  const sum = studio.locator('.as-sub[data-sub="deform"] .as-sub-sum'), grid = async () => [await studio.locator('.aw-cols').inputValue(), await studio.locator('.aw-rows').inputValue()];
  const target = () => studio.locator('.aw-targetpick').evaluate(s => s.selectedOptions[0]?.textContent ?? '');
  assert.equal(await sum.textContent(), '', "the Target ▾ in Deform's line names the group");
  assert.equal(await target(), 'group head_warp (3 parts, 1 shape)');
  assert.deepEqual(await grid(), ['3', '3']);
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 16);
  assert.equal(await studio.locator('.as-sub[data-sub="deform"] .as-sub-pick .aw-target').isVisible(), true, "a member of a group warp gets the target choice, in Deform's line");
  assert.deepEqual(await studio.locator('.aw-targetpick option').allTextContents(), ['group head_warp (3 parts, 1 shape)']);
  assert.equal(await studio.locator('.aw-addbtn').getAttribute('aria-label'), 'Add warp to face', 'the face has no warp of its own yet');
  assert.equal(await studio.locator('.aw-member:checked').count(), 4, 'three parts and the eyelids shape');
  assert.equal(await studio.locator('.aw-remove').getAttribute('aria-label'), 'Remove group warp');
  // The eyes are in the same group: the same lattice. Own warp plus group: the choice lists both, the own warp first.
  await studio.locator('.as-tree .as-row[data-part="eyes"]').click();
  assert.equal(await count(), 16);
  await studio.locator('.aw-addbtn').click();
  assert.deepEqual(await studio.locator('.aw-targetpick option').allTextContents(), ['own warp eyes_warp', 'group head_warp (3 parts, 1 shape)']);
  assert.equal(await studio.locator('.aw-targetpick').inputValue(), 'eyes_warp');
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 25);
  await studio.locator('.aw-targetpick').selectOption('head_warp');
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 16);
  // Members (in Deform's body: the author opens it, as the tool has a warp to edit): only the members are listed; untick the mouth, add it again with Add….
  await studio.locator('.as-sub[data-sub="deform"] .as-sub-head').click();
  assert.equal(await studio.locator('.aw-member').count(), 4, 'the members only, not a checkbox for every part');
  await studio.locator('.aw-member[value="mouth"]').click(); // unticked, it leaves the list (uncheck() cannot see it unchecked)
  assert.equal(await studio.locator('.aw-member:checked').count(), 3);
  assert.equal(await studio.locator('.aw-member[value="mouth"]').count(), 0);
  assert.ok((await studio.locator('.aw-addmember option').allTextContents()).includes('mouth'), 'Add… lists it now');
  await studio.locator('.aw-addmember').selectOption('mouth');
  assert.equal(await studio.locator('.aw-member:checked').count(), 4, 'three parts and the eyelids shape');
  // A bone: the group warp over every part on it takes the parts from head_warp, which has none left and goes.
  await studio.locator('.as-tree .as-row[data-part="head"]').click();
  assert.equal(await studio.locator('.aw-groupbtn').getAttribute('aria-label'), 'Add group warp from head');
  await studio.locator('.aw-groupbtn').click();
  assert.equal(await studio.locator('.aw-targetpick').inputValue(), 'head_warp', 'the old group lost every member and went, so its id is free again');
  assert.equal(await studio.locator('.aw-member:checked').count(), 5, 'antenna, face, eyes and mouth, and the eyelids shape on the head bone');
  assert.equal(await target(), 'group head_warp (4 parts, 1 shape)');
  assert.deepEqual(await grid(), ['4', '4'], 'a new group warp has the default lattice');
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 25);
  await studio.locator('.aw-remove').click();
  assert.equal(await studio.locator('.aw-target').isVisible(), false, 'the group warp is gone');
  assert.equal(await sum.textContent(), 'No group warp');
  await studio.locator('.as-tree .as-row[data-part="eyes"]').click();
  assert.equal(await sum.textContent(), 'Lattice 4×4', 'the eyes warp is left');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: warp points are chosen by rectangle, Shift-click and rows; a drag moves the selection (soft or hard) in one undo step; a group warp point drags too', { viewport: { width: 1280, height: 800 } }, async ({ t, context, page, errors }) => {
  await withoutRoboFrameTracks(context);
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo: the torso has a 2x3 warp on `breathe` (12 points, 3 per row)
  const studio = page.locator('#animStudio');
  await studio.locator('.as-tree .as-row[data-part="torso"]').waitFor();
  const stage = () => page.frames().find(f => f.url().includes('studio='));
  const dots = () => stage().evaluate(() => [...document.querySelectorAll('svg circle[stroke="#000"], svg circle[stroke="#ff3b6b"]')].map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy')), c.getAttribute('fill') === '#ff3b6b' ? 1 : 0]));
  const chosen = async () => (await page.waitForTimeout(250), await dots()).flatMap((d, i) => (d[2] ? [i] : []));
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelector('svg.studio-gizmo'));
  await studio.locator('.as-tree .as-row[data-part="torso"]').click();
  await studio.locator('.ap-row[data-ctl="breathe"] > label').click();
  const breathe = studio.locator('.ap-row[data-ctl="breathe"] .ap-num');
  await breathe.fill('1');
  await breathe.press('Enter');
  await studio.locator('[data-gz="warp"]').click(); // not the D key: the slider's field has the focus
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 12);
  const box = await studio.locator('.as-stage iframe').boundingBox(), before = await dots();
  const at = i => [box.x + before[i][0], box.y + before[i][1]];
  // A rectangle round the first two rows chooses those six points; a plain click on empty stage would have picked a part instead.
  const [x0, y0] = at(0), [x1, y1] = at(5);
  await page.mouse.move(x0 - 20, y0 - 20);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x0 - 20 + ((x1 - x0 + 40) * i) / 6, y0 - 20 + ((y1 - y0 + 25) * i) / 6);
  await page.mouse.up();
  assert.deepEqual(await chosen(), [0, 1, 2, 3, 4, 5]);
  assert.equal(await studio.locator('.aw-selhint').textContent(), '6 chosen');
  // Shift-click adds a point and, again, takes it away.
  await page.keyboard.down('Shift');
  await page.mouse.click(...at(7));
  assert.deepEqual(await chosen(), [0, 1, 2, 3, 4, 5, 7]);
  await page.mouse.click(...at(7));
  await page.keyboard.up('Shift');
  assert.deepEqual(await chosen(), [0, 1, 2, 3, 4, 5]);
  // A drag of one chosen point moves all of them by the same amount, the rest stay: one undo step.
  const [px, py] = at(4);
  await page.mouse.move(px, py);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(px + i * 6, py + i * 2);
  await page.mouse.up();
  const moved = await dots();
  moved.forEach((d, i) => {
    const dx = d[0] - before[i][0], dy = d[1] - before[i][1];
    if (i < 6) assert.ok(Math.abs(dx - 30) < 0.8 && Math.abs(dy - 10) < 0.8, `chosen point ${i} followed (${dx}, ${dy})`);
    else assert.ok(Math.abs(dx) < 0.8 && Math.abs(dy) < 0.8, `point ${i} stayed (${dx}, ${dy})`);
  });
  assert.match(await studio.locator('.aw-pthint').textContent(), /^6 points chosen/);
  await studio.locator('[data-t="undo"]').click();
  assert.equal(await studio.locator('[data-t="undo"]').isDisabled(), true, 'the whole group drag was one step');
  // Rows and columns from the lists; Soft pulls the neighbours of one chosen point along, less the farther away.
  await studio.locator('.aw-rowpick').selectOption('1');
  assert.deepEqual(await chosen(), [3, 4, 5]);
  await studio.locator('.aw-colpick').selectOption('2');
  assert.deepEqual(await chosen(), [2, 5, 8, 11]);
  await studio.locator('.aw-pick').selectOption('4');
  assert.deepEqual(await chosen(), [4]);
  await studio.locator('.aw-soft').click();
  assert.equal(await studio.locator('.aw-soft').getAttribute('aria-pressed'), 'true');
  await studio.locator('.aw-softopts').click(); // its reach is under ▾
  await studio.locator('.aw-radius').fill('2');
  await studio.locator('.aw-radius').dispatchEvent('change');
  await page.mouse.move(px, py);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(px + i * 6, py);
  await page.mouse.up();
  const soft = await dots(), shift = i => soft[i][0] - before[i][0];
  assert.ok(Math.abs(shift(4) - 30) < 0.8, 'the chosen point went the whole way');
  assert.ok(shift(5) > 3 && shift(5) < shift(4) - 3, `a neighbour followed part of the way (${shift(5)})`);
  assert.ok(Math.abs(shift(11)) < 0.8, 'a point out of reach stayed');
  await studio.locator('[data-t="undo"]').click();
  // Mirror selection and Scale act on the chosen points.
  await studio.locator('.aw-soft').click();
  await studio.locator('.aw-all').click();
  assert.equal((await chosen()).length, 12);
  await studio.locator('.aw-xfbtn').click(); // the factor is under ▾; the Scale icon applies it
  await studio.locator('.aw-scale').fill('1.5');
  await studio.locator('.aw-scale-go').click();
  const widened = d => d[2][0] - d[0][0] > (before[2][0] - before[0][0]) * 1.4;
  let grown = await dots();
  for (let i = 0; i < 40 && !widened(grown); i++) { await page.waitForTimeout(50); grown = await dots(); } // the stage redraws a moment later
  assert.ok(grown[2][0] - grown[0][0] > (before[2][0] - before[0][0]) * 1.4, 'scaling about the selection widened the lattice');
  await studio.locator('.aw-clear').click();
  assert.deepEqual(await chosen(), []);
  await studio.locator('[data-t="undo"]').click();
  // A group warp: a new one from the head bone, keyed to a slider, drags a point like a part warp does.
  await studio.locator('.as-tree .as-row[data-part="head"]').click();
  await studio.locator('.aw-groupbtn').click();
  await studio.locator('.ap-row[data-ctl="lean"] > label').click();
  await bindParts(studio, 'head');
  const lean = studio.locator('.ap-row[data-ctl="lean"] .ap-num');
  await lean.fill('1');
  await lean.press('Enter');
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 25);
  // The lattice still settles to the lean=1 pose for a moment on a loaded page: read it until it holds still.
  let g0 = await dots();
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(100);
    const again = await dots();
    if (JSON.stringify(again) === JSON.stringify(g0)) break;
    g0 = again;
  }
  const [gx, gy] = [box.x + g0[12][0], box.y + g0[12][1]];
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(gx + i * 6, gy + i * 2);
  await page.mouse.up();
  const g1 = await dots();
  assert.ok(Math.abs(g1[12][0] - g0[12][0] - 30) < 1 && Math.abs(g1[12][1] - g0[12][1] - 10) < 1, `the group point followed the pointer (${g1[12]} from ${g0[12]})`);
  assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), false);
  assert.deepEqual(errors, [], 'the page threw errors');
});

/**
 * robo's blink and talk animations (the sample's automatic ones) key the eyes' and mouth's frames, and a part with a frame
 * track cannot be warped, so the group warp over the head bone refuses. The tests of that warp serve robo's rig.json
 * without those two frame tracks.
 */
const withoutRoboFrameTracks = context => patchProject(context, proj => {
  const rig = JSON.parse(proj.rigTexts.robo);
  for (const name of ['blink', 'talk']) delete rig.animations[name].frames;
  proj.rigTexts.robo = JSON.stringify(rig, null, 2);
});

/** The mask shapes' tests share these: the stage page's frame, its dashed outlines and the point handles of the Mask tool. */
const maskStage = page => {
  const frame = () => page.frames().find(f => f.url().includes('studio='));
  return {
    outlines: () => frame().evaluate(() => document.querySelectorAll('svg polygon[stroke-dasharray]').length),
    handles: () => frame().evaluate(() => [...document.querySelectorAll('svg circle[stroke="#000"]')].map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))])),
    /** The middle of the first edge of the first dashed outline, in the stage frame's pixels. */
    edge: () => frame().evaluate(() => {
      const pts = document.querySelector('svg polygon[stroke-dasharray]').getAttribute('points').trim().split(/\s+/).map(s => s.split(',').map(Number));
      return [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    }),
  };
};

browserTest('animation studio: a shape has its own row, the Mask tool outlines every shape and edits the chosen one, a shape is picked by its row or its outline', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo: its eyes are clipped to the shape part `eyelids`
  const studio = page.locator('#animStudio');
  await studio.locator('.as-tree .as-row[data-part="eyes"]').waitFor();
  const { outlines, handles, edge } = maskStage(page);
  const clip = studio.locator('.as-sub[data-sub="clip"]'), sum = clip.locator('.as-sub-sum'), row = studio.locator('.as-tree .as-row[data-part="eyelids"]');
  const clipOpen = () => clip.locator('.as-sub-head').getAttribute('aria-expanded'), bar = studio.locator('.atb[data-bar="mask"]');
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelector('svg.studio-gizmo'));
  // The shape is a row of its own: a badge and the bone it sits on, no thumbnail, no eye and no keys.
  assert.equal(await row.count(), 1, 'a row for the shape part');
  assert.equal(await row.locator('.as-badge-shape').textContent(), 'shape');
  assert.match(await row.textContent(), /on head, clips eyes/);
  assert.equal(await studio.locator('.as-shaperow .as-eye, .as-shaperow img, .as-shaperow .as-keyed').count(), 0, 'nothing that applies to drawn parts');
  assert.equal(await studio.locator('[data-gz="mask"]').isVisible(), true, 'the Mask tool is in the tool row in Model mode');
  assert.equal(await clip.isVisible(), false, 'nothing chosen: no Clip sub-block');
  assert.equal(await outlines(), 0, 'no outline until a shape is chosen');
  // Choosing the shape row chooses the shape: its outline shows, its points are handles only with the Mask tool.
  await row.click();
  assert.equal(await row.getAttribute('aria-pressed'), 'true');
  assert.equal(await sum.textContent(), 'Shape on head, 4 points, clips 1');
  assert.equal(await clipOpen(), 'false', 'with Move, Clip is its folded line');
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg polygon[stroke-dasharray]').length === 1);
  assert.equal((await handles()).length, 0);
  await page.keyboard.press('m'); // the tool's key
  assert.equal(await studio.locator('[data-gz="mask"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await clipOpen(), 'true', 'the Mask tool opens Clip by itself: the shape has points to edit');
  assert.deepEqual(await bar.locator('button').evaluateAll(bs => bs.map(b => [b.className.split(' ').pop(), b.getAttribute('aria-label'), b.disabled, b.textContent.trim()])), [['am-add', 'Add point after', false, ''], ['am-del', 'Remove point', true, '']], 'the Mask bar holds the point buttons, icons, Remove point waiting for a point');
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 4);
  assert.equal(await studio.locator('.am-name').inputValue(), 'eyelids');
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
  assert.equal(await sum.textContent(), 'Shape on head, 5 points, clips 1');
  assert.equal(await studio.locator('.am-pick').inputValue(), '3', 'the new point is chosen');
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 5);
  await studio.locator('.am-del').click();
  assert.equal(await sum.textContent(), 'Shape on head, 4 points, clips 1');
  for (let i = 0; i < 3; i++) await studio.locator('[data-t="undo"]').click();
  assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true, 'three edits, three undo steps');
  // The part row edits the same shape (its clip target is a picker), a bone has none.
  await studio.locator('.as-tree .as-row[data-part="eyes"]').click();
  assert.equal(await sum.textContent(), 'Clipped to');
  assert.equal(await clip.locator('.as-sub-line .am-target').count(), 1, 'once clipped, Clip to ▾ stands in the head line');
  assert.equal(await studio.locator('.am-target').inputValue(), 'eyelids');
  assert.equal((await handles()).length, 4, 'a part row shows the points of its shape');
  await studio.locator('.as-tree .as-row[data-part="head"]').click();
  await poll(page, async () => (await handles()).length === 0); // the stage gets the new choice a message later; a loaded machine is slower
  assert.equal((await handles()).length, 0, 'a bone has no shape of its own: no handles');
  assert.equal(await outlines(), 1, 'but with the Mask tool every shape is outlined');
  assert.equal(await clip.isVisible(), false, 'a bone has no Clip');
  assert.equal(await bar.locator('.am-add').isDisabled(), true, 'nor a shape to add points to');
  // A click near an outline picks that shape.
  const [ex, ey] = await edge();
  await page.mouse.click(box.x + ex, box.y + ey);
  await until(page, () => document.querySelector('#animStudio .as-tree .as-row[data-part="eyelids"]')?.getAttribute('aria-pressed') === 'true'); // the stage answers by message
  assert.equal(await row.getAttribute('aria-pressed'), 'true', 'the click on the outline chose the shape');
  assert.equal((await handles()).length, 4, 'and its points are handles now');
  // Without the Mask tool the outlines are not there to click.
  await studio.locator('.as-tree .as-row[data-part="head"]').click();
  await studio.locator('[data-gz="move"]').click();
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg polygon[stroke-dasharray]').length === 0);
  await page.mouse.click(box.x + ex, box.y + ey);
  await page.waitForTimeout(300); // long enough for the stage's answer, were there one
  assert.notEqual(await row.getAttribute('aria-pressed'), 'true', 'no shape is picked while another tool is on');
  // Clip folds again when the Mask tool is left, unless the author folded or opened it meanwhile; then it stays as they left it.
  await studio.locator('.as-tree .as-row[data-part="eyes"]').click();
  assert.equal(await clipOpen(), 'false');
  await studio.locator('[data-gz="mask"]').click();
  assert.equal(await clipOpen(), 'true', 'the tool opens it by itself on a part clipped to a shape');
  await studio.locator('[data-gz="move"]').click();
  assert.equal(await clipOpen(), 'false', 'leaving the tool folds it again');
  await studio.locator('[data-gz="mask"]').click();
  await clip.locator('.as-sub-head').click();
  assert.equal(await clipOpen(), 'false', 'the author folds it');
  await studio.locator('.as-tree .as-row[data-part="eyelids"]').click();
  assert.equal(await clipOpen(), 'false', 'and it does not open by itself again while the tool is on');
  await clip.locator('.as-sub-head').click();
  await studio.locator('[data-gz="move"]').click();
  assert.equal(await clipOpen(), 'true', 'opened by the author, it stays open when the tool is left');
  await clip.locator('.as-sub-head').click();
  // A shape keyed in rig.json (eyelids on eye_open): with the Mask tool Keyforms lists its keys to go to, and says where they are written.
  await studio.locator('[data-gz="mask"]').click();
  await studio.locator('.ab-paramslot .ab-crumbpick').click();
  await studio.locator('.ab-aff', { hasText: 'eye_open' }).click();
  assert.deepEqual(await studio.locator('.ab .ab-keybtns button').allTextContents(), ['0', '1']);
  assert.equal(await studio.locator('.ab .ab-keyhere').isVisible(), false, 'a mask key is not added or removed here');
  assert.equal(await studio.locator('.ab .ab-form .as-pivot-name').textContent(), 'Shape');
  assert.match(await studio.locator('.ab .ab-formtext').textContent(), /^The keys of eyelids on eye_open reshape it; they are written in rig\.json/);
  assert.equal(await studio.locator('.ab .ab-ops').isVisible(), false, 'nothing to copy or paste');
  await studio.locator('[data-gz="move"]').click();
  // Animate mode has neither the tool, the sub-block nor the row.
  await studio.locator('.as-modes [data-mode="animate"]').click();
  assert.equal(await studio.locator('[data-gz="mask"]').isVisible(), false);
  assert.equal(await clip.isVisible(), false);
  assert.equal(await row.count(), 0);
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg polygon[stroke-dasharray]').length === 0);
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: New shape, rename and delete; a shape shared by two parts is written once on Apply', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click();
  const studio = page.locator('#animStudio'), note = studio.locator('.as-note'), apply = studio.locator('[data-t="apply"]'), row = n => studio.locator(`.as-tree .as-row[data-part="${n}"]`);
  await row('mouth').waitFor();
  const { handles } = maskStage(page);
  await row('mouth').click();
  await page.keyboard.press('m');
  assert.equal(await studio.locator('.am-target').inputValue(), '', 'the mouth is drawn whole');
  // New shape: on the part's bone, the part clipped to it, the tool on and the stage showing its points. (The stage reports the part's box a moment after the choice.)
  for (let i = 0; i < 40 && !(await row('mouth_mask').count()); i++) { await studio.locator('.am-new').click(); await page.waitForTimeout(100); }
  assert.equal(await row('mouth_mask').count(), 1, 'the new shape has a row');
  assert.match(await row('mouth_mask').textContent(), /on head, clips mouth/);
  assert.equal(await studio.locator('.am-target').inputValue(), 'mouth_mask');
  assert.equal(await studio.locator('.as-sub[data-sub="clip"] .as-sub-sum').textContent(), 'Clipped to');
  await until(page, () => document.querySelector('#animStudio .as-stage iframe')?.contentDocument?.querySelectorAll('svg circle[stroke="#000"]').length === 4);
  assert.equal((await handles()).length, 4);
  // Rename from the shape's own row: the clip follows, the row stays chosen.
  await row('mouth_mask').click();
  await studio.locator('.am-name').fill('lip');
  await studio.locator('.am-name').press('Enter');
  assert.equal(await row('mouth_mask').count(), 0);
  assert.equal(await row('lip').getAttribute('aria-pressed'), 'true');
  await row('mouth').click();
  assert.equal(await studio.locator('.am-target').inputValue(), 'lip', 'the clip followed the rename');
  await row('lip').click();
  await studio.locator('.am-name').fill('eyelids');
  await studio.locator('.am-rename').click();
  assert.match(await note.textContent(), /already the name of a part, a bone or a shape/);
  assert.equal(await row('lip').count(), 1, 'a taken name changes nothing');
  // Delete: the part is drawn whole again; the studio asks nothing, the note says what changed.
  await studio.locator('.am-delete').click();
  assert.equal(await row('lip').count(), 0);
  assert.match(await note.textContent(), /Deleted shape lip: mouth is drawn whole again/);
  assert.equal(await studio.locator('.as-tree .as-row[data-part=""]').getAttribute('aria-pressed'), 'true', 'nothing is chosen any more');
  await row('mouth').click();
  assert.equal(await studio.locator('.am-target').inputValue(), '');
  assert.equal(await apply.isDisabled(), true, 'the shape was made and deleted again: nothing differs from the file');
  const undo = studio.locator('[data-t="undo"]');
  for (let i = 0; i < 6 && !(await undo.isDisabled()); i++) await undo.click();
  assert.equal(await undo.isDisabled(), true, 'every step undone');
  assert.equal(await apply.isDisabled(), true);
  // Two parts clipped to one shape: one shape part in the file after Apply, both parts linked to it.
  await studio.locator('.am-target').selectOption('eyelids');
  assert.equal(await studio.locator('.as-sub[data-sub="clip"] .as-sub-sum').textContent(), 'Clipped to');
  assert.match(await row('eyelids').textContent(), /clips eyes, mouth/);
  await apply.click();
  await poll(page, () => saved.length, 50); // the rig.json tab is saved a moment after Apply
  assert.ok(saved.length, 'the rig.json tab was not saved');
  const rig = JSON.parse(saved.at(-1));
  assert.deepEqual(Object.entries(rig.parts).filter(([, v]) => v.polygon).map(([k]) => k), ['eyelids'], 'one shape part, not one per clipped part');
  assert.deepEqual([rig.parts.eyes.clip, rig.parts.mouth.clip], ['eyelids', 'eyelids']);
  assert.equal(rig.masks, undefined, 'the older list is not written');
  assert.deepEqual(rig.parts.eyelids.keyforms.map(k => k.param), ['eye_open'], 'the shape\'s keyforms are untouched');
  assert.equal(rig.deformers.find(d => d.id === 'head_warp').members.filter(m => m === 'eyelids').length, 1);
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: a Ctrl-click set shows what its parts share, blank when they differ, and sets a pivot, bone or clip on all as one undo step', { viewport: { width: 1440, height: 900 } }, async ({ t, page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click(); // robo
  const studio = page.locator('#animStudio'), row = n => studio.locator(`.as-tree .as-row[data-part="${n}"]`), sub = id => studio.locator(`.as-sub[data-sub="${id}"]`);
  const undo = studio.locator('[data-t="undo"]'), redo = studio.locator('[data-t="redo"]');
  const px = studio.locator('.as-pivot [data-p="x"]'), py = studio.locator('.as-pivot [data-p="y"]');
  const bone = sub('transform').locator('.as-bone-sel'), clipTo = studio.locator('.am-target');
  const blank = sel => sel.evaluate(s => s.selectedIndex);
  await row('face').waitFor();
  // face (no pivot, not clipped), eyes (no pivot, clipped to eyelids) and antenna (a pivot of its own): all on head.
  await row('face').click();
  await row('eyes').click({ modifiers: ['Control'] });
  await row('antenna').click({ modifiers: ['Control'] });
  const slot = studio.locator('.ab-partslot');
  assert.equal(await slot.getAttribute('data-set'), '3 parts', 'the focus header counts the set');
  assert.match(await slot.textContent(), /3 parts/);
  assert.equal(await studio.locator('.as-sect[data-sect="sel"] .as-sect-sum').textContent(), '3 parts', "and so does Properties' summary");
  assert.equal(await row('face').getAttribute('aria-pressed'), 'true');
  assert.equal(await row('eyes').evaluate(e => e.classList.contains('as-extra')), true, 'the rows added are marked in the tree');
  assert.deepEqual(await studio.locator('.as-sub:not([hidden])').evaluateAll(es => es.map(e => e.dataset.sub)), ['transform', 'deform', 'clip'], 'Skin and Variants are per part');
  assert.deepEqual([await px.inputValue(), await py.inputValue()], ['', ''], 'the pivots differ: blank');
  assert.equal(await bone.inputValue(), 'head', 'the bone they share');
  assert.equal(await clipTo.evaluate(s => !!s.closest('.as-sub-pick')), true, "mixed clips: Clip to ▾ is in Clip's line");
  assert.equal(await blank(clipTo), -1, 'and blank');
  assert.equal(await sub('clip').locator('.as-sub-sum').textContent(), 'Clip to');
  assert.equal(await sub('deform').locator('.as-sub-sum').textContent(), 'No group warp', 'antenna is not in head_warp: no group shared');
  assert.equal(await studio.locator('.aw-groupbtn').getAttribute('aria-label'), 'Add group warp from 3 selected parts');
  // A pivot typed is set on all three, as one undo step.
  await px.fill('100');
  await py.fill('200');
  await py.press('Enter');
  await until(page, () => document.querySelector('#animStudio .as-pivot [data-p="x"]')?.value === '100');
  assert.deepEqual([await px.inputValue(), await py.inputValue()], ['100', '200'], 'shared now');
  await undo.click();
  assert.deepEqual([await px.inputValue(), await py.inputValue()], ['', ''], 'one undo step takes all three back');
  await redo.click();
  assert.equal(await px.inputValue(), '100');
  // On bone ▾ re-hangs all three, as one undo step.
  await bone.selectOption('neck');
  assert.equal(await bone.inputValue(), 'neck');
  await undo.click();
  assert.equal(await bone.inputValue(), 'head');
  // Clip to ▾ clips all three, as one undo step; mixed again after the undo.
  await clipTo.selectOption('eyelids');
  assert.equal(await clipTo.inputValue(), 'eyelids');
  assert.equal(await sub('clip').locator('.as-sub-sum').textContent(), 'Clipped to');
  await undo.click();
  assert.equal(await blank(clipTo), -1);
  // Two parts in head_warp share it: Deform shows the group.
  await row('antenna').click({ modifiers: ['Control'] });
  assert.equal(await slot.getAttribute('data-set'), '2 parts');
  assert.equal(await studio.locator('.aw-targetpick').evaluate(s => s.selectedOptions[0]?.textContent), 'group head_warp (3 parts, 1 shape)');
  // A plain click is one part again; the pivot typed is each part's own.
  await row('antenna').click();
  assert.equal(await slot.getAttribute('data-set'), '');
  assert.deepEqual([await px.inputValue(), await py.inputValue()], ['100', '200']);
  await row('face').click();
  assert.equal(await px.inputValue(), '100', 'face got it too');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: shapes are group warp members, a group from a bone takes the shapes on it, and a clip whose shape is not in the group is flagged', { viewport: { width: 1280, height: 800 } }, async ({ page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click();
  const studio = page.locator('#animStudio'), row = n => studio.locator(`.as-tree .as-row[data-part="${n}"]`), members = () => studio.locator('.aw-memberlist input:checked').evaluateAll(els => els.map(e => e.value).sort());
  await row('eyelids').waitFor();
  // The Warp tool works on a shape row: the shape has no warp of its own, its group is the target and is marked as a shape.
  await row('eyelids').click();
  await page.keyboard.press('d');
  const deformLine = studio.locator('.as-sub[data-sub="deform"]');
  assert.equal(await deformLine.getAttribute('data-open'), 'false', 'a group to edit: Deform stays folded');
  assert.equal(await deformLine.locator('.aw-targetpick').evaluate(s => s.selectedOptions[0]?.textContent), 'group head_warp (3 parts, 1 shape)', 'its line names the group that bends the shape');
  await deformLine.locator('.as-sub-head').click(); // its members are in the body
  assert.equal(await studio.locator('.aw-members').isVisible(), true);
  assert.deepEqual(await members(), ['eyelids', 'eyes', 'face', 'mouth']);
  assert.match(await studio.locator('.aw-memberrow', { hasText: 'eyelids' }).textContent(), /eyelids \(shape\)/);
  assert.match(await studio.locator('.aw-targethint').textContent(), /eyelids is a mask shape/);
  assert.equal(await studio.locator('.aw-addbtn').isVisible(), false, 'no own warp for a shape');
  // Taking the shape out of the group while its part stays in: the part row says so and offers the fix.
  await studio.locator('.aw-memberrow', { hasText: 'eyelids' }).locator('input').uncheck();
  assert.equal(await studio.locator('.aw-members').isVisible(), false, 'a shape out of every group has no warp to show');
  assert.equal(await studio.locator('.as-sub[data-sub="deform"] .as-sub-sum').textContent(), 'In no group warp');
  assert.match(await studio.locator('.aw-none').textContent(), /no warp of its own/);
  await row('eyes').click();
  assert.match(await studio.locator('.aw-clipissue').textContent(), /eyes is clipped to eyelids, which is not in this group/);
  const warn = studio.locator('.as-sub[data-sub="clip"] .as-sub-warn');
  assert.equal(await warn.isVisible(), true, "Clip's line flags it");
  assert.match(await warn.getAttribute('title'), /^eyes is bent by the group warp head_warp, but its shape eyelids is not a member.*Properties › Deform has the fix/);
  assert.equal(await studio.locator('.aw-clipissue').count(), 1, 'the issue shows once, in Deform');
  await studio.locator('.aw-fixclip').click();
  assert.equal(await studio.locator('.aw-clipissue').count(), 0);
  assert.equal(await warn.isVisible(), false);
  assert.deepEqual(await members(), ['eyelids', 'eyes', 'face', 'mouth']);
  // A group warp from the head bone takes its parts and the shape on it; so does one from the ticked rows.
  await row('head').click();
  await studio.locator('.aw-groupbtn').click();
  assert.ok((await members()).includes('eyelids'), 'the new group has the shape too');
  await row('mouth').click();
  await row('eyelids').click({ modifiers: ['Control'] });
  assert.equal(await studio.locator('.aw-groupbtn').getAttribute('aria-label'), 'Add group warp from 2 selected parts');
  assert.deepEqual(errors, [], 'the page threw errors');
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

/** A roboHeads patch that takes the robo's own mask (the eyelids shape part and the `clip` on its eyes) out of its rig, then lays `patch` over it. */
const noMasks = (patch = {}, clips = {}) => rig => {
  const parts = {};
  for (const [name, def] of Object.entries(rig.parts ?? {})) if (!def.polygon) { const { clip: _clip, ...rest } = def; parts[name] = rest; }
  for (const [part, to] of Object.entries(clips)) parts[part] = { ...(parts[part] ?? {}), clip: to };
  return { parts, ...patch };
};

/** The head of the sample robo as a screenshot, with `patch` laid over its rig.json (the sample on disk is not touched), at each of `lines` of ROBO_FROM_VN. */
async function roboHeads(patch, lines, script = ROBO_FROM_VN, file = 'robofrom.vn') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await patchProject(context, proj => {
    proj.scripts = [...proj.scripts, { file, text: script }];
    proj.rigs.robo.rig = { ...proj.rigs.robo.rig, ...(typeof patch === 'function' ? patch(proj.rigs.robo.rig) : patch) };
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
      shots.push({ snap, parts: await page.evaluate(() => window.vnParts('robo')), img: decodePng(await page.screenshot()), canvas: await page.locator('canvas#canvas').boundingBox() });
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

/** A free mesh (a six-vertex quad strip) on robo's 30 x 40 collar, which has no deformer; its bottom row slides sideways as "flap" goes 0 to 1. */
const collarMesh = flap => rig => ({
  parameters: [...rig.parameters, { id: 'flap', min: 0, max: 1, default: flap }],
  deformers: [...(rig.deformers ?? []), { id: 'collar_mesh', part: 'collar', mesh: { verts: [0, 0, 15, 0, 30, 0, 0, 40, 15, 40, 30, 40], tris: [0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4] },
    keyforms: [{ param: 'flap', keys: [{ at: 0 }, { at: 1, pts: { 3: [0.03, 0], 4: [0.03, 0], 5: [0.03, 0] } }] }] }],
});

test('free mesh: a part on a triangle mesh is drawn, and its vertices move with the parameter', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const lines = [/Robo rests/];
  const [still] = await roboHeads(collarMesh(0), lines, ROBO_VN, 'robomesh.vn');
  const [moved] = await roboHeads(collarMesh(1), lines, ROBO_VN, 'robomesh.vn');
  const [plain] = await roboHeads({}, lines, ROBO_VN, 'robomesh.vn');
  const { canvas } = still, k = canvas.width / 1920, [bx, by, bw, bh] = still.snap.bounds;
  const area = shot => [Math.round(canvas.x + bx * k), Math.round(canvas.y + by * k), Math.round(bw * k), Math.round(bh * k)];
  assert.ok(differing(still.img, plain.img, ...area(still)) < 0.0005, 'a mesh at rest draws the collar as the plain sprite does');
  assert.ok(differing(moved.img, still.img, ...area(moved)) > 0.0005, 'the keyform moves the mesh vertices, so the collar is drawn elsewhere');
});

test('masks: the eyelid mask of the sample robo clips its eyes to a band as its parameter closes, and changes nothing at rest', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const lines = [/Robo rests/, /Robo squints/];
  const masked = await roboHeads({}, lines, ROBO_VN, 'robomask.vn');
  const control = await roboHeads(noMasks(), lines, ROBO_VN, 'robomask.vn'); // the same rig without its mask
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
  const plain = await roboHeads(noMasks({ order }), [/Robo rests/, /no eyes/]);
  const clipped = await roboHeads(noMasks({ order }, { face: 'eyes' }), [/Robo rests/, /no eyes/]);
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

browserTest('animation studio: fills a 1280x720 window, every section opens by keyboard and is remembered, focus starts inside', { viewport: { width: 1280, height: 720 } }, async ({ page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Animate' }).first().click();
  const studio = page.locator('#animStudio');
  await studio.locator('.as-sect-head').first().waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.closest('#animStudio') !== null), true, 'focus starts inside the studio');
  const fits = () => studio.locator('.as-card').evaluate(c => c.scrollHeight <= c.clientHeight + 1);
  assert.equal(await fits(), true, 'the studio does not need to scroll at 1280x720');
  // Each section's header is a button: Enter opens it, Enter closes it. What opens is the section's own control.
  const controls = { sel: '.as-addkey', params: '.ap-body', poses: '.ap-pose-save', frames: '.af-fill', place: '.as-place-btn' };
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
});

browserTest('animation studio: the animation picker is one line, the Parts tree dresses the stage, and picking a part without a pivot shows no ring', { viewport: { width: 1280, height: 800 } }, async ({ page, errors }) => {
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
  await patchProject(context, proj => {
    proj.game = { ...proj.game, theme: { ...proj.game?.theme, hotFill: '#f00', hotBorder: '#00f', hotBorderWidth: 6, tipColor: '#008000' } };
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
  await patchProject(context, proj => {
    proj.scripts = [...proj.scripts, { file: 'stage.vn', text: STAGE_VN }];
    proj.game = { ...proj.game, speakerFocus: { dim: 0.4, fade: 0, front: true } };
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'edge.vn', text: HUD_REVEAL });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'edge.vn', text: HUD_NEST });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'state.vn', text: STATE_SCREEN });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'inout.vn', text: INOUT_SCREEN });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'qm.vn', text: 'screen quickmenu:\n  row anchor bottomright margin 20 gap 10:\n    button hist "History" action history\n    button auto "Auto" action auto\n' });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'title.vn', text: 'screen title:\n  column anchor center gap 12:\n    button s "New game" action start\n    button c "Continue" action continue\n    button o "Options" action options\n' });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'options.vn', text: 'screen options:\n  button audio at 100,50 "Audio" action tab\n  button game at 400,50 "Game" action tab\n  slider master at 100,200 size 500,40 readout if tab == "audio"\n  button text_sounds at 100,300 "Text sounds: [text_sounds]" action cycle if tab == "game"\n  button done at 100,900 "Back" action close\n' });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'saves.vn', text: 'screen saves:\n  each pages as pg at 100,50 step 140,0:\n    button pg at 0,0 "[pg.name]" action page\n  each slots as slot at 100,200 step 0,110:\n    button slot at 0,0 size 1100,96 "[slot.title] [slot.when] [slot.text]" action slot enabled mode == "save" or not slot.empty\n  button del at 1400,200 "Delete" action delete\n  button done at 1400,900 "Back" action close\n' });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'history.vn', text: 'screen history:\n  scroll at 100,100 size 1200,150 start bottom:\n    each lines as ln step 0,120:\n      button ln at 0,0 size 1100,100 "[ln.name]|[ln.text]"\n  button done at 1400,900 "Back" action close\n' });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'gallery.vn', text: 'screen gallery:\n  scroll at 100,150 size 800,300:\n    each tiles as t step 0,260:\n      image "[t.file]" at 0,0 size 320,180 if t.unlocked\n      button t at 340,0 size 400,80 "[t.title]" action tile enabled t.unlocked\n  text at 100,60 "[count] of [total]"\n  button done at 1400,900 "Back" action close\n' });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'viewer.vn', text: 'screen viewer:\n  image "[file]" at 0,0 size 1920,1080\n  text at 100,60 "[title] [position]/[total]"\n  button prev at 100,900 "<" action prev if total > 1\n  button next at 400,900 ">" action next if total > 1\n  button done at 1400,900 "Back" action close\n' });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'music.vn', text: 'screen music:\n  each tracks as t step 0,100:\n    button t at 100,150 size 600,80 "[t.title]" action track enabled t.unlocked\n  text at 100,60 "[now] [count] of [total]"\n  button s at 1000,900 "Stop" action stop\n  button done at 1400,900 "Back" action close\n' });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'chapters.vn', text: 'screen chapters:\n  each chapters as c step 0,100:\n    button c at 100,150 size 600,80 "[c.title]" action chapter enabled c.unlocked\n  button done at 1400,900 "Back" action close\n' });
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
  await patchProject(context, proj => {
    proj.scripts.push({ file: 'pause.vn', text: 'screen pause:\n  column anchor center gap 12:\n    button r "Resume" action resume\n    button o "Options" action options\n' });
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
  await patchProject(context, proj => {
    proj.game = { ...proj.game, stage: { width: 1080, height: 1920 } };
    proj.scripts.push({ file: 'qm.vn', text: 'screen quickmenu:\n  row anchor bottomright margin 10,40,60,0:\n    button auto "Auto" action auto\n' });
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
  await patchProject(context, proj => {
    proj.assets = [...(proj.assets ?? []), { file: 'voice/joce.wav', v: 1 }];
  });
  await context.route('**/assets/voice/joce.wav*', route => route.fulfill({ body: silentWav(), contentType: 'audio/wav' }));
});

// ---- timed menus: `menu ... timeout N:` with an `on timeout:` block ----
const withTimedStart = seconds => async context => {
  await patchProject(context, proj => {
    const menu = `label start:\n  "Ready."\n  menu "Quick!" timeout ${seconds}s:\n    "Stay":\n      "Stayed put."\n    on timeout:\n      "Time ran out."\n`;
    for (const s of proj.scripts) if (s.file === 'park.vn') s.text = s.text.replace('label start:\n', menu);
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
}, withTimedStart(60)); // the bar is held, never run out: a short clock ran out under load before the test pressed Escape

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

browserTest('voice dialog: add a take to a row, replace it after asking, flag and confirm an outdated one, match files dropped on the list', { viewport: { width: 1280, height: 800 } }, async ({ page, errors }) => {
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
  await page.goto(`${base}editor/`);
  await page.locator('.monaco-editor .view-line').first().waitFor(); // the sample's scripts are loaded
  const open = async () => {
    await palette(page, '>Voice: Recordings');
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
});

browserTest('build dialog: errors block, warnings need a tick, go-to links, build with target and folder, result', { viewport: { width: 1280, height: 800 } }, async ({ page, errors }) => {
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
  await page.goto(`${base}editor/`);
  await page.locator('.monaco-editor .view-line').first().waitFor();
  const dialog = page.locator('#build');
  const go = dialog.locator('.bd-go');
  const open = async () => {
    await palette(page, '>Build: Checks');
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
  // The missing-ids warning offers the fix itself (EP-7): it adds the ids (the sample has them all) and runs the checks again.
  await dialog.locator('[data-fix=ids]').click();
  await dialog.locator('.bd-summary').filter({ hasText: /warning/ }).waitFor();
  assert.equal(await page.locator('#status').innerText().catch(() => ''), 'every line already has an id');
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
  await page.locator('#translations .tr-filter').click(); // Escape goes to the focused element, and the editor may be taking the focus back
  await page.keyboard.press('Escape');
  await page.locator('#translations').waitFor({ state: 'hidden' });

  // Re-run checks sees a fixed project; Esc closes.
  await open();
  report = { findings: [], errors: 0, warnings: 0 };
  await dialog.locator('.bd-rerun').click();
  await dialog.locator('.bd-summary', { hasText: 'All checks passed' }).waitFor();
  assert.equal(await go.isDisabled(), false);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, [], 'the page threw errors');
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
  browserTest(name, { viewport: { width: 1400, height: 850 } }, async ({ context, page, errors }) => {
    const puts = [];
    await context.route(/\/api\/(script|locale|game|rig)(\?|$)/, route => {
      const r = route.request();
      if (r.method() !== 'PUT') return route.fallback();
      puts.push({ file: new URL(r.url()).searchParams.get('file'), body: r.postData() ?? '' });
      return route.fulfill({ json: { ok: true } });
    });
    await setup?.(context);
    await page.goto(`${base}editor/`);
    await page.locator('.monaco-editor .view-line').first().waitFor();
    await fn(page, puts);
    assert.deepEqual(errors, [], 'the page threw errors');
  });
}
// The palette closes when its input loses focus, and on a loaded page something else takes the focus now and then (the editor
// finishing a file load, a tree row after a restore): typed key by key, the rest of the query went elsewhere and Enter ran the
// wrong item or none. So the query is filled in one step, and if the palette closed meanwhile it is opened again.
const palette = async (page, query) => {
  const input = page.locator('[aria-controls="paletteList"]');
  for (let attempt = 0; ; attempt++) {
    await page.keyboard.press('Control+p');
    // The key can go nowhere (the focus is in no page element that takes it), and the palette can close under the fill: again.
    const shown = await input.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
    const filled = shown && await input.fill(query, { timeout: 3000 }).then(() => true, () => false);
    if (filled && await input.isVisible() && await input.evaluate(el => document.activeElement === el)) break;
    if (attempt >= 4) throw new Error(`the command palette keeps losing focus (query ${query})`);
  }
  if (query.startsWith('>')) await until(page, q => document.querySelector('#paletteList li[aria-selected="true"]')?.textContent.includes(q), query.slice(1));
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
  // The tab is selected before its text is in the editor: a jump made in between is undone by the load, so jump again until
  // it holds, and let the editor have the focus back before the keys.
  for (let attempt = 0; ; attempt++) {
    await palette(page, `:${n}`);
    const held = await page.waitForFunction(n => document.querySelector('.monaco-editor .active-line-number')?.textContent === String(n)
      && !!document.activeElement?.closest('.monaco-editor'), n, { timeout: 4000 }).then(() => true, () => false);
    if (held) break;
    if (attempt >= 4) await until(page, n => document.querySelector('.monaco-editor .active-line-number')?.textContent === String(n), n);
  }
  await page.keyboard.press('End');
  const inside = line.indexOf(word, line.indexOf(needle)) + 2; // two characters into the word
  for (let i = 0; i < line.length - inside; i++) await page.keyboard.press('ArrowLeft');
  return n;
}
/** `cursorIn`, then `act` (a key that works on the word under the cursor); until `ready` shows. On a loaded page the editor
 *  can reload the file after the cursor is placed and the key finds no word, so the placing is done again. */
async function actAtCursor(page, args, act, ready) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const n = await cursorIn(page, ...args);
    await act();
    if (await ready.waitFor({ timeout: 6000 }).then(() => true, () => false)) return n;
    await page.keyboard.press('Escape');
  }
  await ready.waitFor();
}
const demoLocales = { 'locale/fi.json': `${JSON.stringify({ vbsv: 'Hauska tavata, [player].', bu9l: 'Nähdään, [player]. (Käyntejä: [demo_visits])' }, null, 2)}\n` };

// UX round EA-1: Monaco pairs a quote only on a line that is cheap to tokenize, which the new line after Enter is not until the
// next render. Typed straight after Enter, the opening quote then stood alone and the closing one, after punctuation, paired.
inEditor('typing: a narration line typed straight after Enter keeps one pair of quotes, with or without closing punctuation', async page => {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  for (const text of ['"The rain falls."', '"Wait!"', '"Hello"', 'hero: Hi {i}']) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(text, { delay: 0 });
    const line = await page.evaluate(() => { const ed = monaco.editor.getEditors()[0]; return ed.getModel().getLineContent(ed.getPosition().lineNumber); });
    assert.equal(line.trim(), text);
    await page.keyboard.press('Escape'); // a suggestion list would take the next Enter
    await page.keyboard.press('End');
  }
});

// UX round EA-3: a typed `{` is closed by the editor, and a text tag from the list brings its own `}`: it takes the waiting one.
inEditor('typing: a text tag taken from the list after { leaves no extra }', async page => {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  const last = () => page.evaluate(() => { const m = monaco.editor.getEditors()[0].getModel(); return m.getLineContent(m.getLineCount()); });
  for (const [typed, key, expected] of [['hero: Hi {', 'Enter', 'hero: Hi {i}{/i}'], ['hero: Hi {col', 'Tab', 'hero: Hi {color=#ff6fa5}{/color}']]) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(typed, { delay: 0 });
    await page.locator('.suggest-widget.visible').waitFor();
    await page.keyboard.press(key);
    assert.equal((await last()).trim(), expected);
    await page.keyboard.press('Escape');
    await page.keyboard.press('End'); // not in the middle of the tag pair: Enter would split the line
  }
});

// UX round EA-2: Shift+F8 is F8 the other way round (it went by errors before warnings, and F8 by position), and the message of
// the problem it lands on shows under it.
inEditor('keys: Shift+F8 goes to the previous problem as F8 goes to the next, and shows its message', async page => {
  await page.locator('.monaco-editor .view-lines').click();
  await page.evaluate(() => monaco.editor.getEditors()[0].getModel().setValue('label start:\n  jump nowhere_a\n  jump nowhere_b\n  jump nowhere_c\n'));
  await until(page, () => monaco.editor.getModelMarkers({ resource: monaco.editor.getEditors()[0].getModel().uri }).length >= 3);
  const line = () => page.evaluate(() => monaco.editor.getEditors()[0].getPosition().lineNumber);
  await page.evaluate(() => monaco.editor.getEditors()[0].setPosition({ lineNumber: 4, column: 1 }));
  await page.keyboard.press('Shift+F8');
  assert.equal(await line(), 3);
  await page.keyboard.press('Shift+F8');
  assert.equal(await line(), 2);
  await page.keyboard.press('F8');
  assert.equal(await line(), 3);
  await page.keyboard.press('F8');
  assert.equal(await line(), 4);
  await until(page, () => /Unknown label "nowhere_c"/.test(document.querySelector('.monaco-hover:not(.hidden)')?.textContent ?? ''));
});

// UX round EA-10: Ctrl+S was bound inside the script editor only, so from the Files filter or the preview the browser's "Save page as"
// opened. Autosave writes 400 ms after the last key: a write sooner than that is the key's.
inEditor('keys: Ctrl+S saves the open file from the Files filter, and the browser does not get the key', async (page, puts) => {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('# a note', { delay: 0 });
  await page.locator('#sbFilter').focus();
  // The editor's handler stops the event at the window's capture phase; a listener added there later still runs after it.
  await page.evaluate(() => { window.ctrlS = new Promise(r => window.addEventListener('keydown', e => { if (e.key === 's') r(e.defaultPrevented); }, true)); });
  await page.keyboard.press('Control+s');
  assert.equal(await page.evaluate(() => window.ctrlS), true);
  await page.waitForTimeout(250);
  assert.equal(puts.length, 1, 'written by the key, before the autosave');
  assert.match(puts[0].body, /# a note/);
});

// UX round EL-3 and EL-18: the project route serves a `disk` the test edits, and the event stream tells the page to look every 100 ms.
const externalDisk = { scripts: null };
inEditor('external changes: a script deleted outside closes its tab, an outside edit is not left on the undo stack', async (page, puts) => {
  const tabs = () => page.evaluate(() => [...document.querySelectorAll('#tabs .tab [role=tab]')].map(t => t.textContent));
  const shown = () => page.evaluate(() => monaco.editor.getEditors()[0].getModel().getValue());
  assert.ok((await tabs()).includes('town.vn'), 'every script has a tab');

  // Deleted (or renamed: the new name is another script) on disk: the tab goes, with a notice.
  externalDisk.scripts = externalDisk.scripts.filter(s => s.file !== 'town.vn');
  await until(page, () => ![...document.querySelectorAll('#tabs .tab [role=tab]')].some(t => t.textContent === 'town.vn'));
  assert.match(await page.locator('#toast').innerText(), /town\.vn no longer exists on disk/);
  assert.ok((await tabs()).includes('park.vn'), 'the other tabs stay');

  // An edit made outside shows at once, and Ctrl+Z does not bring the old text back (nor write it to disk).
  const name = (await page.locator('#tabs .tab[data-selected="true"] [role=tab]').innerText()).replace(/ •$/, '');
  externalDisk.scripts = externalDisk.scripts.map(s => (s.file === name ? { ...s, text: `${s.text}\n# edited outside\n` } : s));
  await until(page, () => monaco.editor.getEditors()[0].getModel().getValue().includes('# edited outside'));
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(800); // an undo would be saved after 400 ms
  assert.match(await shown(), /# edited outside/);
  assert.deepEqual(puts, [], 'nothing was written back');
}, async context => {
  externalDisk.scripts = null;
  await context.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    externalDisk.scripts ??= proj.scripts;
    await route.fulfill({ response: res, json: { ...proj, scripts: externalDisk.scripts } });
  });
  await context.route('**/__events', route => route.fulfill({ contentType: 'text/event-stream', body: 'retry: 100\ndata: {"type":"content"}\n\n' }));
});

// UX round EL-4: a save the server refuses says so (red, naming the file), is tried again by itself, and says when it went through.
const saveRoute = { fail: true, attempts: 0 };
inEditor('failed save: the editor says which file, retries by itself and reports the save that finally works', async (page, puts) => {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('# a note');
  const toast = page.locator('#toast');
  await toast.filter({ hasText: /Could not save .*vn: the dev server answered 500/ }).waitFor();
  assert.equal(await toast.getAttribute('data-kind'), 'error');
  assert.match(await page.locator('#status').innerText(), /^save failed: .*\.vn$/);
  await until(page, () => document.querySelector('#tabs .tab[data-selected="true"] [role=tab]').textContent.endsWith('•'));
  await poll(page, () => saveRoute.attempts >= 3, 80); // 1 s, then 2 s
  assert.ok(saveRoute.attempts >= 3, `the save is tried again (${saveRoute.attempts} attempts)`);
  assert.deepEqual(puts, []);
  saveRoute.fail = false;
  await toast.filter({ hasText: /saved .*\.vn \(the earlier save had failed\)/ }).waitFor({ timeout: 10_000 });
  assert.equal(puts.length, 1);
  assert.match(puts[0].body, /# a note/);
  assert.equal(await toast.getAttribute('data-kind'), null);
}, async context => {
  saveRoute.fail = true;
  saveRoute.attempts = 0;
  await context.route(/\/api\/script(\?|$)/, route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    saveRoute.attempts++;
    return saveRoute.fail ? route.fulfill({ status: 500, body: 'boom' }) : route.fallback();
  });
});

// UX round EP-3: `>trash` Enter Enter emptied the trash for good (Empty Trash ranked first, its question started on the red button).
inEditor('trash: ">trash" Enter opens Restore, and the Empty Trash question starts on Cancel', async page => {
  const empties = [];
  await page.route('**/api/trash/empty', r => { empties.push(r.request().url()); return r.fulfill({ json: { removed: 3 } }); });
  await page.route('**/api/trash', r => r.fulfill({ json: [] }));
  await palette(page, '>Trash'); // as typed in lower case it ranks the same: the helper's wait compares the case
  await until(page, () => document.querySelector('[aria-controls="paletteList"]').value.startsWith('#trash:'));
  assert.equal(await page.locator('dialog.ask').count(), 0, 'the first hit is Restore, not Empty Trash');
  await page.keyboard.press('Escape');
  await palette(page, '>Empty Trash');
  await page.locator('dialog.ask').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel');
  await page.keyboard.press('Enter');
  await page.locator('dialog.ask').waitFor({ state: 'detached' });
  assert.deepEqual(empties, [], 'Enter declined');
  await palette(page, '>Empty Trash');
  await page.locator('dialog.ask').getByRole('button', { name: 'Empty Trash' }).click();
  await until(page, () => /emptied the trash/.test(document.getElementById('status').textContent));
  assert.equal(empties.length, 1);
});

// A dead dev server shows only as an event stream that keeps failing; the editor says so, and says when it is back.
const serverRoute = { down: false };
inEditor('dev server lost: a stream that keeps failing is reported, and so is its return', async page => {
  const toast = page.locator('#toast');
  serverRoute.down = true;
  await toast.filter({ hasText: /The dev server stopped answering/ }).waitFor({ timeout: 10_000 });
  assert.equal(await toast.getAttribute('data-kind'), 'error');
  serverRoute.down = false;
  await toast.filter({ hasText: /the dev server is back/ }).waitFor({ timeout: 10_000 });
}, async context => {
  serverRoute.down = false;
  // A stream that ends and reopens is not "lost": only failures with no open between them are.
  await context.route('**/__events', route => (serverRoute.down ? route.abort() : route.fulfill({ contentType: 'text/event-stream', body: 'retry: 100\n\n' })));
});

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
  await poll(page, () => puts.some(p => p.file === 'fi.json'));
  assert.equal(JSON.parse(puts.find(p => p.file === 'fi.json').body).kx0c, 'Istu. Meidän pitää puhua.');

  await dialog.locator('.tr-filter').fill('');
  await dialog.locator('.tr-changed').check();
  await until(page, () => document.querySelectorAll('#translations .tr-row[data-outdated="true"]').length === 1);
  assert.match(await dialog.locator('.tr-was').innerText(), /Was: An older wording\./);
  await dialog.locator('.tr-ok').click();
  await until(page, () => !/changed source/.test(document.querySelector('#translations .tr-summary').textContent));
  // The edit above saved fi.src too (with the old j30k); Still correct saves it again with the current source.
  const j30k = () => JSON.parse(puts.filter(p => p.file === 'fi.src').at(-1)?.body ?? '{}').j30k;
  await poll(page, () => /^Fine/.test(j30k() ?? ''));
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
  await dialog.locator('.tr-filter').click(); // the jump to the line may still be moving focus to the editor, and Escape goes to the focused element
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
  const box = page.locator('.rename-box input, .rename-input').first();
  const n = await actAtCursor(page, ['demo.vn', 'Nice to meet you, [player]', 'player'], () => page.keyboard.press('F2'), box);
  assert.equal(await box.inputValue(), 'player');
  await box.fill('hero');
  await box.press('Enter');
  await shownLine(page, 'Nice to meet you, [hero]');
  await poll(page, () => puts.some(p => p.file === 'fi.json'));
  const fi = puts.filter(p => p.file === 'fi.json');
  assert.equal(fi.length, 1, 'the table is written once');
  assert.deepEqual(JSON.parse(fi[0].body), { vbsv: 'Hauska tavata, [hero].', bu9l: 'Nähdään, [hero]. (Käyntejä: [demo_visits])' });
  assert.equal(await activeLine(page), String(n));
}, async context => {
  await context.route('**/api/locales', route => route.fulfill({ json: demoLocales }));
});

inEditor('variable rename: a cancelled F2 leaves the translation tables alone', async (page, puts) => {
  const box = page.locator('.rename-box input, .rename-input').first();
  await actAtCursor(page, ['demo.vn', 'Nice to meet you, [player]', 'player'], () => page.keyboard.press('F2'), box);
  await box.fill('hero');
  await box.press('Escape');
  await page.waitForTimeout(1500);
  assert.deepEqual(puts.filter(p => p.file === 'fi.json'), []);
}, async context => {
  await context.route('**/api/locales', route => route.fulfill({ json: demoLocales }));
});

inEditor('find all uses: Shift+F12 on a variable lists every use in a peek view', async page => {
  const peek = page.locator('.peekview-widget');
  await actAtCursor(page, ['demo.vn', 'Nice to meet you, [player]', 'player'], () => page.keyboard.press('Shift+F12'), peek);
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
  await poll(page, () => uploads.length >= 3);
  assert.deepEqual(uploads[2], { name: 'loose.png', folder: '' }, 'off a folder, the server routes by type');
});

inEditor('screens sidebar: a built-in screen row opens it in the preview and shows its starter code read-only', async page => {
  const frame = page.frameLocator('#preview');
  await frame.locator('#title:not([hidden]), #box[data-visible="true"]').first().waitFor();
  const screenRow = title => page.locator('#sbList .row', { has: page.locator('.item span:first-child', { hasText: new RegExp(`^${title}$`) }) }).locator('.item');
  await page.locator('#sbList h3 .fold', { hasText: 'Built-in screens' }).click(); // folded until asked for (UX round EP-5)
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

inEditor('Phone preview: the preview pane takes a phone size and the game inside acts as on a touch screen, and Desktop undoes it', async page => {
  const frame = page.frameLocator('#preview');
  await frame.locator('#title:not([hidden]), #box[data-visible="true"]').first().waitFor();
  const pane = () => page.locator('#preview').evaluate(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
  const touch = () => frame.locator('html').evaluate(el => el.hasAttribute('data-touch'));
  assert.equal(await touch(), false);
  const before = await pane();
  await palette(page, '>Preview: Phone, landscape');
  await until(page, () => document.getElementById('status').textContent.startsWith('preview: Phone'));
  const phone = await pane();
  assert.ok(phone.w <= 844.5 && phone.h <= 390.5 && phone.h < before.h, `the pane is phone-sized (${phone.w} x ${phone.h}, was ${before.w} x ${before.h})`);
  await until(page, () => document.getElementById('preview').contentDocument.documentElement.hasAttribute('data-touch'));
  await palette(page, '>Preview: Desktop');
  await until(page, () => !document.getElementById('preview').contentDocument.documentElement.hasAttribute('data-touch'));
  const after = await pane();
  assert.ok(Math.abs(after.w - before.w) < 1 && Math.abs(after.h - before.h) < 1, 'the pane is back to filling its column');
});

browserTest('animation studio: the Mesh row generates a free mesh at a chosen detail, the Warp tool draws it, regenerating one with keyforms asks first', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await page.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    // The collar already has a four-vertex mesh with a keyform of its own.
    const collar = { id: 'collar_mesh', part: 'collar', mesh: { verts: [0, 0, 10, 0, 10, 10, 0, 10], tris: [0, 1, 2, 0, 2, 3], detail: 'low' }, keyforms: [{ param: 'breathe', keys: [{ at: 0 }, { at: 1, pts: { 2: [0.01, 0] } }] }] };
    proj.rigs.robo.rig.deformers.push(collar);
    const text = JSON.parse(proj.rigTexts.robo);
    text.deformers.push(collar);
    proj.rigTexts.robo = JSON.stringify(text);
    await route.fulfill({ response: res, json: proj });
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click();
  const studio = page.locator('#animStudio'), row = n => studio.locator(`.as-tree .as-row[data-part="${n}"]`), dialog = page.locator('dialog.ask');
  const sum = studio.locator('.as-sub[data-sub="deform"] .as-sub-sum'), count = studio.locator('.aw-vcount'), gen = studio.locator('.aw-genbtn');
  const dots = () => page.frames().find(f => f.url().includes('studio=')).evaluate(() => document.querySelectorAll('svg circle[r="3"]').length);
  const verts = async () => Number(/^(\d+) vertices/.exec(await count.textContent())?.[1]);
  const ready = async () => { await until(page, () => /^\d+ vertices/.test(document.querySelector('#animStudio .aw-vcount')?.textContent ?? '')); return verts(); };
  await row('legs').waitFor();
  await row('legs').click();
  await studio.locator('[data-gz="warp"]').click();
  // A part with no warp: the vertex count follows the detail choice, and Generate makes the mesh deformer.
  assert.equal(await gen.textContent(), 'Generate mesh');
  await studio.locator('.aw-detail').selectOption('low');
  const low = await ready();
  await studio.locator('.aw-detail').selectOption('veryhigh');
  await until(page, n => Number(/^(\d+) vertices/.exec(document.querySelector('#animStudio .aw-vcount').textContent)?.[1]) > n, low);
  const high = await verts();
  assert.ok(low >= 4 && high > low && high <= 500, `the count rises with the detail: ${low} -> ${high}`);
  await studio.locator('.aw-detail').selectOption('low');
  await until(page, n => Number(/^(\d+) vertices/.exec(document.querySelector('#animStudio .aw-vcount').textContent)?.[1]) === n, low);
  await gen.click();
  await until(page, () => /^Mesh \d+ vertices$/.test(document.querySelector('#animStudio .as-sub[data-sub="deform"] .as-sub-sum').textContent));
  assert.equal(await sum.textContent(), `Mesh ${low} vertices`);
  assert.equal(await gen.textContent(), 'Regenerate mesh');
  assert.equal(await dialog.count(), 0, 'a new mesh asks nothing');
  // The stage draws a dot at every vertex (inert), and the lattice-only controls are gone.
  await poll(page, async () => (await dots()) === low);
  assert.equal(await dots(), low, 'a dot at each vertex');
  assert.match(await studio.locator('.aw-meshsum').textContent(), new RegExp(`^${low} vertices, \\d+ triangles, detail low`));
  for (const cls of ['.aw-dims', '.aw-rowpick', '.aw-colpick']) assert.equal(await studio.locator(cls).isVisible(), false, `${cls} is lattice-only`);
  for (const cls of ['.aw-sel', '.aw-tools', '.aw-xfbtn', '.aw-presetbtn']) assert.equal(await studio.locator(cls).isVisible(), true, `${cls} works on a mesh`);
  assert.equal(await studio.locator('.aw-remove').isVisible(), true, 'Remove warp stays');
  assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), false, 'the rig is dirty');
  // Regenerating a mesh with no keyforms needs no confirmation and is one undo step.
  await studio.locator('.aw-detail').selectOption('veryhigh');
  await until(page, n => Number(/^(\d+) vertices/.exec(document.querySelector('#animStudio .aw-vcount').textContent)?.[1]) > n, low);
  await gen.click();
  await until(page, n => document.querySelector('#animStudio .as-sub[data-sub="deform"] .as-sub-sum').textContent === `Mesh ${n} vertices`, high);
  assert.equal(await dialog.count(), 0);
  await studio.locator('[data-t="undo"]').click();
  await until(page, n => document.querySelector('#animStudio .as-sub[data-sub="deform"] .as-sub-sum').textContent === `Mesh ${n} vertices`, low);
  await studio.locator('[data-t="redo"]').click();
  await until(page, n => document.querySelector('#animStudio .as-sub[data-sub="deform"] .as-sub-sum').textContent === `Mesh ${n} vertices`, high);
  // Apply writes the mesh into rig.json.
  await studio.locator('[data-t="apply"]').click();
  await until(page, () => true);
  await poll(page, () => saved.length, 50);
  const rig = JSON.parse(saved.at(-1)), legs = rig.deformers.find(d => d.part === 'legs');
  assert.equal(legs.mesh.verts.length, high * 2);
  assert.equal(legs.mesh.detail, 'veryhigh');
  assert.deepEqual(legs.keyforms, []);
  assert.equal(legs.grid, undefined);
  // A part whose mesh has keyforms: Regenerate asks, Cancel keeps it, the confirmation drops the keyforms in one undo step.
  await row('collar').click();
  assert.equal(await sum.textContent(), 'Mesh 4 vertices');
  assert.equal(await gen.textContent(), 'Regenerate mesh');
  await ready();
  await gen.click();
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /per-vertex keyforms are dropped/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await sum.textContent(), 'Mesh 4 vertices', 'cancelled: nothing changed');
  await gen.click();
  await dialog.getByRole('button', { name: 'Regenerate' }).click();
  await until(page, () => document.querySelector('#animStudio .as-sub[data-sub="deform"] .as-sub-sum').textContent !== 'Mesh 4 vertices');
  await studio.locator('[data-t="undo"]').click();
  await until(page, () => document.querySelector('#animStudio .as-sub[data-sub="deform"] .as-sub-sum').textContent === 'Mesh 4 vertices');
  // A part with a lattice: the mesh replaces it, after asking.
  await row('torso').click();
  assert.equal(await sum.textContent(), 'Lattice 2×3');
  assert.equal(await gen.textContent(), 'Replace lattice with mesh');
  await ready();
  await gen.click();
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /replaces it/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await sum.textContent(), 'Lattice 2×3');
  assert.equal(await studio.locator('.aw-dims').isVisible(), true, 'a lattice keeps its grid-size controls');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: a mesh vertex is dragged into the active parameter keyform, selected, softened over edges, scaled, and given a preset', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click();
  const studio = page.locator('#animStudio'), undo = studio.locator('[data-t="undo"]');
  await studio.locator('.as-tree .as-row[data-part="legs"]').waitFor();
  await studio.locator('.as-tree .as-row[data-part="legs"]').click();
  await studio.locator('[data-gz="warp"]').click();
  await studio.locator('.aw-detail').selectOption('low');
  await until(page, () => /^\d+ vertices/.test(document.querySelector('#animStudio .aw-vcount')?.textContent ?? ''));
  await studio.locator('.aw-genbtn').click();
  await until(page, () => /^Mesh \d+ vertices$/.test(document.querySelector('#animStudio .as-sub[data-sub="deform"] .as-sub-sum').textContent));
  const n = Number(/^Mesh (\d+) vertices$/.exec(await studio.locator('.as-sub[data-sub="deform"] .as-sub-sum').textContent())[1]);
  await studio.locator('.ap-row[data-ctl="breathe"] > label').click();
  // A fresh mesh is not bound to breathe, so the parameter alone is in focus: Bind parts… (the Warp tool binds warps) and a click on the part pair them.
  await bindParts(studio, 'legs');
  const breathe = studio.locator('.ap-row[data-ctl="breathe"] .ap-num');
  await breathe.fill('1');
  await breathe.press('Enter');
  const stage = () => page.frames().find(f => f.url().includes('studio='));
  const dots = () => stage().evaluate(() => [...document.querySelectorAll('svg circle[stroke="#000"], svg circle[stroke="#ff3b6b"]')].map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy')), c.getAttribute('fill') === '#ff3b6b' ? 1 : 0]));
  const settle = async () => { await page.waitForTimeout(300); return dots(); };
  const chosen = async () => (await settle()).flatMap((d, i) => (d[2] ? [i] : []));
  await poll(page, async () => (await dots()).length === n);
  const box = await studio.locator('.as-stage iframe').boundingBox(), before = await settle();
  assert.equal(before.length, n, 'a handle per vertex');
  const orig = before.map(d => [...d]);
  // The vertex farthest from the others is easy to hit: press it, move, release.
  const gap = i => Math.min(...before.map((d, j) => (j === i ? Infinity : Math.hypot(d[0] - before[i][0], d[1] - before[i][1]))));
  const v = before.map((_, i) => i).sort((a, b) => gap(b) - gap(a))[0];
  const at = i => [box.x + before[i][0], box.y + before[i][1]];
  const dragTo = async (i, dx, dy) => { const [x, y] = at(i); await page.mouse.move(x, y); await page.mouse.down(); for (let k = 1; k <= 5; k++) await page.mouse.move(x + (dx * k) / 5, y + (dy * k) / 5); await page.mouse.up(); };
  await dragTo(v, 30, 10);
  let moved = await settle();
  assert.ok(Math.abs(moved[v][0] - before[v][0] - 30) < 1 && Math.abs(moved[v][1] - before[v][1] - 10) < 1, `the vertex followed the pointer (${moved[v]} from ${before[v]})`);
  moved.forEach((d, i) => { if (i !== v) assert.ok(Math.hypot(d[0] - before[i][0], d[1] - before[i][1]) < 1, `vertex ${i} stayed`); });
  assert.match(await studio.locator('.aw-pthint').textContent(), new RegExp(`^Vertex vertex ${v}`));
  // Keyforms serves the mesh as a lattice: the key strip, the Point row (vertices), copy; a mesh does not paste mirrored.
  assert.match(await studio.locator('.ab .ab-formtext').textContent(), /^the warp of legs at 1 \(a key\)/);
  assert.deepEqual(await studio.locator('.ab .ab-keybtns button').allTextContents(), ['0', '1']);
  assert.equal(await studio.locator('.ab .ab-points .aw-pt').isVisible(), true);
  await studio.locator('.ab .ab-copyform').click();
  assert.equal(await studio.locator('.ab .ab-pasteform').isDisabled(), false);
  assert.equal(await studio.locator('.ab .ab-pastemirror').isDisabled(), true);
  assert.match(await studio.locator('.ab .ab-pastemirror').getAttribute('title'), /^A mesh's vertices have no fixed partners/);
  await undo.click();
  const back = await settle();
  assert.ok(Math.hypot(back[v][0] - before[v][0], back[v][1] - before[v][1]) < 1, 'one undo took the drag back');
  // The drag is written into the keyform of breathe at 1: sparse points indexed by vertex.
  await dragTo(v, 30, 10);
  await settle();
  await studio.locator('[data-t="apply"]').click();
  await poll(page, () => saved.length, 50);
  const legs = JSON.parse(saved.at(-1)).deformers.find(d => d.part === 'legs');
  const keys = legs.keyforms.find(k => k.param === 'breathe').keys;
  assert.deepEqual(keys.map(k => k.at), [0, 1]);
  assert.deepEqual(Object.keys(keys[1].pts), [String(v)]);
  assert.ok(keys[1].pts[v][0] > 0 && keys[1].pts[v][1] > 0, 'moved right and down');
  // Selection: All, Invert, a vertex from the list; a rectangle round one vertex.
  await studio.locator('.aw-all').click();
  assert.equal((await chosen()).length, n);
  assert.equal(await studio.locator('.aw-selhint').textContent(), `${n} chosen`);
  await studio.locator('.aw-invert').click();
  assert.deepEqual(await chosen(), []);
  await studio.locator('.aw-pick').selectOption(String(v));
  assert.deepEqual(await chosen(), [v]);
  await studio.locator('.aw-invert').click();
  assert.equal((await chosen()).length, n - 1);
  await studio.locator('.aw-clear').click();
  // Soft reach fades over edge hops: the chosen vertex goes the whole way, a neighbour part of it, one far along the edges not at all.
  await studio.locator('.aw-pick').selectOption(String(v));
  await studio.locator('.aw-soft').click();
  assert.equal(await studio.locator('.aw-soft').getAttribute('aria-pressed'), 'true');
  await studio.locator('.aw-softopts').click(); // its reach is under ▾
  await studio.locator('.aw-radius').fill('2');
  await studio.locator('.aw-radius').dispatchEvent('change');
  const rest0 = await settle();
  before.splice(0, before.length, ...rest0); // the vertex sits where the first drag left it: aim from there
  await dragTo(v, 30, 0);
  const soft = await settle(), shift = i => soft[i][0] - rest0[i][0];
  assert.ok(Math.abs(shift(v) - 30) < 1, 'the chosen vertex went the whole way');
  const others = rest0.map((_, i) => i).filter(i => i !== v);
  assert.ok(others.some(i => shift(i) > 3 && shift(i) < 27), 'a neighbour followed part of the way');
  assert.ok(others.some(i => Math.abs(shift(i)) < 1), 'a vertex out of reach stayed');
  await undo.click();
  await studio.locator('.aw-soft').click();
  // Scale acts on the chosen vertices about the selection; Reset takes them back to rest in this keyform.
  await studio.locator('.aw-all').click();
  const wide = a => Math.max(...a.map(d => d[0])) - Math.min(...a.map(d => d[0]));
  const was = wide(await settle());
  await studio.locator('.aw-xfbtn').click(); // the factor is under ▾; the Scale icon applies it
  await studio.locator('.aw-scale').fill('1.5');
  await studio.locator('.aw-scale-go').click();
  assert.ok(wide(await settle()) > was * 1.4, 'scaling widened the mesh');
  await studio.locator('.ab .ab-reset').click(); // Keyforms' Reset: the chosen vertices
  const rested = await settle();
  assert.ok(rested.every((d, i) => Math.hypot(d[0] - orig[i][0], d[1] - orig[i][1]) < 1.5), 'Reset took every chosen vertex back to rest');
  // Mirror says what it could not match; a preset writes the keys per vertex.
  await studio.locator('.aw-clear').click();
  await studio.locator('.aw-presetbtn').click(); // Presets ▾ in the tool options bar
  await studio.locator('.aw-preset').selectOption('sway');
  await studio.locator('.aw-write').click();
  assert.match(await page.locator('.as-note').textContent(), /Sway written as the keys of breathe/);
  const swayed = await settle();
  assert.ok(swayed.some((d, i) => Math.abs(d[0] - before[i][0]) > 3), 'the preset bent the mesh at breathe 1');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: Topology mode adds, moves and deletes mesh vertices; a mesh with keyforms asks first and undo brings them back', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  await page.route('**/api/rig*', route => (route.request().method() !== 'PUT' ? route.continue() : route.fulfill({ status: 200, body: 'ok' })));
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click();
  const studio = page.locator('#animStudio'), undo = studio.locator('[data-t="undo"]'), dialog = page.locator('dialog.ask'), note = page.locator('.as-note');
  await studio.locator('.as-tree .as-row[data-part="legs"]').waitFor();
  await studio.locator('.as-tree .as-row[data-part="legs"]').click();
  await studio.locator('[data-gz="warp"]').click();
  await studio.locator('.aw-detail').selectOption('low');
  await until(page, () => /^\d+ vertices/.test(document.querySelector('#animStudio .aw-vcount')?.textContent ?? ''));
  await studio.locator('.aw-genbtn').click();
  await until(page, () => /^Mesh \d+ vertices$/.test(document.querySelector('#animStudio .as-sub[data-sub="deform"] .as-sub-sum').textContent));
  const n0 = Number(/^Mesh (\d+) vertices$/.exec(await studio.locator('.as-sub[data-sub="deform"] .as-sub-sum').textContent())[1]);
  const breathe = studio.locator('.ap-row[data-ctl="breathe"] .ap-num');
  const stage = () => page.frames().find(f => f.url().includes('studio='));
  const dots = () => stage().evaluate(() => [...document.querySelectorAll('svg circle[stroke="#000"], svg circle[stroke="#ff3b6b"]')].filter(c => c.getAttribute('stroke-dasharray') === null).map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]));
  const settle = async n => { for (let i = 0; i < 40 && (await dots()).length !== n; i++) await page.waitForTimeout(100); await page.waitForTimeout(250); return dots(); };
  let pts = await settle(n0);
  assert.equal(pts.length, n0);
  const box = await studio.locator('.as-stage iframe').boundingBox();
  // The vertex farthest from the rest (easy to hit) and the middle of its nearest neighbour's edge.
  const gap = (a, i) => Math.min(...a.map((d, j) => (j === i ? Infinity : Math.hypot(d[0] - a[i][0], d[1] - a[i][1]))));
  const loneliest = (a, skip = []) => a.map((_, i) => i).filter(i => !skip.includes(i)).sort((x, y) => gap(a, y) - gap(a, x))[0];
  const midway = (a, i) => { const j = a.map((_, k) => k).filter(k => k !== i).sort((x, y) => Math.hypot(a[x][0] - a[i][0], a[x][1] - a[i][1]) - Math.hypot(a[y][0] - a[i][0], a[y][1] - a[i][1]))[0]; return [box.x + (a[i][0] + a[j][0]) / 2, box.y + (a[i][1] + a[j][1]) / 2]; };
  const v = loneliest(pts), rest = pts.map(d => [...d]);
  // Topology mode: no keyforms yet, so an Add asks nothing; the keyform controls give way to the tools.
  await studio.locator('.aw-topoon').click();
  await page.waitForTimeout(300);
  assert.equal(await studio.locator('.aw-topoon').getAttribute('aria-pressed'), 'true');
  assert.equal(await studio.locator('.aw-tt').count(), 6);
  assert.deepEqual(await studio.locator('.aw-tt').evaluateAll(els => els.map(e => [e.getAttribute('aria-label'), e.textContent.trim(), !!e.querySelector('svg.si')])),
    ['Add vertex', 'Delete vertex', 'Move vertex', 'Flip edge', 'Add edge', 'Remove edge'].map(n => [n, '', true]), 'the topology tools are icon buttons with names');
  // They are on screen: each button inside the bar, its icon drawn at full size with strokes that show.
  const seen = await studio.locator('.aw-tt').evaluateAll(els => els.map(e => {
    const b = e.getBoundingClientRect(), bar = e.closest('.as-toolbar').getBoundingClientRect(), s = e.querySelector('svg.si'), sb = s.getBoundingClientRect(), cs = getComputedStyle(s);
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { name: e.getAttribute('aria-label'), w: Math.round(b.width), icon: Math.round(sb.width), inBar: b.left >= bar.left && b.right <= bar.right && b.top >= bar.top && b.bottom <= bar.bottom,
      stroke: cs.stroke !== 'none' && cs.stroke !== 'rgba(0, 0, 0, 0)' && Number(cs.strokeWidth.replace('px', '')) > 0, shown: cs.visibility === 'visible' && Number(cs.opacity) > 0, onTop: e.contains(top) };
  }));
  for (const s of seen) assert.ok(s.w >= 28 && s.icon >= 16 && s.inBar && s.stroke && s.shown && s.onTop, `${s.name} is visible: ${JSON.stringify(s)}`);    assert.equal(await studio.locator('.aw-sel').isVisible(), false, 'the keyform controls are away');
  assert.equal(await studio.locator('.aw-tt[data-tool="add"]').getAttribute('aria-pressed'), 'true');
  await page.mouse.move(...midway(pts, v));
  await page.mouse.click(...midway(pts, v));
  pts = await settle(n0 + 1);
  assert.equal(pts.length, n0 + 1, 'a vertex was added');
  assert.equal(await dialog.count(), 0, 'no keyforms: nothing to ask');
  assert.equal(await studio.locator('.as-sub[data-sub="deform"] .as-sub-sum').textContent(), `Mesh ${n0 + 1} vertices`);
  // A refused edit says why and changes nothing: Move a vertex far across the mesh.
  await studio.locator('.aw-tt[data-tool="move"]').click();
  await page.waitForTimeout(300); // the stage gets the tool a moment later
  const [mx, my] = [box.x + pts[v][0], box.y + pts[v][1]];
  await page.mouse.move(mx, my);
  await page.mouse.down();
  for (let k = 1; k <= 5; k++) await page.mouse.move(mx + k * 80, my + k * 60);
  await page.mouse.up();
  assert.match(await note.textContent(), /flat|flipped|overlap/);
  const same = await settle(n0 + 1);
  assert.ok(same.every((d, i) => Math.hypot(d[0] - pts[i][0], d[1] - pts[i][1]) < 1), 'the refused drag left every vertex where it was');
  // Moving a vertex a little works and is one undo step.
  await page.mouse.move(mx, my);
  await page.mouse.down();
  for (let k = 1; k <= 5; k++) await page.mouse.move(mx + k * 2, my + k);
  await page.mouse.up();
  const slid = await settle(n0 + 1);
  assert.ok(Math.abs(slid[v][0] - pts[v][0] - 10) < 1.5 && Math.abs(slid[v][1] - pts[v][1] - 5) < 1.5, `the vertex slid (${slid[v]} from ${pts[v]})`);
  await undo.click();
  assert.ok(Math.hypot((await settle(n0 + 1))[v][0] - pts[v][0], 0) < 1.5, 'one undo took the move back');
  // Esc leaves the mode; keyform editing is back and a drag writes a keyform.
  await stage().evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))); // the stage has the keys while the pointer works on it
  await page.waitForTimeout(300);
  assert.equal(await studio.locator('.aw-topoon').getAttribute('aria-pressed'), 'false');
  assert.equal(await studio.locator('.aw-sel').isVisible(), true);
  // A fresh mesh is not bound to breathe, so the parameter alone is in focus: Bind parts… (the Warp tool binds warps) and a click on the part pair them.
  await studio.locator('.ap-row[data-ctl="breathe"] > label').click();
  await bindParts(studio, 'legs');
  await breathe.fill('1');
  await breathe.press('Enter');
  const before = await settle(n0 + 1);
  await page.mouse.move(box.x + before[v][0], box.y + before[v][1]);
  await page.mouse.down();
  for (let k = 1; k <= 5; k++) await page.mouse.move(box.x + before[v][0] + k * 6, box.y + before[v][1] + k * 2);
  await page.mouse.up();
  const bent = await settle(n0 + 1);
  assert.ok(bent[v][0] - before[v][0] > 25, 'the vertex was dragged into the keyform');
  // Now there are keyforms: an Add asks, Cancel changes nothing, the confirmation drops them in one undo step.
  await studio.locator('.aw-topoon').click();
  await studio.locator('.aw-tt[data-tool="add"]').click();
  await page.waitForTimeout(300); // the stage gets the tool a moment later
  const u = loneliest(bent, [v]);
  await page.mouse.move(...midway(bent, u));
  await page.mouse.click(...midway(bent, u));
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /per-vertex keyforms of .* are dropped. Undo brings them back/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.equal((await settle(n0 + 1)).length, n0 + 1, 'cancelled: nothing changed');
  await page.mouse.click(...midway(bent, u));
  await dialog.getByRole('button', { name: 'Edit mesh' }).click();
  const after = await settle(n0 + 2);
  assert.equal(after.length, n0 + 2);
  assert.ok(Math.abs(after[v][0] - before[v][0]) < 1.5, `the keyforms went: the vertex is at rest again (${after[v]} vs ${before[v]})`);
  await undo.click();
  const back = await settle(n0 + 1);
  assert.equal(back.length, n0 + 1, 'undo took the vertex away');
  assert.ok(back[v][0] - before[v][0] > 25, 'and brought the keyform back');
  // Delete vertex: the lone vertex goes (or the edit is refused with a reason).
  await studio.locator('.aw-tt[data-tool="delete"]').click();
  await page.waitForTimeout(300); // the stage gets the tool a moment later
  await page.mouse.click(box.x + back[u][0], box.y + back[u][1]);
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.equal((await settle(n0 + 1)).length, n0 + 1);
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: a rig with no parameters gets a mesh in Deform and can be weighted to bones', { viewport: { width: 1280, height: 800 } }, async ({ page, errors }) => {
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(0).click(); // mina: bones and no parameters
  const studio = page.locator('#animStudio');
  await studio.locator('.as-tree .as-row[data-part="bangs"]').waitFor();
  assert.equal(await studio.locator('.ap-row').count(), 0, 'mina has no parameters');
  await studio.locator('.as-tree .as-row[data-part="bangs"]').click();
  await page.keyboard.press('d');
  await until(page, () => /vertices/.test(document.querySelector('#animStudio .aw-vcount')?.textContent ?? ''));
  assert.equal(await studio.locator('.aw-addbtn').isDisabled(), true, 'a lattice needs a parameter');
  assert.match(await studio.locator('.aw-addbtn').getAttribute('title'), /make one with \+ in the Parameters section/);
  assert.match(await studio.locator('.aw-none').textContent(), /Generate mesh works now/);
  await studio.locator('.aw-genbtn').click(); // a mesh does not: it can be weighted to bones
  await until(page, () => /^Mesh \d+ vertices/.test(document.querySelector('#animStudio .as-sub[data-sub="deform"] .as-sub-sum')?.textContent ?? ''));
  await page.keyboard.press('b');
  assert.equal(await studio.locator('.as-sub[data-sub="skin"]').getAttribute('data-open'), 'true', 'a mesh with no bone bound: Skin opens by itself');
  await studio.locator('.as-sub[data-sub="skin"] .aw-bindpick').selectOption({ index: 1 }); // Bind ▾ in its line: the first bone
  await studio.locator('.aw-autobtn').click();
  await until(page, () => /^Weighted bangs/.test(document.querySelector('#animStudio .as-note')?.textContent ?? ''));
  assert.equal(await studio.locator('.aw-unskin').isVisible(), true, 'the part is skinned');
  assert.deepEqual(errors, [], 'the page threw errors');
});

browserTest('animation studio: the Weights tool binds bones to a mesh and Auto-weights skins it, as one undo step that Apply writes', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await patchProject(page, proj => {
    // The left upper arm (87 x 157 pixels at 315, 455) gets a mesh with a row of vertices every 40 pixels, no weights yet.
    const verts = [], tris = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) verts.push(c * 43.5, r * 39.25);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) { const a = r * 3 + c; tris.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
    const arm = { id: 'upper_l_mesh', part: 'upper_l', mesh: { verts, tris, detail: 'low' }, keyforms: [] };
    proj.rigs.robo.rig.deformers.push(arm);
    proj.rigs.robo.rig.bones.forearm_l.tip = [380, 680]; // the forearm reaches down to the wrist: auto-weights measures a body from it
    const text = JSON.parse(proj.rigTexts.robo);
    text.deformers.push(arm);
    text.bones.forearm_l.tip = [380, 680];
    proj.rigTexts.robo = JSON.stringify(text);
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click();
  const studio = page.locator('#animStudio'), row = n => studio.locator(`.as-tree .as-row[data-part="${n}"]`);
  const sum = studio.locator('.as-sub[data-sub="skin"] .as-sub-sum'), none = studio.locator('.aww .aww-none');
  // The brush, the active bone, the test pose and the selection are in the tool options bar; the bones bound and Auto-weights in the section.
  const bar = studio.locator('.as-toolbar .atb[data-bar="weights"]'), label = studio.locator('.as-toolbar .atb-mode');
  const brush = m => bar.locator(`.aww-modebtn[data-brush="${m}"]`), active = bar.locator('.aww-bone'), setValue = bar.locator('.aww-setvalue');
  // A brush mode, and a wait until the stage acts on it: a press sent before the stage has the mode would paint instead.
  const setBrush = async m => {
    await brush(m).click();
    const frame = page.frames().find(fr => fr.url().includes('studio='));
    await poll(page, async () => (await frame.evaluate(() => document.documentElement.dataset.weightsMode)) === m, 50, 50);
  };
  await row('upper_l').waitFor();
  // A part with no mesh, and a bone, say what to do instead of showing controls.
  await row('torso').click();
  await studio.locator('[data-gz="weights"]').click();
  assert.match(await none.textContent(), /torso has no mesh yet/);
  assert.equal(await sum.textContent(), 'No mesh: Generate mesh in Deform', 'the Weights tool shows Skin on any part, to say where the mesh comes from');
  assert.equal(await studio.locator('.as-sub[data-sub="deform"]').getAttribute('data-open'), 'true', 'Deform opens by itself: Generate mesh');
  assert.equal(await studio.locator('.as-sub[data-sub="skin"]').getAttribute('data-open'), 'false');
  assert.equal(await studio.locator('.aww .aw-bind').isVisible(), false);
  // A part with a mesh: nothing is bound yet, and Auto-weights waits for a bone.
  await row('upper_l').click();
  assert.equal(await none.isVisible(), false);
  assert.equal(await sum.textContent(), 'Not skinned');
  assert.equal(await studio.locator('.as-sub[data-sub="skin"]').getAttribute('data-open'), 'true', 'a mesh with no bone bound: Skin opens by itself (Bind ▾)');
  assert.equal(await bar.locator('.aww-brush').isVisible(), true, 'the brush shows in the bar before a bind');
  assert.equal(await brush('add').isDisabled(), true, 'disabled until a bone is bound');
  assert.equal(await label.textContent(), 'Weights · Read weights', 'until then a press reads a vertex out');
  assert.equal(await studio.locator('.aww .aw-autobtn').isDisabled(), true);
  assert.equal(await studio.locator('.aw-unskin').isVisible(), false, 'no Remove skin before a skin');
  for (const bone of ['arm_l', 'forearm_l']) await studio.locator('.as-sub[data-sub="skin"] .as-sub-pick .aw-bindpick').selectOption(bone); // Bind ▾ binds the bone chosen
  assert.deepEqual(await studio.locator('.aww .aw-boundbone').allTextContents(), ['arm_l', 'forearm_l']);
  assert.equal(await active.inputValue(), 'forearm_l', 'the bone bound last is the active one');
  assert.equal(await label.textContent(), 'Weights · Add on forearm_l', 'the mode label names the brush and the active bone');
  // A click beside the mesh, on nothing, with the Weights tool on is a dab on air: the bound bones, the active one and the chosen row stay (docs/design/studio-stage-modes.md).
  const frame0 = await studio.locator('.as-stage iframe').boundingBox();
  await page.mouse.click(frame0.x + 30, frame0.y + 30);
  await page.waitForTimeout(300);
  assert.deepEqual(await studio.locator('.aww .aw-boundbone').allTextContents(), ['arm_l', 'forearm_l'], 'a miss on the stage keeps the bound bones');
  assert.equal(await active.inputValue(), 'forearm_l', 'and the active one');
  assert.equal(await row('upper_l').getAttribute('aria-pressed'), 'true', 'and the chosen row');
  assert.equal(await brush('add').getAttribute('aria-pressed'), 'true', 'the brush starts on Add once a bone is bound');
  await studio.locator('.aww .aw-blend').fill('60');
  await studio.locator('.aww .aw-autobtn').click();
  await until(page, () => document.querySelector('#animStudio .as-sub[data-sub="skin"] .as-sub-sum').textContent === '2 bones');
  assert.equal(await studio.locator('.as-sub[data-sub="skin"] .aw-unskin').isVisible(), true, "Remove skin is the line's verb");
  assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), false, 'the rig is dirty');
  // The stage colours each vertex by the active bone's weight (blue none, red all) and a click on a vertex reads its weights out.
  const stageFrame = page.frames().find(fr => fr.url().includes('studio='));
  const dots = stageFrame.locator('svg circle[fill^="hsl("]');
  await until(page, () => document.querySelector('#animStudio .aww-readout')?.textContent?.startsWith('Click a vertex'));
  await poll(page, async () => (await dots.count()) === 15);
  assert.equal(await dots.count(), 15, 'a dot at each of the mesh\'s vertices');
  const hues = await dots.evaluateAll(els => els.map(e => Number(/^hsl\((\d+)/.exec(e.getAttribute('fill'))[1])));
  assert.equal(hues[0], 240, 'the top row is on the default bone: no weight of the forearm');
  assert.ok(Math.min(...hues) < 200, 'a vertex near the forearm has some of its weight: not blue');
  await setBrush('pick'); // Read weights: a click reads a vertex out instead of painting it
  await dots.nth(13).click({ force: true });
  await until(page, () => /^vertex 13: .*forearm_l/.test(document.querySelector('#animStudio .aww-readout').textContent));
  await active.selectOption('arm_l');
  const armHues = await dots.evaluateAll(els => els.map(e => Number(/^hsl\((\d+)/.exec(e.getAttribute('fill'))[1])));
  assert.equal(armHues[0], 0, 'the same vertex is all arm_l on the other bone');
  // The brush: Replace on forearm_l with a solid strength paints the top vertex (all arm_l) into the forearm in one stroke, one undo step.
  await active.selectOption('forearm_l');
  await setBrush('replace');
  await bar.locator('.aww-radius').fill('25');
  await bar.locator('.aww-strength').fill('1');
  await until(page, () => document.querySelector('#animStudio .as-toolbar .atb-mode').textContent === 'Weights · Replace on forearm_l');
  const at0 = await dots.nth(0).evaluate(e => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]);
  const frame = await studio.locator('.as-stage iframe').boundingBox();
  const hue0 = async () => (await dots.evaluateAll(els => els.map(e => Number(/^hsl\((\d+)/.exec(e.getAttribute('fill'))[1]))))[0];
  assert.equal(await hue0(), 240, 'before the stroke the top vertex has no forearm weight');
  await page.mouse.move(frame.x + at0[0], frame.y + at0[1]);
  await page.mouse.down();
  await page.mouse.move(frame.x + at0[0] + 2, frame.y + at0[1] + 1, { steps: 3 });
  await page.mouse.up();
  await poll(page, async () => (await hue0()) === 0);
  assert.equal(await hue0(), 0, 'the stroke made the top vertex all forearm_l');
  await studio.locator('[data-t="undo"]').click();
  await poll(page, async () => (await hue0()) === 240);
  assert.equal(await hue0(), 240, 'one undo takes the whole stroke back');
  assert.equal(await sum.textContent(), '2 bones', 'and the skin from Auto-weights is still there');
  await setBrush('pick');
  // The test pose: the rotate gizmo turns the active bone (forearm_l) and the mesh bends with it; nothing is keyed or made dirty, and Reset pose lets go.
  const at14 = async () => dots.nth(14).evaluate(e => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]);
  const applyOff = await studio.locator('[data-t="apply"]').isDisabled();
  assert.equal(await bar.locator('.aww-posereset').isDisabled(), true, 'nothing is posed yet');
  const rest14 = await at14();
  await bar.locator('.aww-posebtn[data-pose="rotate"]').click();
  const ring = stageFrame.locator('svg circle[stroke="#4aa3ff"]');
  await poll(page, () => ring.count());
  const [rx, ry, rr] = await ring.first().evaluate(e => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy')), Number(e.getAttribute('r'))]);
  await page.mouse.move(frame.x + rx + rr, frame.y + ry);
  await page.mouse.down();
  await page.mouse.move(frame.x + rx, frame.y + ry + rr, { steps: 8 });
  await page.mouse.up();
  const moved = ([x, y]) => Math.hypot(x - rest14[0], y - rest14[1]);
  await poll(page, async () => moved(await at14()) >= 3);
  assert.ok(moved(await at14()) > 3, 'turning forearm_l carries the vertices that weight it');
  await poll(page, async () => !(await bar.locator('.aww-posereset').isDisabled()), 40, 50); // the drag's end reaches the studio after the stage has drawn it
  assert.equal(await bar.locator('.aww-posereset').isDisabled(), false, 'Reset pose is there while posed');
  assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), applyOff, 'a test pose is not an edit of the rig');
  await bar.locator('.aww-posereset').click();
  await poll(page, async () => moved(await at14()) <= 0.5);
  assert.ok(moved(await at14()) <= 0.5, 'Reset pose puts the mesh back');
  assert.equal(await bar.locator('.aww-posereset').isDisabled(), true);
  await bar.locator('.aww-posebtn[data-pose="rotate"]').click();
  // One undo step takes the skin away again; redo brings it back.
  await studio.locator('[data-t="undo"]').click();
  await until(page, () => document.querySelector('#animStudio .as-sub[data-sub="skin"] .as-sub-sum').textContent === 'Not skinned');
  await studio.locator('[data-t="redo"]').click();
  await until(page, () => document.querySelector('#animStudio .as-sub[data-sub="skin"] .as-sub-sum').textContent === '2 bones');
  await studio.locator('[data-t="apply"]').click();
  await poll(page, () => saved.length, 50);
  const mesh = JSON.parse(saved.at(-1)).deformers.find(d => d.part === 'upper_l').mesh;
  assert.equal(mesh.defaultBone, 'arm_l', 'the part\'s own bone is the default');
  assert.ok(mesh.weights && Object.keys(mesh.weights).length > 0, 'the vertices nearer the forearm are weighted');
  for (const e of Object.values(mesh.weights)) assert.ok(Object.keys(e).length >= 1 && Object.keys(e).length <= 4 && Math.abs(Object.values(e).reduce((s, w) => s + w, 0) - 1) < 0.01);
  // Precision (6a): a vertex selection, per-bone number fields and the Numeric row, each edit one undo step.
  const selHint = bar.locator('.aww-selhint'), numBtn = op => bar.locator(`.aww-numbtn[data-op="${op}"]`);
  const hues15 = async () => dots.evaluateAll(els => els.map(e => Number(/^hsl\((\d+)/.exec(e.getAttribute('fill'))[1])));
  const waitHues = async fn => { for (let i = 0; i < 40 && !fn(await hues15()); i++) await page.waitForTimeout(100); return hues15(); };
  await active.selectOption('forearm_l');
  assert.equal(await bar.locator('.aww-sel').isVisible(), false, 'the selection operations are Select mode\'s');
  await setBrush('select');
  assert.equal(await bar.locator('.aww-paint').first().isVisible(), false, 'Select does not paint: no radius or strength');
  assert.equal(await setValue.isDisabled(), true, 'nothing selected: Set value waits');
  await bar.locator('.aww-all').click();
  assert.equal(await selHint.textContent(), '15 selected');
  assert.equal(await setValue.isDisabled(), false);
  await bar.locator('.aww-invert').click();
  assert.equal(await selHint.textContent(), '', 'Invert of All is none');
  assert.equal(await setValue.isDisabled(), true);
  assert.equal(await bar.locator('.aww-none-btn').isDisabled(), true);
  // A rectangle on the stage around the top-left vertex selects just it; Shift-click on another vertex adds it, Esc clears.
  const p0 = await dots.nth(0).evaluate(e => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]);
  await page.mouse.move(frame.x + p0[0] - 6, frame.y + p0[1] - 6);
  await page.mouse.down();
  await page.mouse.move(frame.x + p0[0] + 6, frame.y + p0[1] + 6, { steps: 4 });
  await page.mouse.up();
  await until(page, () => document.querySelector('#animStudio .aww-selhint').textContent === '1 selected');
  assert.equal(await stageFrame.locator('svg circle[stroke="#ff3b6b"]').count(), 1, 'the stage rings the selected vertex');
  await dots.nth(4).click({ force: true, modifiers: ['Shift'] });
  await until(page, () => document.querySelector('#animStudio .aww-selhint').textContent === '2 selected');
  await page.keyboard.press('Escape');
  await until(page, () => document.querySelector('#animStudio .aww-selhint').textContent === '');
  // One selected vertex shows its weights as one number field per bound bone; typing a value sets that bone's weight (one undo step).
  await page.mouse.move(frame.x + p0[0] - 6, frame.y + p0[1] - 6);
  await page.mouse.down();
  await page.mouse.move(frame.x + p0[0] + 6, frame.y + p0[1] + 6, { steps: 4 });
  await page.mouse.up();
  const fields = studio.locator('.aww .aww-vw');
  await until(page, () => /^vertex 0: /.test(document.querySelector('#animStudio .aww-readout').textContent) && document.querySelectorAll('#animStudio .aww-vw').length === 2);
  assert.equal(await fields.nth(0).inputValue(), '1', 'arm_l has all of the top vertex');
  await fields.nth(1).fill('0.3');
  await fields.nth(1).press('Enter');
  await until(page, () => /forearm_l 0\.3/.test(document.querySelector('#animStudio .aww-readout').textContent));
  assert.match(await studio.locator('.aww .aww-readout').textContent(), /arm_l 0\.7/);
  await studio.locator('[data-t="undo"]').click();
  await until(page, () => /^vertex 0: arm_l 1$/.test(document.querySelector('#animStudio .aww-readout').textContent));
  // Numeric: All, then Set 1 on forearm_l turns every vertex red; one undo is one step back; Add and Subtract; Reset to default bone.
  await bar.locator('.aww-all').click();
  await setValue.click(); // the ▾ panel with the value and its operations
  await bar.locator('.aww-value').fill('1');
  await numBtn('set').click();
  assert.match(await bar.locator('.aww-numhint').textContent(), /selected vertices/);
  assert.deepEqual((await waitHues(h => h.every(x => x === 0))).every(x => x === 0), true, 'Set 1: every vertex is all forearm_l');
  await studio.locator('[data-t="undo"]').click();
  assert.equal((await waitHues(h => h[0] === 240))[0], 240, 'one undo takes the whole Set back');
  await setValue.click(); // Undo was a press outside the panel, which closed it
  await bar.locator('.aww-value').fill('0.4');
  await numBtn('add').click();
  assert.ok((await waitHues(h => h[0] < 240))[0] < 240, 'Add gave the top vertices some forearm_l');
  await numBtn('subtract').click();
  assert.equal((await waitHues(h => h[0] === 240))[0], 240, 'Subtract took it back');
  await numBtn('smooth').click();
  await numBtn('prune').click();
  await numBtn('reset').click();
  assert.equal((await waitHues(h => h.every(x => x === 240))).every(x => x === 240), true, 'Reset to default bone: nothing is left on forearm_l');
  assert.match(await studio.locator('.as-note').first().textContent(), /Reset to the default bone 15 vertices/);
  await setBrush('pick');
  // Remove skin asks, and one undo brings the weights back.
  await studio.locator('.as-sub[data-sub="skin"] .aw-unskin').click();
  await page.locator('dialog.ask').getByRole('button', { name: 'Remove' }).click();
  await until(page, () => document.querySelector('#animStudio .as-sub[data-sub="skin"] .as-sub-sum').textContent === 'Not skinned');
  assert.deepEqual(errors, []);
});

const BEND_VN = [
  'label robo_skin_test:',
  '  behaviors off',
  '  scene bg_park_evening',
  '  show robo at center',
  '  "Robo rests." #rb11',
  '  show robo pose=bent',
  '  "Robo bends." #rb12',
].join('\n');

/**
 * A roboHeads patch that skins the left upper arm (an 87 x 157 image at 315, 455 on the canvas) to arm_l and forearm_l: three columns of nine vertex rows, the
 * weight of the forearm rising from 0 at row 5 to 1 at the last. A parameter bends the forearm 70 degrees about the elbow, and the pose "bent" sets it.
 * `mask` also adds a shape that follows the arm's mesh (or, `'bone'`, hangs on arm_l only) and clips the arm to it.
 */
const skinnedArm = (mask = null) => rig => {
  const verts = [], tris = [], weights = {};
  for (let r = 0; r < 9; r++) for (let c = 0; c < 3; c++) {
    verts.push(c * 43.5, r * 19.625);
    const fw = Math.min(1, Math.max(0, (r - 4) / 4));
    if (fw > 0) weights[r * 3 + c] = fw >= 1 ? { forearm_l: 1 } : { arm_l: 1 - fw, forearm_l: fw };
  }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 2; c++) { const p = r * 3 + c; tris.push(p, p + 1, p + 3, p + 1, p + 4, p + 3); }
  const shape = [];
  for (let r = 0; r < 9; r++) shape.push([317, 455 + 2 + r * 19.625 * 0.98]);
  for (let r = 8; r >= 0; r--) shape.push([400, 455 + 2 + r * 19.625 * 0.98]);
  const parts = { ...rig.parts };
  if (mask) {
    parts.sleeve_clip = mask === 'bone' ? { bone: 'arm_l', polygon: shape } : { follow: 'upper_l', polygon: shape };
    parts.upper_l = { ...parts.upper_l, clip: 'sleeve_clip' };
  }
  return {
    parts,
    parameters: [...rig.parameters, { id: 'bend_l', min: 0, max: 1, default: 0 }],
    keyforms: [...rig.keyforms, { target: 'forearm_l', param: 'bend_l', keys: [{ at: 0 }, { at: 1, rot: 70 }] }],
    poses: { ...rig.poses, bent: { bend_l: 1 } },
    deformers: [...(rig.deformers ?? []), { id: 'upper_l_mesh', part: 'upper_l', mesh: { verts, tris, defaultBone: 'arm_l', weights }, keyforms: [] }],
  };
};
/** The same arm as an ordinary mesh with no weights: it rides on its own bone alone. */
const unskinnedArm = rig => {
  const { deformers, ...rest } = skinnedArm()(rig), mesh = { ...deformers.at(-1).mesh };
  delete mesh.weights; delete mesh.defaultBone;
  return { ...rest, deformers: [...deformers.slice(0, -1), { ...deformers.at(-1), mesh }] };
};

test('skinning: a part with bone weights bends where the forearm turns, and an unweighted mesh does not', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const lines = [/Robo rests/, /Robo bends/];
  const skinned = await roboHeads(skinnedArm(), lines, BEND_VN, 'roboskin.vn');
  const plain = await roboHeads(unskinnedArm, lines, BEND_VN, 'roboskin.vn');
  const arm = shot => shot.parts.upper_l, forearm = shot => shot.parts.lower_l;
  assert.ok(Math.abs(forearm(skinned[1])[0] - forearm(skinned[0])[0]) + Math.abs(forearm(skinned[1])[1] - forearm(skinned[0])[1]) > 20, 'the forearm swings in the bent pose');
  assert.deepEqual(arm(plain[1]), arm(plain[0]), 'an unweighted mesh stays on its own bone: bending the forearm does not move the upper arm');
  assert.deepEqual(arm(skinned[0]), arm(plain[0]), 'at rest a skinned arm is drawn as the unskinned one');
  const { canvas } = skinned[1], k = canvas.width / 1920, [bx, by, bw, bh] = arm(skinned[1]);
  const region = [Math.round(canvas.x + (bx - 20) * k), Math.round(canvas.y + (by - 20) * k), Math.round((bw + 80) * k), Math.round((bh + 80) * k)];
  assert.ok(differing(skinned[0].img, plain[0].img, ...region) < 0.001, 'at rest a skinned arm looks like the unskinned one');
  const bent = differing(skinned[1].img, plain[1].img, ...region);
  assert.ok(bent > 0.01, `the skinned arm's lower end follows the forearm: ${bent} of the pixels around it differ from the unskinned arm`);
});

test('skinning: a clip shape that follows a skinned part bends with it; one hung on the bone alone does not', async t => {
  if (skipReason) { t.skip(skipReason); return; }
  const lines = [/Robo rests/, /Robo bends/];
  const free = await roboHeads(skinnedArm(), lines, BEND_VN, 'roboskin.vn');
  const following = await roboHeads(skinnedArm('follow'), lines, BEND_VN, 'roboskin.vn');
  const onBone = await roboHeads(skinnedArm('bone'), lines, BEND_VN, 'roboskin.vn');
  const { canvas } = free[1], k = canvas.width / 1920;
  const moved = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
  const maskAt = (shots, i) => shots[i].parts['mask:sleeve_clip'];
  const [bx, by, bw, bh] = free[1].parts.upper_l;
  const region = [Math.round(canvas.x + bx * k), Math.round(canvas.y + by * k), Math.max(1, Math.round(bw * k)), Math.max(1, Math.round(bh * k))];
  const kept = differing(following[1].img, free[1].img, ...region);
  assert.equal(following[1].snap.masks, free[1].snap.masks + 1, 'the clip is one more stencil mask on stage (the robo has its eyelids\' already)');
  assert.ok(kept < 0.02, `a mask that follows the mesh still covers the bent arm (${kept} of its pixels differ)`);
  // The stencil's own outline: hung on the arm's mesh it moves when the forearm turns; hung on the bone alone it stays where the arm rests.
  assert.ok(moved(maskAt(following, 0), maskAt(following, 1)) > 8, `a mask that follows the mesh moves with the bent arm: ${maskAt(following, 0)} -> ${maskAt(following, 1)}`);
  assert.deepEqual(maskAt(onBone, 1), maskAt(onBone, 0), 'a mask on the bone alone stays where the arm rests');
});

browserTest('skinning: in the studio a click lands on a skinned arm where it is drawn bent, not where its art rests', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  await page.route('**/api/rig*', route => (route.request().method() !== 'PUT' ? route.continue() : route.fulfill({ status: 200, body: 'ok' })));
  await patchProject(page, proj => {
    const patch = skinnedArm()(proj.rigs.robo.rig);
    proj.rigs.robo.rig = { ...proj.rigs.robo.rig, ...patch };
    const text = JSON.parse(proj.rigTexts.robo);
    proj.rigTexts.robo = JSON.stringify({ ...text, parameters: patch.parameters, keyforms: patch.keyforms, poses: patch.poses, deformers: [...(text.deformers ?? []), patch.deformers.at(-1)] });
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click();
  const studio = page.locator('#animStudio'), row = n => studio.locator(`.as-tree .as-row[data-part="${n}"]`);
  await row('torso').waitFor();
  await row('torso').click();
  await studio.locator('[data-gz="weights"]').click();
  await studio.locator('.ap-row[data-ctl="bend_l"] input[type="range"]').evaluate(e => { e.value = '1'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  const stageFrame = page.frames().find(fr => fr.url().includes('studio='));
  // The weights tool needs a mesh part chosen to draw its dots; the arm's row is chosen, then the dots are read and a spot between four of them is clicked.
  await row('upper_l').click();
  const dots = stageFrame.locator('svg circle[fill^="hsl("]');
  await poll(page, async () => (await dots.count()) === 27);
  assert.equal(await dots.count(), 27);
  await page.waitForTimeout(500); // the bent pose settles
  // The arm is small on this stage and a bone handle takes a click within 10 pixels, so zoom in on it first.
  // The canvas is centred in the stage box, so the zoom aims at a spot of the art measured from the box's middle (it was 330 px down a 603 px box).
  // Model opens fitted to the character; these numbers are for the whole stage in view (Shift+F on the stage).
  await stageFrame.evaluate(() => window.focus());
  await page.keyboard.press('Shift+F');
  await page.waitForTimeout(200);
  const box0 = await studio.locator('.as-stage iframe').boundingBox();
  await page.mouse.move(box0.x + 335, box0.y + box0.height / 2 + 28.5);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(80); }
  await page.waitForTimeout(400);
  const at = await dots.evaluateAll(els => els.map(e => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]));
  const spot = [19, 22].map(i => at[i]).reduce((s, p) => [s[0] + p[0] / 2, s[1] + p[1] / 2], [0, 0]); // the middle column between rows 6 and 7: well inside the art, in the bent part
  const box = await studio.locator('.as-stage iframe').boundingBox();
  await studio.locator('[data-gz="move"]').click(); // the Move tool picks on the stage: a click on art chooses the part (docs/design/studio-stage-modes.md)
  await page.evaluate(() => { window.__sel = []; window.addEventListener('message', e => { if (e.data?.type === 'studioSelect') window.__sel.push({ name: e.data.name, hits: e.data.hits, at: e.data.at }); }); });
  await row('torso').click();
  assert.equal(await row('upper_l').getAttribute('aria-pressed'), 'false');
  // With the bent mesh drawn there, a click on the spot picks the arm part (upper_l), not the forearm that swung under it, and not its bone.
  for (let i = 0; i < 20 && (await row('upper_l').getAttribute('aria-pressed')) !== 'true'; i++) { await page.mouse.click(box.x + spot[0], box.y + spot[1]); await page.waitForTimeout(300); }
  const pressed = await studio.locator('.as-row[aria-pressed="true"]').evaluateAll(es => es.map(e => e.dataset.part));
  assert.equal(await row('upper_l').getAttribute('aria-pressed'), 'true', `the click chose the arm part, where it is drawn bent (chosen: ${pressed}; the stage said ${JSON.stringify(await page.evaluate(() => window.__sel))}; spot ${spot.map(Math.round)})`);
  assert.equal(await row('arm_l').getAttribute('aria-pressed'), 'false', 'the bone is not chosen by a plain click');
  assert.equal(await row('forearm_l').getAttribute('aria-pressed'), 'false');
  assert.match(await studio.locator('.as-toolbar .atb-line').textContent(), /^poses arm_l, the bone upper_l sits on · /, 'the tool options bar says which bone the gizmo poses');
  assert.match(await studio.locator('.as-note').getAttribute('data-hint'), /^Alt-click the part, or click its bone's dot, to choose the bone/, 'and the status line how to choose the bone');
  assert.equal(await studio.locator('.as-sub[data-sub="transform"] .as-bone-go').textContent(), 'Choose arm_l', 'Properties links to the bone');
  // The gizmo poses the part's bone, but the stage tells the two apart (studio-choice-cue.md): the part is outlined, its bone's dot
  // stays plain, and the tag by the gizmo says so.
  const tag = stageFrame.locator('.studio-choice-tag');
  await poll(page, async () => !(await tag.isHidden()), 20);
  assert.equal(await tag.textContent(), 'upper_l · part — the gizmo poses its bone arm_l');
  assert.ok(await stageFrame.locator('svg line[data-outline="upper_l"][stroke="#ff3b6b"]').count() >= 4, 'the chosen part is outlined');
  assert.equal(await stageFrame.locator('svg [data-bone-body]').count(), 0);
  const dot = stageFrame.locator('svg circle[data-bone="arm_l"]');
  assert.equal(await dot.getAttribute('data-chosen'), null, 'the bone dot is plain while the part is chosen');
  const dotAt = await dot.evaluate(e => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]);
  await row('torso').click();
  await poll(page, async () => (await row('upper_l').getAttribute('aria-pressed')) === 'false', 20);
  for (let i = 0; i < 20 && (await row('arm_l').getAttribute('aria-pressed')) !== 'true'; i++) { await page.mouse.click(box.x + dotAt[0], box.y + dotAt[1]); await page.waitForTimeout(300); }
  assert.equal(await row('arm_l').getAttribute('aria-pressed'), 'true', `a click on the bone's pivot dot chooses the bone (dot at ${dotAt.map(Math.round)})`);
  assert.equal(await row('upper_l').getAttribute('aria-pressed'), 'false');
  // The bone chosen: its body is drawn, its dot is a ring around the gizmo's centre, the parts it carries are outlined faintly, and the tag says bone.
  await poll(page, async () => /· bone ·/.test(await tag.textContent()), 20);
  assert.match(await tag.textContent(), /^arm_l · bone · \d+ parts?$/);
  assert.ok(await stageFrame.locator('svg [data-bone-body="arm_l"]').count() >= 2, 'the bone body is drawn');
  const body = await stageFrame.evaluate(() => {
    const s = document;
    const at = n => { const c = s.querySelector(`circle[data-bone="${n}"]`); return [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]; };
    const [a, b] = [at('arm_l'), at('forearm_l')];
    return [...s.querySelectorAll('[data-bone-body="arm_l"]')].every(l => [['x1', 'y1', a], ['x2', 'y2', b]].every(([x, y, p]) => Math.abs(Number(l.getAttribute(x)) - p[0]) < 0.5 && Math.abs(Number(l.getAttribute(y)) - p[1]) < 0.5));
  });
  assert.ok(body, 'the bone body runs from its joint to its child bone forearm_l');
  assert.equal(await stageFrame.locator('svg circle[data-bone="arm_l"]').getAttribute('data-chosen'), 'true');
  assert.equal(await stageFrame.locator('svg circle[data-bone="arm_l"]').getAttribute('r'), '11', 'a ring the gizmo square does not cover');
  assert.ok(await stageFrame.locator('svg line[data-outline="upper_l"][stroke="#fff"]').count() >= 4, 'the parts it carries are outlined faintly');
  // The tag stays clear of the gizmo's handles and inside the stage.
  const clear = await stageFrame.locator('.studio-choice-tag').evaluate(t => {
    const r = t.getBoundingClientRect(), hits = [...document.querySelectorAll('svg rect, svg polygon')].map(e => e.getBoundingClientRect());
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && hits.every(h => h.right < r.left || h.left > r.right || h.bottom < r.top || h.top > r.bottom);
  });
  assert.ok(clear, 'the tag is inside the stage and off the handles');
  assert.deepEqual(errors, []);
});

browserTest('theme panel: fields write the theme file, contrast warns, the gallery follows and click-to-inspect jumps to the component', { viewport: { width: 1280, height: 900 } }, async ({ page, errors }) => {
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
  await page.goto(`${base}editor/`);
  await palette(page, '>Theme: Panel');
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
  await tile('Options').evaluate(f => f.contentDocument.querySelector('#optionsui [role=tab][aria-selected=true]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await panel.locator('.td-comp').waitFor();
  assert.equal(await panel.locator('.td-comp').inputValue(), 'tab');
  assert.equal(await panel.locator('.td-state').inputValue(), 'selected');
  await tile('Text box').evaluate(f => f.contentDocument.querySelector('#name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await until(page, () => document.querySelector('#themePanel .td-comp')?.value === 'namebox');
  assert.deepEqual(errors, []);
});

browserTest('animation studio: Mirror copies one half of a mesh\'s weights to the other with the bones paired by name, and asks for a partner it cannot find', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await page.route('**/api/project', async route => {
    const res = await route.fetch();
    const proj = await res.json();
    // The left upper arm (87 x 157 pixels) gets a 3 x 5 mesh whose left column is weighted: vertex 0 to arm_l and forearm_l, vertex 3 to spine (a bone with no side in its name).
    const verts = [], tris = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) verts.push(c * 43.5, r * 39.25);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) { const a = r * 3 + c; tris.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
    const arm = { id: 'upper_l_mesh', part: 'upper_l', mesh: { verts, tris, defaultBone: 'arm_l', weights: { 0: { arm_l: 0.7, forearm_l: 0.3 }, 3: { spine: 1 } } }, keyforms: [] };
    proj.rigs.robo.rig.deformers.push(arm);
    const text = JSON.parse(proj.rigTexts.robo);
    text.deformers.push(arm);
    proj.rigTexts.robo = JSON.stringify(text);
    await route.fulfill({ response: res, json: proj });
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click();
  const studio = page.locator('#animStudio'), row = n => studio.locator(`.as-tree .as-row[data-part="${n}"]`), dialog = page.locator('dialog.ask');
  const sum = studio.locator('.as-sub[data-sub="skin"] .as-sub-sum'), left = studio.locator('.aww-mirbtn[data-from="left"]');
  await row('upper_l').waitFor();
  await row('upper_l').click();
  await studio.locator('[data-gz="weights"]').click();
  assert.equal(await sum.textContent(), '3 bones', 'arm_l, forearm_l and spine are bound');
  // Mirror is a selection operation of the tool options bar: Select mode, then its ▾ panel.
  const mirror = studio.locator('.as-toolbar .aww-mirror');
  assert.equal(await mirror.isVisible(), false, 'not in a painting mode');
  await studio.locator('.as-toolbar .aww-modebtn[data-brush="select"]').click();
  await poll(page, async () => !(await mirror.isDisabled())); // the stage measures the image
  assert.equal(await mirror.isDisabled(), false, 'Mirror waits for the stage to measure the image');
  await mirror.click();
  // arm_l and forearm_l pair by name; spine has no side, so it is asked for, in one dialog with a choice of the rig's bones (SD-13),
  // starting at spine itself (no numbered family to guess from).
  await left.click();
  await dialog.waitFor();
  assert.equal(await dialog.locator('select').count(), 1, 'one row: spine');
  const partner = dialog.getByRole('combobox', { name: 'Partner of spine' });
  assert.equal(await partner.inputValue(), 'spine');
  assert.ok((await partner.locator('option').allTextContents()).includes('arm_r'), "the choices are the rig's bones");
  await dialog.getByRole('button', { name: 'Mirror' }).click();
  await until(page, () => document.querySelector('#animStudio .as-sub[data-sub="skin"] .as-sub-sum').textContent === '5 bones');
  // One undo step takes it back; the answer is remembered, so mirroring again asks nothing.
  await studio.locator('[data-t="undo"]').click();
  await until(page, () => document.querySelector('#animStudio .as-sub[data-sub="skin"] .as-sub-sum').textContent === '3 bones');
  await mirror.click(); // Undo was a press outside the panel, which closed it
  await left.click();
  await until(page, () => document.querySelector('#animStudio .as-sub[data-sub="skin"] .as-sub-sum').textContent === '5 bones');
  assert.equal(await dialog.count(), 0, 'the partner was asked once');
  await studio.locator('[data-t="apply"]').click();
  await poll(page, () => saved.length, 50);
  const w = JSON.parse(saved.at(-1)).deformers.find(d => d.part === 'upper_l').mesh.weights;
  assert.deepEqual(w[2], { arm_r: 0.7, forearm_r: 0.3 }, 'the top right vertex has the top left one\'s weights, bones paired');
  assert.deepEqual(w[5], { spine: 1 }, 'spine is its own partner, as the author said');
  assert.deepEqual(w[8], { arm_r: 1 }, 'a vertex on the default bone mirrors to the partner of that bone');
  assert.deepEqual(w[0], { arm_l: 0.7, forearm_l: 0.3 }, 'the source half is untouched');
  assert.deepEqual(errors, []);
});

browserTest('animation studio: removing a bone gives its weights to its parent on every skinned mesh, in the same undo step', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  const saved = [];
  await page.route('**/api/rig*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    saved.push(route.request().postData());
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await patchProject(page, proj => {
    // The left upper arm's mesh has forearm_l as its default bone and one vertex split between arm_l and forearm_l.
    const verts = [], tris = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) verts.push(c * 43.5, r * 39.25);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) { const a = r * 3 + c; tris.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
    const arm = { id: 'upper_l_mesh', part: 'upper_l', mesh: { verts, tris, defaultBone: 'forearm_l', weights: { 13: { arm_l: 0.4, forearm_l: 0.6 }, 14: { arm_l: 0.1, forearm_l: 0.2, hand_l: 0.7 } } }, keyforms: [] };
    proj.rigs.robo.rig.bones.hand_l = { parent: 'forearm_l', pivot: [420, 650] };
    proj.rigs.robo.rig.deformers.push(arm);
    const text = JSON.parse(proj.rigTexts.robo);
    text.bones.hand_l = { parent: 'forearm_l', pivot: [420, 650] };
    text.deformers.push(arm);
    proj.rigTexts.robo = JSON.stringify(text);
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click();
  const studio = page.locator('#animStudio'), row = n => studio.locator(`.as-tree .as-row[data-part="${n}"]`);
  const sum = studio.locator('.as-sub[data-sub="skin"] .as-sub-sum');
  await row('forearm_l').waitFor();
  await row('forearm_l').click();
  await studio.locator('.as-bone-del').click();
  await row('forearm_l').waitFor({ state: 'detached' });
  await row('upper_l').click();
  await studio.locator('[data-gz="weights"]').click();
  assert.equal(await sum.textContent(), '2 bones', 'arm_l now carries the weight forearm_l had, hand_l stays');
  await studio.locator('[data-t="apply"]').click();
  await poll(page, () => saved.length, 50);
  const rig = JSON.parse(saved.at(-1)), mesh = rig.deformers.find(d => d.part === 'upper_l').mesh;
  assert.equal(rig.bones.forearm_l, undefined, 'the bone is gone');
  assert.equal(mesh.defaultBone, 'arm_l', 'the default bone moved up too');
  assert.deepEqual(mesh.weights[13], undefined, 'all on arm_l, the new default bone: not stored');
  assert.equal(mesh.weights[14].arm_l, 0.3, 'forearm_l\'s 0.2 joined arm_l\'s 0.1');
  assert.equal(mesh.weights[14].hand_l, 0.7);
  assert.equal(JSON.stringify(mesh).includes('forearm_l'), false, 'nothing names the removed bone');
  // One undo step brings the bone and the weights back together.
  await studio.locator('[data-t="undo"]').click();
  await row('forearm_l').waitFor();
  await until(page, () => document.querySelector('#animStudio .as-sub[data-sub="skin"] .as-sub-sum').textContent === '3 bones');
  assert.deepEqual(errors, []);
});

browserTest('skinning: a Warp-tool drag on a skinned mesh waits while a bone that moves it is posed by a parameter', { viewport: { width: 1280, height: 800 } }, async ({ t, page, errors }) => {
  await page.route('**/api/rig*', route => (route.request().method() !== 'PUT' ? route.continue() : route.fulfill({ status: 200, body: 'ok' })));
  await patchProject(page, proj => {
    const patch = skinnedArm()(proj.rigs.robo.rig);
    patch.deformers.at(-1).keyforms = [{ param: 'bend_l', keys: [{ at: 0 }, { at: 1 }] }]; // the mesh is warped by bend_l too, so choosing that slider keeps the arm chosen
    proj.rigs.robo.rig = { ...proj.rigs.robo.rig, ...patch };
    const text = JSON.parse(proj.rigTexts.robo);
    proj.rigTexts.robo = JSON.stringify({ ...text, parameters: patch.parameters, keyforms: patch.keyforms, poses: patch.poses, deformers: [...(text.deformers ?? []), patch.deformers.at(-1)] });
  });
  await page.goto(`${base}editor/`);
  await page.locator('button.anim', { hasText: 'Model' }).nth(1).click();
  const studio = page.locator('#animStudio'), row = n => studio.locator(`.as-tree .as-row[data-part="${n}"]`), note = studio.locator('.as-note');
  const slider = studio.locator('.ap-row[data-ctl="bend_l"] input[type="range"]');
  await row('upper_l').waitFor();
  await row('upper_l').click();
  await studio.locator('[data-gz="warp"]').click();
  await studio.locator('.ap-row[data-ctl="bend_l"] > label').click(); // the active parameter: the warp is keyed to it
  const stageFrame = page.frames().find(fr => fr.url().includes('studio='));
  const dot = stageFrame.locator('svg circle[r="3"]').first(); // a vertex of the mesh
  await poll(page, () => dot.count());
  const drag = async () => {
    const at = await dot.evaluate(e => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]), box = await studio.locator('.as-stage iframe').boundingBox();
    await page.mouse.move(box.x + at[0], box.y + at[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + at[0] + 6, box.y + at[1] + 4, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  // The slider bends the forearm: the mesh is skinned to it, so the drag is refused and the note says why.
  await slider.evaluate(e => { e.value = '1'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(400);
  await drag();
  assert.match(await note.textContent(), /skinned and forearm_l is posed by a parameter/);
  assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), true, 'the refused drag changed nothing');
  // Back at rest the same drag keys the mesh.
  await slider.evaluate(e => { e.value = '0'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(400);
  await drag();
  await poll(page, async () => !(await studio.locator('[data-t="apply"]').isDisabled()), 30);
  assert.equal(await studio.locator('[data-t="apply"]').isDisabled(), false, 'at rest the drag wrote a keyform');
  assert.deepEqual(errors, []);
});

describe('browser', { concurrency: Math.max(1, Number(process.env.VN_BROWSER_JOBS) || 6) }, () => {
  queueRun = true;
  for (const args of queued) nodeTest(...args);
});
