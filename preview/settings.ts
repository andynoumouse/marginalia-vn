// Player settings, kept in browser storage (per game, see storage.ts).

import { getItem, setItem } from './storage.js';

export interface Settings {
  master: number;    // volumes 0..1
  music: number;
  sound: number;
  voice: number;
  textSpeed: number; // characters per second; TEXT_INSTANT and up = no typing effect
  autoDelay: number; // auto-advance: seconds to wait after a line (auto itself is toggled in game)
  skipAll: boolean;  // skip also unread text
  textSounds: boolean; // character blips while text types
  textSize: number;  // text size multiplier (accessibility)
  boxOpacity: number; // 0.3..1, how solid the text box background is
  reduceMotion: boolean; // no shake, hop, flash, wipes or animated text; the camera snaps
  captions: boolean; // show a caption such as [door slams] when a sound effect plays
  announceLines: boolean; // tell screen readers each dialogue line once it is shown in full
  speakerFocus: boolean; // dim the characters who are not speaking, when the game has game.json "speakerFocus"
  timedChoices: 'normal' | 'extended' | 'off'; // the clock of a timed menu: as written, three times as long, or none (the story's "on timeout" never runs)
  lang: string;
  theme: string; // one of game.json "themes"; '' is the game's own theme
  voiceLang: string; // the language to hear voices in; '' follows the text language
}

export const TEXT_INSTANT = 100;
const KEY = 'settings';
/** The player's system-wide wish, used until they choose in the options. */
const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const defaults = (): Settings => ({ master: 0.8, music: 0.7, sound: 0.8, voice: 0.9, textSpeed: 45, autoDelay: 1.5, skipAll: false, textSounds: true, textSize: 1, boxOpacity: 1, reduceMotion: prefersReducedMotion(), captions: false, announceLines: true, speakerFocus: true, timedChoices: 'normal', lang: 'en', theme: '', voiceLang: '' });

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(getItem(KEY) ?? '{}') as Partial<Settings>;
    if (!stored.autoDelay) delete stored.autoDelay; // 0 used to mean "off"; now auto is a toggle
    return { ...defaults(), ...stored };
  } catch {
    return defaults();
  }
}

export function saveSettings(s: Settings) {
  setItem(KEY, JSON.stringify(s)); // may fail (storage unavailable): then settings last for this session
}
