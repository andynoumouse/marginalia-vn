// Names in scripts. Labels, variables, screens and their `state`, and the parameters of labels, screens and transforms live only in
// scripts and saves, so they take letters of any alphabet (`label päivä_1:`, `set 体力 = 3`): a letter or _, then letters, digits, marks
// (the vowel signs of Devanagari, say) and _. Names that are also file or rig names (characters, poses and images, animations, parameters,
// bones, items, achievements) stay ASCII, since a file name in another alphabet trips up macOS normalization, zip tools and URLs.
// The regexes that match a name in place use the same classes literally, with the `u` flag: [\p{L}_][\p{L}\p{N}\p{M}_]*.

/** A name a script may use for a label, a variable, a screen or a parameter. */
export const isScriptName = (s: string): boolean => /^[\p{L}_][\p{L}\p{N}\p{M}_]*$/u.test(s);

/** A name that is also a file or rig name: ASCII letters, digits and _, not starting with a digit. */
export const isAsciiName = (s: string): boolean => /^[A-Za-z_]\w*$/.test(s);

/** The alphabets whose letters look alike (a Latin a and a Cyrillic а): a name mixing them is almost always a typo. */
const LOOKALIKE: [string, RegExp][] = [['Latin', /\p{Script=Latin}/u], ['Greek', /\p{Script=Greek}/u], ['Cyrillic', /\p{Script=Cyrillic}/u]];

/** The look-alike alphabets a name mixes (two or more), or null: `vаlue` with a Cyrillic а gives ['Latin', 'Cyrillic']. */
export function mixedAlphabets(name: string): string[] | null {
  const used = LOOKALIKE.filter(([, re]) => re.test(name)).map(([n]) => n);
  return used.length > 1 ? used : null;
}
