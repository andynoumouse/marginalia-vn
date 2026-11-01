// Text sounds ("blips"): short sounds while a line types, per character (`define alice ... blip=high`).
// A blip name is looked up in game.json "blips" (custom voices), then the built-in presets below, then
// assets/sound/<name> (played as a plain sample).
//   mode "letters": one blip per letter (every Nth, at most one per `interval` ms) - the courtroom-game style
//   mode "vowels":  blips only on vowels, each vowel at its own pitch, or its own sample from `vowels`

import type { AudioSystem } from './audio.js';

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';
export interface Voice {
  synth?: OscillatorType;                   // synthesized: "square" | "triangle" | "sine" | "sawtooth"
  pitch?: number;                           // Hz for synth (default 440)
  sound?: string;                           // or a sample: assets/sound/<sound>
  vowels?: Partial<Record<Vowel, string>>;  // samples per vowel (vowel mode)
  mode?: 'letters' | 'vowels';
  every?: number;                           // blip on every Nth letter (default 1)
  interval?: number;                        // minimum ms between blips (default 55)
  variation?: number;                       // random pitch spread in semitones (default 0)
  volume?: number;                          // 0..1 (default 0.25 for synth, 0.8 for samples)
  length?: number;                          // synth blip length in ms (default 45)
}

export const BLIP_PRESETS: Record<string, Voice> = {
  high: { synth: 'square', pitch: 880, variation: 0.5 },
  mid: { synth: 'square', pitch: 520, variation: 0.5 },
  low: { synth: 'triangle', pitch: 220, volume: 0.35, variation: 0.5 },
  soft: { synth: 'sine', pitch: 620, volume: 0.3, length: 60, variation: 1 },
  typewriter: { synth: 'square', pitch: 1800, length: 12, volume: 0.15, variation: 2, every: 1, interval: 40 },
  robot: { synth: 'sawtooth', pitch: 160, volume: 0.18, length: 70, mode: 'vowels' },
};

// Vowel pitch offsets in semitones (vowel mode with one sound or a synth).
const VOWEL_STEP: Record<Vowel, number> = { a: 0, e: 3, i: 7, o: -3, u: -5 };
const semis = (n: number) => 2 ** (n / 12);

/** The vowel in a character, if any ("ä" counts as "a"). */
function vowelOf(ch: string): Vowel | null {
  const base = ch.normalize('NFD')[0].toLowerCase();
  return 'aeiou'.includes(base) ? (base as Vowel) : null;
}

export class Blips {
  /** Custom voices from game.json "blips". */
  voices: Record<string, Voice> = {};
  enabled = true;

  constructor(private audio: AudioSystem) {}

  voice(name: string): Voice | null {
    const v = this.voices[name] ?? BLIP_PRESETS[name];
    if (v) return v;
    return this.audio.has('sound', name) ? { sound: name } : null;
  }

  /** A blip player for one line: call it with each character as it appears. Null when silent. */
  forLine(name: string | undefined): ((ch: string) => void) | null {
    if (!this.enabled || !name || name === 'none') return null;
    const v = this.voice(name);
    if (!v) {
      console.warn(`No blip voice or sound named "${name}" (game.json "blips", a preset, or assets/sound/${name})`);
      return null;
    }
    const every = Math.max(1, Math.round(v.every ?? 1)), interval = v.interval ?? 55;
    let count = 0, last = -Infinity;
    return ch => {
      if (!/\p{L}|\p{N}/u.test(ch)) return; // letters and digits only
      const vowel = vowelOf(ch);
      if (v.mode === 'vowels' && !vowel) return;
      if (count++ % every !== 0) return;
      const now = performance.now();
      if (now - last < interval) return;
      last = now;
      const step = (v.mode === 'vowels' && vowel ? VOWEL_STEP[vowel] : 0) + (Math.random() * 2 - 1) * (v.variation ?? 0);
      const sample = (vowel && v.vowels?.[vowel]) || v.sound;
      if (sample) {
        // A dedicated vowel sample plays as recorded; one shared sample is pitched per vowel.
        const rate = vowel && v.vowels?.[vowel] ? semis((Math.random() * 2 - 1) * (v.variation ?? 0)) : semis(step);
        void this.audio.sound(sample, v.volume ?? 0.8, rate);
      } else {
        this.audio.tone(v.synth ?? 'square', (v.pitch ?? 440) * semis(step), (v.length ?? 45) / 1000, v.volume ?? 0.25);
      }
    };
  }
}
