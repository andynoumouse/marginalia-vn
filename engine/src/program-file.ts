// The compiled program as shipped in an export: `vn export` compiles once and the game loads the result instead of the .vn text.

import type { Program } from './types.js';

/** Bump when Program, Op or Expr change shape: a game built by an older engine is refused instead of misplayed. */
export const PROGRAM_FORMAT = 1;

export interface ProgramFile {
  format: number;
  /** hashText of the source scripts: what saves record to tell script versions apart. */
  version: string;
  program: Program;
}

/** Short stable hash (FNV-1a) for telling script versions apart. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

export const scriptsVersion = (scripts: { file: string; text: string }[]) => hashText(scripts.map(s => `${s.file}\n${s.text}`).join('\0'));

/**
 * The program without its diagnostics (the export refuses errors, and warnings mean nothing to players) and without `strings`:
 * the ops carry their own text and the runtime never reads that second copy (translation tooling uses the editor's compile).
 * Stays plain JSON.
 */
export function packProgram(program: Program, version: string): ProgramFile {
  return { format: PROGRAM_FORMAT, version, program: { ...program, diagnostics: [], strings: {} } };
}

/** Checks a loaded `program` entry of project.json; throws a readable message when it is not a program this engine can play. */
export function unpackProgram(data: unknown): ProgramFile {
  const f = data as Partial<ProgramFile> | null;
  if (!f || typeof f !== 'object' || typeof f.format !== 'number') throw new Error('project.json has no compiled program');
  if (f.format !== PROGRAM_FORMAT) throw new Error(`The compiled program is format ${f.format}, this engine plays format ${PROGRAM_FORMAT}: export the game again`);
  const p = f.program;
  if (!p || !Array.isArray(p.ops) || typeof p.labels !== 'object' || typeof f.version !== 'string') throw new Error('The compiled program is damaged: export the game again');
  return f as ProgramFile;
}
