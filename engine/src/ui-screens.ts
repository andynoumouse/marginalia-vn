import { ACHIEVEMENT_TOAST_SCREEN, ACHIEVEMENTS_SCREEN, CHAPTERS_SCREEN, GALLERY_SCREEN, HISTORY_SCREEN, MUSIC_SCREEN, OPTIONS_SCREEN, PAUSE_SCREEN, QUICKMENU_SCREEN, SAVES_SCREEN, TITLE_SCREEN, VIEWER_SCREEN } from './screens.js';

/** One of the shell's built-in menus that a project can replace by declaring a `screen` of the same name. */
export interface UiScreen {
  name: string;
  /** Where the editor creates the override. */
  file: string;
  title: string;
  /** The default screen's code, which is also what the editor's Edit button copies into the project. */
  starter: string;
}

/** The Back button of a list screen: bottom right, in line with the 160px content margin. `BACK_AT` is a fixed spot, for the viewer whose arrows sit beside it. */
const BACK = '  row anchor bottomright margin 0,160,56,0 gap 20:\n    button done size 200,64 "Back" action close\n';
const BACK_AT = '  button done at 1500,960 "Back" action close\n';

const STARTERS: Record<string, string> = {
  [TITLE_SCREEN]: `screen title:
  text at 0,60 "[game_title]" style=title font 100 width full align center on enter fade 0.6 on exit fade 0.2 if show_title
  column anchor bottom margin 0,0,60,0 gap 12 align stretch width 420 on enter slide up 0.35 distance=30 on exit fade 0.2:
    button go "New game" action start
    button more "Continue" sub "[continue_text]" action continue
    button load "Load" action load
    button gallery "Gallery" action gallery if has_gallery
    button music "Music" action music if has_music
    button chapters "Chapters" action chapters if has_chapters
    button achievements "Achievements" action achievements if has_achievements
    button opt "Options" action options
`,
  [PAUSE_SCREEN]: `screen pause:
  panel size full color rgba(4,6,10,.62) on enter fade 0.2 on exit fade 0.15
  column anchor center gap 12 align stretch width 420 on enter slide up 0.3 distance=30 on exit fade 0.15:
    button back "Resume" action resume
    button sv "Save" action save
    button ld "Load" action load
    button opt "Options" action options
    button menu "Main menu" action title
`,
  [QUICKMENU_SCREEN]: `screen quickmenu:
  row anchor [quick_place] margin 14,160,10,160 gap 6:
    each quick_items as q:
      button q "[q.label]" font 24 tooltip "[q.hint]" action [q]
`,
  [OPTIONS_SCREEN]: `screen options:
  panel size full color rgba(4,6,10,.62) on enter fade 0.2 on exit fade 0.15
  panel at 240,90 size 1440,900 on enter fade 0.25 on exit fade 0.15
  text at 300,120 "Options" font 52 on enter slide down 0.3 distance=30 on exit fade 0.15
  panel at 300,273 size 1320,2 color rgba(255,255,255,.25) on enter fade 0.25 on exit fade 0.15
  row at 300,210 gap 8 on enter slide down 0.3 distance=30 on exit fade 0.15:
    button audio size 240,64 "Audio" action tab
    button game size 240,64 "Game" action tab
    button access size 360,64 "Accessibility" action tab
  grid 2 at 300,310 gap 12 cell 620,60 align stretch if tab == "audio" on enter fade 0.25:
    text "Master volume" font 34
    slider master size 520,48 readout
    text "Music" font 34
    slider music size 520,48 readout
    text "Sound" font 34
    slider sound size 520,48 readout
    text "Voice" font 34
    slider voice size 520,48 readout
    text "Text sounds" font 34
    button text_sounds "[text_sounds_word]" action cycle
  grid 2 at 300,310 gap 12 cell 620,60 align stretch if tab == "game" on enter fade 0.25:
    text "Text speed" font 34
    slider text_speed size 520,48 readout
    text "Auto speed" font 34
    select auto_speed
    text "Skip" font 34
    select skip
    text "Dim who is not speaking" font 34 if speaker_focus != "none"
    button speaker_focus "[speaker_focus_word]" action cycle if speaker_focus != "none"
    text "Language" font 34 if has_languages
    select language if has_languages
    text "Theme" font 34 if has_themes
    select theme if has_themes
    text "Voice language" font 34 if has_voice_languages
    select voice_language if has_voice_languages
  grid 2 at 300,310 gap 12 cell 620,60 align stretch if tab == "access" on enter fade 0.25:
    text "Text size" font 34
    slider text_size size 520,48 readout
    text "Text box opacity" font 34
    slider box_opacity size 520,48 readout
    text "Reduce motion" font 34
    button reduce_motion "[reduce_motion_word]" action cycle
    text "Sound captions" font 34
    button captions "[captions_word]" action cycle
    text "Screen reader reads dialogue" font 34
    button announce_lines "[announce_lines_word]" action cycle
    text "Timed choices" font 34
    select timed_choices
  row at 300,870 gap 20 on enter slide up 0.3 distance=30 on exit fade 0.15:
    button full size 300,64 "Fullscreen" action fullscreen if has_fullscreen
    button done size 240,64 "Back" action close
`,
  [SAVES_SCREEN]: `screen saves:
  panel size full color rgba(4,6,10,.62) on enter fade 0.2 on exit fade 0.15
  panel at 110,40 size 1700,1000 on enter fade 0.25 on exit fade 0.15
  text at 170,60 "Save" font 52 if mode == "save" on enter slide down 0.3 distance=30 on exit fade 0.15
  text at 170,60 "Load" font 52 if mode == "load" on enter slide down 0.3 distance=30 on exit fade 0.15
  text at 520,80 "[note]" font 28 color #e8706a if note != ""
  each pages as pg at 170,150 step 76,0 on enter fade 0.3 stagger 0.02 on exit fade 0.15:
    button pg at 0,0 size 64,56 "[pg.name]" action page
    panel at 0,0 size 64,56 color rgba(255,255,255,.18) if pg == page
  button done at 1550,56 size 200,64 "Back" action close on enter fade 0.3 on exit fade 0.15
  grid 3 at 170,230 gap 24 cell 500,360:
    each slots as slot on enter slide up 0.25 distance=30 stagger 0.04 on exit fade 0.15:
      panel size 500,360 color rgba(0,0,0,0):
        button slot at 0,0 size 500,360 " " action slot enabled mode == "save" or not slot.empty
        image "[slot.thumb]" at 10,10 size 480,270 if slot.thumb != ""
        panel at 10,10 size 480,270 color rgba(0,0,0,.4) if slot.thumb == ""
        text at 10,120 "[slot.text]" font 32 width 480 align center color #6b7385 if slot.empty
        text at 14,284 "[slot.heading]" font 28 width 300 lines 1
        text at 300,288 "[slot.when]" font 24 width 186 align right color #aab0be
        text at 14,322 "[slot.text]" font 24 width 470 lines 1 color #c9ced8 if not slot.empty
        button slot.rename at 380,16 size 48,48 "✎" action rename if can_rename and slot.renamable
        button slot.remove at 436,16 size 48,48 "×" action remove if slot.removable
`,
  [HISTORY_SCREEN]: `screen history:
  panel size full color rgba(4,6,10,.62) on enter fade 0.2 on exit fade 0.15
  text at 160,50 "History" font 52 on enter fade 0.3 on exit fade 0.15
  text at 160,170 "Nothing yet." if total == 0
  scroll at 160,140 size 1600,760 start bottom on enter slide up 0.3 distance=30 on exit fade 0.15:
    each lines as ln step 0,140:
      text at 0,0 "[ln.name]" font 26 color [ln.color] if ln.name != ""
      button ln at 0,40 size 1500,84 "[ln.text]" action line
      button ln.voice at 1512,40 size 68,84 "♪" action voice if ln.voiced
${BACK}`,
  [GALLERY_SCREEN]: `screen gallery:
  panel size full color rgba(4,6,10,.72) on enter fade 0.2 on exit fade 0.15
  text at 160,50 "Gallery" font 52 on enter fade 0.3 on exit fade 0.15
  text at 160,70 "[count] / [total]" font 32 width 1600 align right color #aab0be
  scroll at 160,160 size 1600,740 on enter slide up 0.3 distance=30 on exit fade 0.15:
    grid 4 gap 20 cell 380,250:
      each tiles as t on enter fade 0.3 stagger 0.03 on exit fade 0.15:
        panel size 380,250 color rgba(0,0,0,0):
          button t at 0,0 size 380,250 " " action tile enabled t.unlocked
          image "[t.file]" at 10,10 size 360,203 if t.unlocked
          text at 0,60 "?" font 80 width 380 align center color #6b7385 if not t.unlocked
          text at 14,214 "[t.title]" font 26
${BACK}`,
  [VIEWER_SCREEN]: `screen viewer:
  panel size full color #000
  image "[file]" at 0,0 size 1920,1080 on enter fade 0.3 on exit fade 0.2
  hotspot shut at 0,0 size 1920,1080 "Close" hover none tooltip off action close
  text at 80,40 "[title]  [position] / [total]"
  button prev at 80,960 "<" action prev if total > 1
  button next at 1700,960 ">" action next if total > 1
${BACK_AT}`,
  [MUSIC_SCREEN]: `screen music:
  panel size full color rgba(4,6,10,.72) on enter fade 0.2 on exit fade 0.15
  text at 160,50 "Music" font 52 on enter fade 0.3 on exit fade 0.15
  text at 160,70 "[count] / [total]" font 32 width 1600 align right color #aab0be
  text at 160,125 "♪ [now]" font 30 color #aab0be if now != ""
  scroll at 160,180 size 1600,720 on enter slide up 0.3 distance=30 on exit fade 0.15:
    column gap 12:
      each tracks as t on enter slide right 0.25 distance=40 stagger 0.03 on exit fade 0.15:
        panel size 1000,72 color rgba(0,0,0,0):
          button t at 0,0 size 1000,72 "[t.title]" action track enabled t.unlocked
          text at 24,14 "♪" font 36 if t.playing
  row anchor bottomright margin 0,160,56,0 gap 20:
    button stop size 200,64 "Stop" action stop
    button done size 200,64 "Back" action close
`,
  [CHAPTERS_SCREEN]: `screen chapters:
  panel size full color rgba(4,6,10,.72) on enter fade 0.2 on exit fade 0.15
  text at 160,50 "Chapters" font 52 on enter fade 0.3 on exit fade 0.15
  text at 160,70 "[count] / [total]" font 32 width 1600 align right color #aab0be
  scroll at 160,160 size 1600,740 on enter slide up 0.3 distance=30 on exit fade 0.15:
    column gap 12:
      each chapters as c on enter slide right 0.25 distance=40 stagger 0.03 on exit fade 0.15:
        button c size 1000,72 "[c.title]" action chapter enabled c.unlocked
${BACK}`,
  [ACHIEVEMENTS_SCREEN]: `screen achievements:
  panel size full color rgba(4,6,10,.72) on enter fade 0.2 on exit fade 0.15
  text at 160,50 "Achievements" font 52 on enter fade 0.3 on exit fade 0.15
  text at 160,70 "[count] / [total]" font 32 width 1600 align right color #aab0be if total > 0 and endings_total == 0
  scroll at 160,160 size 1600,740 on enter slide up 0.3 distance=30 on exit fade 0.15:
    column gap 16:
      text "Endings  [endings_count] / [endings_total]" font 28 color #aab0be if endings_total > 0
      each endings as e on enter fade 0.25 stagger 0.03:
        panel size 1580,92 color rgba(0,0,0,0):
          image "[e.icon]" at 0,6 size 80,80 if e.icon != ""
          text at 104,4 "[e.title]" font 32 if e.unlocked
          text at 104,4 "[e.title]" font 32 color #6b7385 if not e.unlocked
          text at 104,48 "[e.description]" font 24 color #aab0be
      text "Achievements  [count] / [total]" font 28 color #aab0be if total > 0 and endings_total > 0
      each achievements as a on enter fade 0.25 stagger 0.03:
        panel size 1580,92 color rgba(0,0,0,0):
          image "[a.icon]" at 0,6 size 80,80 if a.icon != ""
          text at 104,4 "[a.title]" font 32 if a.unlocked
          text at 104,4 "[a.title]" font 32 color #6b7385 if not a.unlocked
          text at 104,48 "[a.description]" font 24 color #aab0be
${BACK}`,
  [ACHIEVEMENT_TOAST_SCREEN]: `screen achievement_toast:
  row anchor [position] margin 40 on enter slide down 0.3 distance=20 on exit fade 0.25:
    panel size 700,140:
      row at 24,22 gap 22:
        image "[icon]" size 96,96 if icon != ""
        column gap 4:
          text "Achievement unlocked" font 22 color #8fd3ff width 540 if not ending
          text "Ending reached" font 22 color #8fd3ff width 540 if ending
          text "[title]" font 32 width 540 lines 1
          text "[description]" font 24 color #c9ced8 width 540 lines 1
`,
};

const TITLES: Record<string, string> = {
  [TITLE_SCREEN]: 'Title screen', [PAUSE_SCREEN]: 'Pause menu', [QUICKMENU_SCREEN]: 'Quick menu', [OPTIONS_SCREEN]: 'Options',
  [SAVES_SCREEN]: 'Save and load', [HISTORY_SCREEN]: 'History', [GALLERY_SCREEN]: 'Gallery', [VIEWER_SCREEN]: 'Gallery viewer',
  [MUSIC_SCREEN]: 'Music room', [CHAPTERS_SCREEN]: 'Chapter select',
  [ACHIEVEMENTS_SCREEN]: 'Achievements', [ACHIEVEMENT_TOAST_SCREEN]: 'Achievement toast',
};

/**
 * The built-in screens drawn from their starter when the project declares none (every name of `UI_SCREENS`), compiled as virtual files after the project's own.
 */
export function defaultScreenFiles(files: { file: string; text: string }[]): { file: string; text: string }[] {
  const own = overriddenScreens(files);
  return [TITLE_SCREEN, PAUSE_SCREEN, QUICKMENU_SCREEN, OPTIONS_SCREEN, SAVES_SCREEN, HISTORY_SCREEN, VIEWER_SCREEN, GALLERY_SCREEN, MUSIC_SCREEN, CHAPTERS_SCREEN, ACHIEVEMENTS_SCREEN, ACHIEVEMENT_TOAST_SCREEN].filter(n => !(n in own)).map(n => ({ file: `stock/${n}.vn`, text: STARTERS[n] }));
}

/** Every replaceable built-in menu, in the order the Files panel lists them. */
export const UI_SCREENS: readonly UiScreen[] = Object.keys(TITLES).map(name => ({ name, file: `ui/${name}.vn`, title: TITLES[name], starter: STARTERS[name] }));

/**
 * The script file that declares each built-in screen the project overrides (name to file). A built-in with no entry is still the default one;
 * deleting the declaring file (or the screen) falls back to it.
 */
export function overriddenScreens(files: { file: string; text: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    for (const m of f.text.matchAll(/^screen[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:?[ \t]*$/gm)) {
      if (UI_SCREENS.some(u => u.name === m[1]) && !(m[1] in out)) out[m[1]] = f.file;
    }
  }
  return out;
}
