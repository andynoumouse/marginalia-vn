// The chapter select list and the warnings for chapters game.json names but no script defines.

import { chapterItems, chapterProblems, type ChapterItem, type Diagnostic } from '../engine/src/index.js';

export function chapterList(chapters: unknown, reached: (label: string) => boolean, unlocked: (flag: string) => boolean): ChapterItem[] {
  return chapterItems(chapters, reached, unlocked);
}

/** Warnings for chapters whose label no script defines, pointed at the line of game.json that names it. */
export function chapterDiagnostics(chapters: unknown, labels: Record<string, number>, text: string): Diagnostic[] {
  const lines = text.split('\n');
  return chapterProblems(chapters, labels).map(message => {
    const label = /"(.*)"/.exec(message)?.[1] ?? '';
    return { file: 'game.json', line: Math.max(1, lines.findIndex(l => l.includes(`"${label}"`)) + 1), severity: 'warning', message } as Diagnostic;
  });
}
