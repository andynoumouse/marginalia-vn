// `animate <char> <name> ...` lines, so the editor can open the animation studio at the animation a script line plays.

export interface AnimRef { char: string; name: string }

/** The character and animation of an `animate <char> <name> ...` line; `animate <char> stop` and other lines give null. */
export function animateRef(line: string): AnimRef | null {
  const m = /^\s*animate\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(?=\s|$)/.exec(line.replace(/\s+#.*$/, ''));
  if (!m || m[2] === 'stop') return null;
  return { char: m[1], name: m[2] };
}
