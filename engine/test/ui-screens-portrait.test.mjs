import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, Runtime, NullRenderer, UI_SCREENS, screenStarter, textSize, SLIDER_SETTINGS, CYCLE_SETTINGS, OPTIONS_VARS } from '../../dist/engine/src/index.js';

// UX round PI-1: the stock screens were placed in 1920x1080 pixels, so on a portrait phone the Load/Save Back button and half of Options were
// off-screen. Every stock screen must now lie inside the stage of the project, whatever its size.

const STAGES = [{ width: 1080, height: 1920 }, { width: 720, height: 1280 }, { width: 1080, height: 2340 }];
const ids = (n, prefix = '') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const entriesOf = (list, make) => Object.fromEntries(list.map((id, i) => [id, make(i)]));

/** Realistic data for each shell list screen: long names and dialogue, every flag on, so the layout is tested at its fullest. */
function views(rt) {
  const pageIds = [...['auto', 'quick', 'choice'].map(x => `page${x}`), ...ids(9, 'page')];
  const slotIds = ids(6);
  const settings = {
    ...Object.fromEntries(Object.entries(SLIDER_SETTINGS).map(([k, s]) => [k, s.max])),
    ...Object.fromEntries(CYCLE_SETTINGS.flatMap(k => [[k, 'normal'], [`${k}_word`, 'Normal']])),
    ...Object.fromEntries(OPTIONS_VARS.map(k => [k, true])),
  };
  const lines = ids(30);
  const tiles = ids(9);
  const tracks = ids(12);
  const chapters = ids(10);
  const achievements = ids(8);
  const entry = (id, i) => ({ title: `Entry ${id} with a rather long title that must not run off`, unlocked: i % 3 !== 0, hidden: false, ending: false, description: 'A description that is long enough to need two lines on a phone, and then some more.', icon: 'ui/icon.png', file: `cg/${id}.png`, playing: i === 1 });
  return {
    options: ['audio', 'game', 'access'].map(tab => [`options ${tab}`, rt.optionsView({ ...settings, tab, speaker_focus: 'on' })]),
    saves: ['load', 'save'].map(mode => [`saves ${mode}`, rt.savesView({
      mode, page: 'page1', pages: mode === 'load' ? pageIds : pageIds.slice(3), slots: slotIds, deleting: false, can_rename: true,
      note: 'This save was made with an older version of the game and may not load.',
    }, {
      pages: entriesOf(pageIds, (_, id) => ({ name: 'Auto' })),
      slots: entriesOf(slotIds, i => ({
        title: `Slot ${i + 1}`, heading: `Slot ${i + 1}`, label: '', when: '11/8/26, 1:41 PM', text: 'Alice: A long last line of dialogue that has to be cut off at the edge of the slot', empty: false, thumb: 'x.png', removable: true, renamable: true,
      })),
    })]),
    history: [['history', rt.historyView({ lines, total: 30 }, { lines: entriesOf(lines, i => ({ name: 'Alice', color: '#ff9ec4', text: 'A line of dialogue long enough to wrap onto a second and a third line when it is shown in a narrow column on a phone.', current: false, voiced: i % 2 === 0 })) })]],
    gallery: [['gallery', rt.galleryView({ tiles, count: 6, total: 9 }, { tiles: entriesOf(tiles, i => entry(String(i + 1), i)) })]],
    viewer: [['viewer', rt.viewerView({ file: 'cg/1.png', title: 'Rainy platform', position: 1, total: 4 })]],
    music: [['music', rt.musicView({ tracks, count: 8, total: 12, now: 'Evening theme (a long track title)' }, { tracks: entriesOf(tracks, i => entry(String(i + 1), i)) })]],
    chapters: [['chapters', rt.chaptersView({ chapters, count: 4, total: 10 }, { chapters: entriesOf(chapters, i => entry(String(i + 1), i)) })]],
    achievements: [['achievements', rt.achievementsView({ achievements, endings: achievements, count: 3, total: 8, endings_count: 1, endings_total: 3 }, {
      achievements: entriesOf(achievements, i => entry(String(i + 1), i)), endings: entriesOf(achievements, i => entry(String(i + 1), i)),
    })]],
    achievement_toast: [['toast', rt.achievementToastView({ title: 'A rather long achievement title', description: 'And a description of what you did to get it.', icon: 'ui/icon.png', ending: false, position: 'top' })]],
  };
}

const rectOf = p => p.bounds ?? (p.w != null && p.h != null ? { x: p.x, y: p.y, w: p.w, h: p.h } : null);

test('portrait stages draw the built-in screens inside the stage (PI-1)', () => {
  for (const stage of STAGES) {
    const rt = new Runtime(compile([{ file: 'start.vn', text: 'label start:\n  end\n' }], undefined, undefined, stage), new NullRenderer());
    for (const [screen, group] of Object.entries(views(rt))) {
      for (const [name, view] of group) {
        const where = `${name} on ${stage.width}x${stage.height}`;
        assert.ok(view, `${where} resolves`);
        const outside = [];
        for (const part of view.parts) {
          // Inside a scroll area only the width matters: the content scrolls vertically.
          const r = part.kind === 'text'
            ? { x: part.x, y: part.y, ...textSize(part.text, part.font ?? 40, part.width) }
            : rectOf(part);
          if (!r) continue;
          const inArea = part.area !== undefined;
          if (r.x < -1 || r.x + r.w > stage.width + 1 || (!inArea && (r.y < -1 || (part.kind !== 'text' && r.y + r.h > stage.height + 1)))) {
            outside.push(`${part.kind} ${part.id ?? part.text ?? ''} at ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`);
          }
        }
        assert.deepEqual(outside, [], `${where}: parts outside the stage`);
      }
    }
  }
});

test('on a portrait stage Back is clear of everything else, and touch buttons are big', () => {
  for (const stage of STAGES) {
    const rt = new Runtime(compile([{ file: 'start.vn', text: 'label start:\n  end\n' }], undefined, undefined, stage), new NullRenderer());
    const k = stage.width / 1080;
    for (const [screen, group] of Object.entries(views(rt))) {
      if (screen === 'viewer' || screen === 'achievement_toast') continue;
      for (const [name, view] of group) {
        const where = `${name} on ${stage.width}x${stage.height}`;
        const back = view.parts.find(p => p.id === 'done');
        assert.ok(back, `${where} has Back`);
        // What is inside a scroll area is in scrolled coordinates; the area itself (kind scroll) is what must stay clear of Back.
        const others = view.parts.filter(p => p !== back && p.area === undefined && ['button', 'hotspot', 'slider', 'scroll'].includes(p.kind));
        const hit = others.filter(p => {
          const r = rectOf(p);
          return r.x < back.bounds.x + back.bounds.w && r.x + r.w > back.bounds.x && r.y < back.bounds.y + back.bounds.h && r.y + r.h > back.bounds.y;
        });
        assert.deepEqual(hit.map(p => p.id ?? p.kind), [], `${where}: something overlaps Back`);
        assert.ok(back.bounds.h >= 110 * k - 1, `${where}: Back is ${back.bounds.h} tall`);
      }
    }
  }
});

test('landscape stages keep the starters as they were; portrait changes the screens that overflowed, not the anchored ones', () => {
  const portrait = { width: 1080, height: 1920 };
  for (const u of UI_SCREENS) {
    assert.equal(screenStarter(u.name), u.starter, `${u.name} on the default stage`);
    assert.equal(screenStarter(u.name, { width: 1280, height: 720 }), u.starter, `${u.name} on a small landscape stage`);
  }
  for (const name of ['title', 'pause', 'quickmenu']) assert.equal(screenStarter(name, portrait), UI_SCREENS.find(u => u.name === name).starter);
  for (const name of ['options', 'saves', 'history', 'gallery', 'viewer', 'music', 'chapters', 'achievements', 'achievement_toast']) {
    assert.notEqual(screenStarter(name, portrait), UI_SCREENS.find(u => u.name === name).starter, name);
  }
});

test('portrait layouts say the same words as the landscape ones, so translations of the labels still apply', () => {
  const words = code => new Set([...code.matchAll(/"([^"]*)"/g)].map(m => m[1]));
  for (const u of UI_SCREENS) {
    assert.deepEqual([...words(screenStarter(u.name, { width: 1080, height: 1920 }))].sort(), [...words(u.starter)].sort(), u.name);
  }
});

test('a portrait project overriding one screen keeps the default portrait layouts of the rest', () => {
  const stage = { width: 1080, height: 1920 };
  const p = compile([{ file: 'start.vn', text: 'label start:\n  end\n' }, { file: 'ui/options.vn', text: 'screen options:\n  button done at 100,100 "Back" action close\n' }], undefined, undefined, stage);
  assert.deepEqual(p.diagnostics.filter(d => d.severity === 'error'), []);
  assert.equal(p.screens.options.body.length, 1);
  assert.ok(p.screens.saves, 'saves still drawn from the stock layout');
});
