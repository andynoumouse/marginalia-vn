// The project's stage size in pixels, shared by the renderer and the DOM layers. It starts at the default and is set
// once, from game.json, before anything is drawn (a changed size reloads the page). `W` and `H` are live bindings.

import { DEFAULT_STAGE, type StageSize } from '../engine/src/index.js';

export let W: number = DEFAULT_STAGE.width;
export let H: number = DEFAULT_STAGE.height;

/** Sets the size and the CSS box of #stage (index.html reads --stage-w and --stage-h). */
export function setStageSize(s: StageSize) {
  W = s.width;
  H = s.height;
  document.documentElement.style.setProperty('--stage-w', `${W}px`);
  document.documentElement.style.setProperty('--stage-h', `${H}px`);
}
