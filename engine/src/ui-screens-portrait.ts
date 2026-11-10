import type { StageSize } from './stage.js';

// Portrait versions of the built-in screens that do not fit a narrow stage: the landscape starters (ui-screens.ts) are placed in
// 1920x1080 pixels, so on a 1080x1920 stage their right half is off-screen (a Back button nobody can reach). The title, pause menu
// and quick menu are anchored and already fit, so they are not repeated here.
//
// Written for a 1080-wide stage about 9:16 or taller; every length is scaled by width / 1080, so a 720x1280 stage gets the same
// picture, and tall phones (1080x2340) get the extra height in the lists. Text is at least 30px (11 CSS px on a 390 px wide phone, where
// 1080 stage pixels are 390) and buttons at least 80px tall (29 CSS px): list rows and the main buttons are bigger, 110 to 120px.

/** A list screen's Back button, centred at the bottom where a thumb rests. */
const back = (n: (v: number) => number) => `  row anchor bottom margin 0,0,${n(100)},0 gap ${n(20)}:\n    button done size ${n(440)},${n(120)} "Back" action close\n`;

/** The starters that have a portrait layout, by screen name, for this stage. */
export function portraitStarters(stage: StageSize): Record<string, string> {
  const k = stage.width / 1080;
  const n = (v: number) => Math.round(v * k);
  const W = stage.width, H = stage.height;
  const inner = W - 2 * n(60); // the content column of a full-height panel
  // A list area under a title row, above the Back button.
  const listTop = n(200), listH = Math.max(n(200), H - listTop - n(250));
  const title = (text: string, extra = '') => `  text at ${n(60)},${n(90)} "${text}" font ${n(64)}${extra}\n`;
  const count = (cond = '') => `  text at ${n(60)},${n(110)} "[count] / [total]" font ${n(40)} width ${inner} align right color #aab0be${cond}\n`;
  const dim = (alpha: string) => `  panel size full color rgba(4,6,10,${alpha}) on enter fade 0.2s on exit fade 0.15s\n`;
  const fade = ' on enter fade 0.3s on exit fade 0.15s';
  const slide = ' on enter slide up 0.3s distance=30 on exit fade 0.15s';

  const gridCell = `${n(470)},${n(310)}`;
  // One setting of the options screen: its label over a full-width control, so a long label never wraps and a slider's readout has room.
  const setting = (label: string, control: string, cond: string) => `    column gap ${n(6)}${cond}:\n      text "${label}" font ${n(44)}\n      ${control}\n`;
  const slider = (label: string, id: string, cond = '') => setting(label, `slider ${id} size ${n(830)},${n(72)} readout`, cond);
  const cycle = (label: string, id: string, cond = '') => setting(label, `button ${id} "[${id}_word]" size ${inner},${n(92)} action cycle`, cond);
  const select = (label: string, id: string, cond = '') => setting(label, `select ${id} size ${inner},${n(92)}`, cond);

  return {
    options: `screen options:
${dim('.62')}  panel at ${n(30)},${n(60)} size ${W - 2 * n(30)},${H - 2 * n(60)} on enter fade 0.25s on exit fade 0.15s
  text at ${n(60)},${n(100)} "Options" font ${n(64)} on enter slide down 0.3s distance=30 on exit fade 0.15s
  panel at ${n(60)},${n(290)} size ${inner},2 color rgba(255,255,255,.25) on enter fade 0.25s on exit fade 0.15s
  row at ${n(60)},${n(198)} gap ${n(8)} on enter slide down 0.3s distance=30 on exit fade 0.15s:
    button audio size ${n(280)},${n(92)} "Audio" action tab
    button game size ${n(280)},${n(92)} "Game" action tab
    button access size ${n(384)},${n(92)} "Accessibility" action tab
  column at ${n(60)},${n(330)} gap ${n(18)} if tab == "audio" on enter fade 0.25s:
${slider('Master volume', 'master')}${slider('Music', 'music')}${slider('Sound', 'sound')}${slider('Voice', 'voice')}${cycle('Text sounds', 'text_sounds')}  column at ${n(60)},${n(330)} gap ${n(18)} if tab == "game" on enter fade 0.25s:
${slider('Text speed', 'text_speed')}${select('Auto speed', 'auto_speed')}${select('Skip', 'skip')}${cycle('Dim who is not speaking', 'speaker_focus', ' if speaker_focus != "none"')}${select('Language', 'language', ' if has_languages')}${select('Theme', 'theme', ' if has_themes')}${select('Voice language', 'voice_language', ' if has_voice_languages')}    button reset size ${n(460)},${n(92)} "Reset progress" action reset
  column at ${n(60)},${n(330)} gap ${n(18)} if tab == "access" on enter fade 0.25s:
${slider('Text size', 'text_size')}${slider('Text box opacity', 'box_opacity')}${cycle('Reduce motion', 'reduce_motion')}${cycle('Sound captions', 'captions')}${cycle('Screen reader reads dialogue', 'announce_lines')}${cycle('Touch gestures', 'touch_gestures', ' if has_touch')}${select('Timed choices', 'timed_choices')}  row anchor bottom margin 0,0,${n(100)},0 gap ${n(20)} on enter slide up 0.3s distance=30 on exit fade 0.15s:
    button full size ${n(460)},${n(120)} "Fullscreen" action fullscreen if has_fullscreen
    button done size ${n(460)},${n(120)} "Back" action close
`,

    saves: `screen saves:
${dim('.62')}  panel at ${n(30)},${n(60)} size ${W - 2 * n(30)},${H - 2 * n(60)} on enter fade 0.25s on exit fade 0.15s
  text at ${n(60)},${n(100)} "Save" font ${n(64)} if mode == "save" on enter slide down 0.3s distance=30 on exit fade 0.15s
  text at ${n(60)},${n(100)} "Load" font ${n(64)} if mode == "load" on enter slide down 0.3s distance=30 on exit fade 0.15s
  text at ${n(300)},${n(112)} "[note]" font ${n(30)} width ${n(720)} lines 2 color #e8706a if note != ""
  grid 6 at ${n(60)},${n(230)} gap ${n(12)} cell ${n(150)},${n(88)}:
    each pages as pg on enter fade 0.3s stagger 0.02s on exit fade 0.15s:
      panel size ${n(150)},${n(88)} color rgba(0,0,0,0):
        button pg at 0,0 size ${n(150)},${n(88)} "[pg.name]" tooltip "[pg.title]" action page
        panel at 0,0 size ${n(150)},${n(88)} color rgba(255,255,255,.18) if pg == page
  grid 2 at ${n(60)},${n(450)} gap ${n(20)} cell ${n(470)},${n(380)}:
    each slots as slot on enter slide up 0.25s distance=30 stagger 0.04s on exit fade 0.15s:
      panel size ${n(470)},${n(380)} color rgba(0,0,0,0):
        button slot at 0,0 size ${n(470)},${n(380)} " " action slot enabled mode == "save" or not slot.empty
        image "[slot.thumb]" at ${n(10)},${n(10)} size ${n(450)},${n(253)} if slot.thumb != ""
        panel at ${n(10)},${n(10)} size ${n(450)},${n(253)} color rgba(0,0,0,.4) if slot.thumb == ""
        text at ${n(14)},${n(272)} "[slot.heading]" font ${n(34)} width ${n(200)} lines 1
        text at ${n(214)},${n(278)} "[slot.when]" font ${n(26)} width ${n(246)} align right lines 1 color #aab0be
        text at ${n(10)},${n(110)} "[slot.text]" font ${n(36)} width ${n(450)} align center color #6b7385 if slot.empty
        text at ${n(14)},${n(322)} "[slot.text]" font ${n(30)} width ${n(440)} lines 1 color #c9ced8 if not slot.empty
        button slot.rename at ${n(290)},${n(18)} size ${n(80)},${n(80)} "✎" tooltip "Rename save" action rename if can_rename and slot.renamable
        button slot.remove at ${n(380)},${n(18)} size ${n(80)},${n(80)} "×" tooltip "Delete save" action remove if slot.removable
${back(n)}`,

    history: `screen history:
${dim('.62')}${title('History', fade)}  text at ${n(60)},${n(220)} "Nothing yet." font ${n(44)} if total == 0
  scroll at ${n(60)},${listTop} size ${inner},${listH} start bottom${slide}:
    each lines as ln step 0,${n(230)}:
      text at 0,0 "[ln.name]" font ${n(34)} width ${n(840)} lines 1 color [ln.color] if ln.name != ""
      button ln at 0,${n(46)} size ${n(840)},${n(170)} "[ln.text]" font ${n(38)} action line
      button ln.voice at ${n(852)},${n(46)} size ${n(108)},${n(170)} "♪" tooltip "Hear this line" action voice if ln.voiced
${back(n)}`,

    gallery: `screen gallery:
${dim('.72')}${title('Gallery', fade)}${count()}  scroll at ${n(60)},${listTop} size ${inner},${listH}${slide}:
    grid 2 gap ${n(20)} cell ${gridCell}:
      each tiles as t on enter fade 0.3s stagger 0.03s on exit fade 0.15s:
        panel size ${gridCell} color rgba(0,0,0,0):
          button t at 0,0 size ${gridCell} " " action tile enabled t.unlocked
          image "[t.file]" at ${n(10)},${n(10)} size ${n(450)},${n(253)} if t.unlocked
          text at 0,${n(90)} "?" font ${n(100)} width ${n(470)} align center color #6b7385 if not t.unlocked
          text at ${n(14)},${n(264)} "[t.title]" font ${n(30)} width ${n(440)} lines 1
${back(n)}`,

    // The picture fills the stage, as in the landscape viewer: a portrait game's gallery art is portrait art.
    viewer: `screen viewer:
  panel size full color #000
  image "[file]" at 0,0 size ${W},${H} on enter fade 0.3s on exit fade 0.2s
  hotspot shut at 0,0 size ${W},${H} "Close" hover none tooltip off action close
  text at ${n(40)},${n(40)} "[title]  [position] / [total]" font ${n(36)} width ${W - 2 * n(40)} lines 2
  button prev at ${n(40)},${H - n(150)} size ${n(200)},${n(110)} "<" tooltip "Previous picture" action prev if total > 1
  button done at ${Math.round((W - n(200)) / 2)},${H - n(150)} size ${n(200)},${n(110)} "Back" action close
  button next at ${W - n(240)},${H - n(150)} size ${n(200)},${n(110)} ">" tooltip "Next picture" action next if total > 1
`,

    music: `screen music:
${dim('.72')}${title('Music', fade)}${count()}  text at ${n(60)},${n(170)} "♪ [now]" font ${n(36)} width ${inner} lines 1 color #aab0be if now != ""
  scroll at ${n(60)},${n(250)} size ${inner},${Math.max(n(200), H - n(250) - n(250))}${slide}:
    column gap ${n(12)}:
      each tracks as t on enter slide right 0.25s distance=40 stagger 0.03s on exit fade 0.15s:
        panel size ${inner},${n(110)} color rgba(0,0,0,0):
          button t at 0,0 size ${inner},${n(110)} "[t.title]" action track enabled t.unlocked
          text at ${n(24)},${n(28)} "♪" font ${n(44)} if t.playing
  row anchor bottom margin 0,0,${n(100)},0 gap ${n(20)}:
    button stop size ${n(300)},${n(120)} "Stop" action stop
    button done size ${n(300)},${n(120)} "Back" action close
`,

    chapters: `screen chapters:
${dim('.72')}${title('Chapters', fade)}${count()}  scroll at ${n(60)},${listTop} size ${inner},${listH}${slide}:
    column gap ${n(12)}:
      each chapters as c on enter slide right 0.25s distance=40 stagger 0.03s on exit fade 0.15s:
        button c size ${inner},${n(110)} "[c.title]" action chapter enabled c.unlocked
${back(n)}`,

    achievements: `screen achievements:
${dim('.72')}${title('Achievements', fade)}${count(' if total > 0 and endings_total == 0')}  scroll at ${n(60)},${listTop} size ${inner},${listH}${slide}:
    column gap ${n(16)}:
      text "Endings  [endings_count] / [endings_total]" font ${n(36)} color #aab0be if endings_total > 0
      each endings as e on enter fade 0.25s stagger 0.03s:
        panel size ${inner},${n(150)} color rgba(0,0,0,0):
          image "[e.icon]" at 0,${n(25)} size ${n(100)},${n(100)} if e.icon != ""
          text at ${n(124)},${n(10)} "[e.title]" font ${n(40)} width ${inner - n(124)} lines 1 if e.unlocked
          text at ${n(124)},${n(10)} "[e.title]" font ${n(40)} width ${inner - n(124)} lines 1 color #6b7385 if not e.unlocked
          text at ${n(124)},${n(66)} "[e.description]" font ${n(30)} width ${inner - n(124)} lines 2 color #aab0be
      text "Achievements  [count] / [total]" font ${n(36)} color #aab0be if total > 0 and endings_total > 0
      each achievements as a on enter fade 0.25s stagger 0.03s:
        panel size ${inner},${n(150)} color rgba(0,0,0,0):
          image "[a.icon]" at 0,${n(25)} size ${n(100)},${n(100)} if a.icon != ""
          text at ${n(124)},${n(10)} "[a.title]" font ${n(40)} width ${inner - n(124)} lines 1 if a.unlocked
          text at ${n(124)},${n(10)} "[a.title]" font ${n(40)} width ${inner - n(124)} lines 1 color #6b7385 if not a.unlocked
          text at ${n(124)},${n(66)} "[a.description]" font ${n(30)} width ${inner - n(124)} lines 2 color #aab0be
${back(n)}`,

    achievement_toast: `screen achievement_toast:
  row anchor [position] margin ${n(40)} on enter slide down 0.3s distance=20 on exit fade 0.25s:
    panel size ${W - 2 * n(40)},${n(170)}:
      row at ${n(24)},${n(24)} gap ${n(22)}:
        image "[icon]" size ${n(110)},${n(110)} if icon != ""
        column gap ${n(4)}:
          text "Achievement unlocked" font ${n(30)} color #8fd3ff width ${n(780)} if not ending
          text "Ending reached" font ${n(30)} color #8fd3ff width ${n(780)} if ending
          text "[title]" font ${n(40)} width ${n(780)} lines 1
          text "[description]" font ${n(30)} color #c9ced8 width ${n(780)} lines 1
`,
  };
}
