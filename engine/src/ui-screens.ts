import { CHAPTERS_SCREEN, GALLERY_SCREEN, HISTORY_SCREEN, MUSIC_SCREEN, OPTIONS_SCREEN, PAUSE_SCREEN, QUICKMENU_SCREEN, SAVES_SCREEN, TITLE_SCREEN, VIEWER_SCREEN } from './screens.js';

/** One of the shell's built-in menus that a project can replace by declaring a `screen` of the same name. */
export interface UiScreen {
  name: string;
  /** Where the editor creates the override. */
  file: string;
  title: string;
  /** What the author gets when the menu is overridden: a working screen with the stock buttons, to restyle. */
  starter: string;
}

const BACK = '  button done at 1500,960 "Back" action close\n';

const STARTERS: Record<string, string> = {
  [TITLE_SCREEN]: `screen title:
  column anchor center gap 16:
    button go "New game" action start
    button more "Continue" action continue
    button load "Load" action load
    button gallery "Gallery" action gallery
    button music "Music" action music
    button chapters "Chapters" action chapters
    button opt "Options" action options
`,
  [PAUSE_SCREEN]: `screen pause:
  column anchor center gap 16:
    button back "Resume" action resume
    button sv "Save" action save
    button ld "Load" action load
    button opt "Options" action options
    button menu "Main menu" action title
`,
  [QUICKMENU_SCREEN]: `screen quickmenu:
  row anchor bottomright margin 24 gap 12:
    button back "Back" action back
    button hist "History" action history
    button auto "Auto" action auto
    button skip "Skip" action skip
    button qs "Q.Save" action qsave
    button ql "Q.Load" action qload
    button sv "Save" action save
    button ld "Load" action load
    button opt "Options" action options
    button hide "Hide" action hide
`,
  [OPTIONS_SCREEN]: `screen options:
  row anchor top margin 60 gap 20:
    button audio "Audio" action tab
    button text "Text" action tab
    button game "Game" action tab
    button done "Back" action close
  slider master at 700,300 readout if tab == "audio"
  slider music at 700,380 readout if tab == "audio"
  slider sound at 700,460 readout if tab == "audio"
  slider text_speed at 700,300 readout if tab == "text"
  slider text_size at 700,380 readout if tab == "text"
  slider box_opacity at 700,460 readout if tab == "text"
  button text_sounds at 700,300 "Text sounds: [text_sounds]" action cycle if tab == "game"
  button auto_speed at 700,380 "Auto: [auto_speed]" action cycle if tab == "game"
  button skip at 700,460 "Skip: [skip]" action cycle if tab == "game"
  button reduce_motion at 700,540 "Reduce motion: [reduce_motion]" action cycle if tab == "game"
  button captions at 700,620 "Captions: [captions]" action cycle if tab == "game"
  button timed_choices at 700,700 "Timed choices: [timed_choices]" action cycle if tab == "game"
  button language at 700,780 "Language: [language]" action cycle if tab == "game"
  button full at 700,860 "Fullscreen" action fullscreen if tab == "game"
`,
  [SAVES_SCREEN]: `screen saves:
  each pages as pg at 100,50 step 140,0:
    button pg at 0,0 "[pg.name]" action page
  each slots as slot at 100,200 step 0,110:
    button slot at 0,0 size 1100,96 "[slot.title]  [slot.when]  [slot.text]" action slot enabled mode == "save" or not slot.empty
  button del at 1400,200 "Delete" action delete if mode == "save"
${BACK}`,
  [HISTORY_SCREEN]: `screen history:
  scroll at 160,140 size 1500,760 start bottom:
    each lines as ln step 0,120:
      text at 0,0 "[ln.name]" if ln.name != ""
      text at 0,44 "[ln.text]"
${BACK}`,
  [GALLERY_SCREEN]: `screen gallery:
  scroll at 160,160 size 1600,700:
    grid 4 gap 24:
      each tiles as t:
        button t size 360,240 "[t.title]" action tile enabled t.unlocked
  text at 160,60 "[count] / [total]"
${BACK}`,
  [VIEWER_SCREEN]: `screen viewer:
  image "[file]" at 0,0 size 1920,1080
  text at 80,40 "[title]  [position] / [total]"
  button prev at 80,960 "<" action prev if total > 1
  button next at 1700,960 ">" action next if total > 1
${BACK}`,
  [MUSIC_SCREEN]: `screen music:
  scroll at 160,160 size 1600,700:
    column gap 12:
      each tracks as t:
        button t size 1000,72 "[t.title]" action track enabled t.unlocked
  text at 160,60 "[count] / [total]"
  button stop at 1300,960 "Stop" action stop
${BACK}`,
  [CHAPTERS_SCREEN]: `screen chapters:
  scroll at 160,160 size 1600,700:
    column gap 12:
      each chapters as c:
        button c size 1000,72 "[c.title]" action chapter enabled c.unlocked
${BACK}`,
};

const TITLES: Record<string, string> = {
  [TITLE_SCREEN]: 'Title screen', [PAUSE_SCREEN]: 'Pause menu', [QUICKMENU_SCREEN]: 'Quick menu', [OPTIONS_SCREEN]: 'Options',
  [SAVES_SCREEN]: 'Save and load', [HISTORY_SCREEN]: 'History', [GALLERY_SCREEN]: 'Gallery', [VIEWER_SCREEN]: 'Gallery viewer',
  [MUSIC_SCREEN]: 'Music room', [CHAPTERS_SCREEN]: 'Chapter select',
};

/** Every replaceable built-in menu, in the order the Files panel lists them. */
export const UI_SCREENS: readonly UiScreen[] = Object.keys(TITLES).map(name => ({ name, file: `ui/${name}.vn`, title: TITLES[name], starter: STARTERS[name] }));

/**
 * The script file that declares each built-in screen the project overrides (name to file). A built-in with no entry is still the stock one;
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
