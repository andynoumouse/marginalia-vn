// Parts the animation studio hides on its stage, as a way to reach what lies behind them. Only the studio's stage uses
// it: nothing here is saved into rig.json, and an export or the game draws every part.

/** `name` hidden when it was shown, shown when it was hidden. */
export function toggleHidden(hidden: readonly string[], name: string): string[] {
  return hidden.includes(name) ? hidden.filter(h => h !== name) : [...hidden, name];
}

/** Hide every part but `keep` (solo); when that is the state already, show everything again. */
export function soloHidden(hidden: readonly string[], all: readonly string[], keep: readonly string[]): string[] {
  const others = all.filter(p => !keep.includes(p));
  const same = others.length === hidden.length && others.every(p => hidden.includes(p));
  return same ? [] : others;
}
