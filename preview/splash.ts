// The splash sequence: logo cards on black before the title screen. Click, Enter, Space or Esc skips the card
// on screen; with reduced motion the cards are cut instead of faded.

import type { SplashCard } from '../engine/src/index.js';
import { $, sleep } from './stage-ui.js';

const splashEl = $('splash'), splashImg = $('splashImg'), splashText = $('splashText');
let running = false;

/** Resolves when the last card is gone. `urlOf` maps a background name to a URL (null = no such file, text only). */
export async function playSplash(cards: SplashCard[], urlOf: (name: string) => string | null, reduceMotion: boolean): Promise<void> {
  if (running || !cards.length) return;
  running = true;
  let skip: (() => void) | null = null;
  const onKey = (e: KeyboardEvent) => {
    if (!['Enter', ' ', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // not an input for the game shell underneath
    skip?.();
  };
  const onClick = (e: Event) => { e.stopPropagation(); skip?.(); };
  window.addEventListener('keydown', onKey, true);
  splashEl.addEventListener('click', onClick);
  splashEl.hidden = false;
  try {
    for (const card of cards) {
      const url = card.image ? urlOf(card.image) : null;
      if (url) await new Promise<void>(r => { const i = new Image(); i.onload = i.onerror = () => r(); i.src = url; }); // decoded before it fades in
      splashImg.style.backgroundImage = url ? `url("${url}")` : '';
      splashImg.hidden = !url;
      splashText.textContent = card.text;
      const fade = reduceMotion ? 0 : card.fade * 1000;
      splashEl.style.setProperty('--splash-fade', `${fade}ms`);
      const skipped = new Promise<void>(r => { skip = r; });
      splashEl.dataset.show = 'true';
      await Promise.race([sleep(fade + card.duration * 1000), skipped]);
      splashEl.dataset.show = 'false';
      await sleep(fade);
      skip = null;
    }
  } finally {
    splashEl.hidden = true;
    splashEl.dataset.show = 'false';
    window.removeEventListener('keydown', onKey, true);
    splashEl.removeEventListener('click', onClick);
    running = false;
  }
}
