// Memory accounting for loaded assets: estimated sizes, the budget from game.json, and the text of the debug
// console's `memory` command. Pure, so it is testable in node; preview/ feeds it what is actually resident.

export type ResidentKind = 'image' | 'audio';
export interface Resident { key: string; kind: ResidentKind; bytes: number }

export const DEFAULT_BUDGET_MB = 512;
/** Budget when the device reports little memory (navigator.deviceMemory, in GB, is at most this). */
export const LOW_MEMORY_GB = 2;
export const LOW_MEMORY_BUDGET_MB = 256;

/** A decoded image: 4 bytes a pixel on the GPU (mipmaps and padding not counted). */
export function imageBytes(width: number, height: number): number {
  return Math.round(Math.max(0, width) * Math.max(0, height) * 4);
}

/** Decoded audio: 32-bit float samples for every channel. */
export function audioBytes(seconds: number, sampleRate: number, channels: number): number {
  return Math.round(Math.max(0, seconds) * Math.max(0, sampleRate) * Math.max(0, channels) * 4);
}

/** The memory budget in bytes: game.json `memoryBudgetMB` when it is a positive number, else a default for the device. */
export function memoryBudget(game: { memoryBudgetMB?: unknown } | null | undefined, deviceMemoryGB?: number): number {
  const set = game?.memoryBudgetMB;
  if (typeof set === 'number' && Number.isFinite(set) && set > 0) return Math.round(set * 1024 * 1024);
  const low = typeof deviceMemoryGB === 'number' && deviceMemoryGB > 0 && deviceMemoryGB <= LOW_MEMORY_GB;
  return (low ? LOW_MEMORY_BUDGET_MB : DEFAULT_BUDGET_MB) * 1024 * 1024;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface ResidencyStats {
  /** Files the story had to wait for when it reached them (should stay 0 when playing straight through). */
  lateLoads: number;
}

/** The lines `memory` prints: totals per kind against the budget, the largest assets, and the late loads. */
export function residencyReport(resident: Resident[], budget: number, stats: ResidencyStats, top = 5): string[] {
  const sum = (kind: ResidentKind) => resident.filter(r => r.kind === kind).reduce((n, r) => n + r.bytes, 0);
  const count = (kind: ResidentKind) => resident.filter(r => r.kind === kind).length;
  const total = sum('image') + sum('audio');
  const lines = [
    `resident ${formatBytes(total)} of ${formatBytes(budget)} budget (${Math.round((total / budget) * 100)}%)${total > budget ? ' - over budget' : ''}`,
    `  images ${formatBytes(sum('image'))} in ${count('image')} files, audio ${formatBytes(sum('audio'))} in ${count('audio')} files`,
    `  late loads ${stats.lateLoads}`,
  ];
  const largest = [...resident].sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key)).slice(0, top);
  if (largest.length) lines.push('largest:', ...largest.map(r => `  ${formatBytes(r.bytes).padStart(9)}  ${r.key}`));
  lines.push('(estimates from pixel counts and decoded audio length, not read from the GPU)');
  return lines;
}
