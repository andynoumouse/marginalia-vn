// The report an exported game's error screen offers to copy when the story stops on an error: enough for the author to
// find the line (engine and game version, file:line, the error, the last lines shown) without asking the player for more.

import type { Src } from './types.js';

export interface CrashInfo {
  error: unknown;
  /** The script line the story was on, if it had reached one. */
  at: Src | null;
  /** The engine version the game was exported with. */
  engine?: string;
  game?: string;
  gameVersion?: string;
  /** The last lines shown, oldest first ("Name: text", or the text alone for narration). */
  lines?: string[];
  /** navigator.userAgent. */
  agent?: string;
  time?: Date;
}

/** How many of the last lines and stack frames a report keeps. */
export const CRASH_LINES = 5;
export const CRASH_FRAMES = 8;

/** One line for the player: the error's message ("TypeError: x is undefined"; a plain Error shows only its message). */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || '(no message)';
    return error.name && error.name !== 'Error' ? `${error.name}: ${message}` : message;
  }
  if (typeof error === 'string') return error || '(no message)';
  try { return JSON.stringify(error) ?? String(error); } catch { return String(error); }
}

/** The plain-text report: a header of facts, then the last lines and the start of the stack. */
export function crashReport(info: CrashInfo): string {
  const game = [info.game || 'Untitled', info.gameVersion].filter(Boolean).join(' ');
  const out = [
    `Game: ${game}`,
    `Engine: Marginalia ${info.engine || 'unknown'}`,
    `Where: ${info.at ? `${info.at.file}:${info.at.line}` : 'before the first line'}`,
    `Error: ${errorText(info.error)}`,
  ];
  if (info.agent) out.push(`Browser: ${info.agent}`);
  if (info.time) out.push(`Time: ${info.time.toISOString()}`);
  const lines = (info.lines ?? []).slice(-CRASH_LINES);
  if (lines.length) out.push('', 'Last lines:', ...lines.map(l => `  ${l.replace(/\s+/g, ' ').trim()}`));
  const stack = info.error instanceof Error && info.error.stack
    ? info.error.stack.split('\n').map(l => l.trim()).filter(l => l.startsWith('at ') || l.includes('@')).slice(0, CRASH_FRAMES)
    : [];
  if (stack.length) out.push('', 'Stack:', ...stack.map(l => `  ${l}`));
  return out.join('\n');
}
