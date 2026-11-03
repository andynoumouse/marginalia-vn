/**
 * Hex colors in the project's text, for the editor's color swatches and picker. Pure text in, positions out.
 * In a script a color is only taken where one is valid: after `=` (`color=`, `text=`, `{color=#...}`) or after
 * `tint` / `flash`, so a string id like `#ab12` is never mistaken for one. In game.json any string that is a hex color.
 */

/** A hex color in the text: 1-based line, 0-based column and length of the `#...` token, and its parsed value. */
export interface ColorRef { line: number; col: number; length: number; r: number; g: number; b: number; a: number }

const HEX = '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_])';
const RE_SCRIPT = new RegExp(`(?:(?<==)|(?<=\\b(?:tint|flash)[ \\t]+))${HEX}`, 'g');
const RE_JSON = new RegExp(`(?<=")${HEX}(?=")`, 'g');

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` as channels in 0-1; undefined if it is not one. */
export function parseHex(s: string): { r: number; g: number; b: number; a: number } | undefined {
  const m = /^#([0-9a-fA-F]+)$/.exec(s);
  if (!m || ![3, 4, 6, 8].includes(m[1].length)) return undefined;
  let h = m[1];
  if (h.length <= 4) h = [...h].map(c => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

/** Channels in 0-1 as `#rrggbb`, or `#rrggbbaa` when the color is not opaque. */
export function formatHex(c: { r: number; g: number; b: number; a: number }): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a) : ''}`;
}

// The CSS named colors, for isCssColor.
const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown '
  + 'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod '
  + 'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen '
  + 'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue '
  + 'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew '
  + 'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan '
  + 'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray '
  + 'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid '
  + 'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream '
  + 'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen '
  + 'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown '
  + 'royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow '
  + 'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen '
  + 'transparent currentcolor').split(' '));
// Hex values of the CSS named colors (the `grey` spellings are looked up as `gray`), for parseColor.
const NAMED_HEX = new Map<string, string>((
  'aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 '
  + 'black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 '
  + 'cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc '
  + 'crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 '
  + 'darkgreen 006400 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc '
  + 'darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f '
  + 'darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dodgerblue 1e90ff '
  + 'firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff '
  + 'gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f honeydew f0fff0 hotpink ff69b4 '
  + 'indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 '
  + 'lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 '
  + 'lightgray d3d3d3 lightgreen 90ee90 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa '
  + 'lightskyblue 87cefa lightslategray 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 '
  + 'limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd '
  + 'mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a '
  + 'mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 '
  + 'moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 '
  + 'orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 '
  + 'papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 '
  + 'rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 '
  + 'sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd '
  + 'slategray 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 '
  + 'tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 '
  + 'yellowgreen 9acd32'
).split(' ').flatMap((w, i, a) => (i % 2 ? [] : [[w, a[i + 1]] as [string, string]])));
const COLOR_FN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/;

/**
 * Whether `s` reads as a CSS color: a hex color, a named color, or a color function (`rgb(...)`, `hsl(...)`,
 * `oklch(...)`, `color-mix(...)`...) whose arguments are numbers, units, `/`, commas and nested colors. A shape check,
 * not a full parser: it keeps a typo like "blu" from blanking a themed background, and it runs in node.
 */
export function isCssColor(s: string): boolean {
  const v = s.trim().toLowerCase();
  if (v.startsWith('#')) return parseHex(v) !== undefined;
  if (NAMED.has(v)) return true;
  if (!COLOR_FN.test(v) || !v.endsWith(')')) return false;
  let depth = 0;
  for (const c of v) {
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0 && /^[a-z0-9#.,%/+\-\s()]+$/.test(v);
}

/** A hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `hwb()`, `color-mix(in srgb, ...)` of those, or named (`rebeccapurple`...) or `transparent` color as channels in 0-1; undefined for anything else (`oklch()`, other color spaces...). */
export function parseColor(s: string): { r: number; g: number; b: number; a: number } | undefined {
  const v = s.trim().toLowerCase();
  if (v.startsWith('#')) return parseHex(v);
  const named = NAMED_HEX.get(v.replace(/grey$/, 'gray'));
  if (named) return parseHex(`#${named}`);
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const mix = /^color-mix\(\s*in\s+srgb\s*,(.*)\)$/.exec(v);
  if (mix) return parseMix(mix[1]);
  const h = /^(hsla?|hwb)\(([^)]*)\)$/.exec(v);
  if (h) return parseHue(h[1] === 'hwb', h[2]);
  const m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (!m) return undefined;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const nums = parts.map((p, i) => {
    const n = Number.parseFloat(p);
    if (!Number.isFinite(n) || !/^[+-]?[\d.]+%?$/.test(p)) return NaN;
    return p.endsWith('%') ? n / 100 : i < 3 ? n / 255 : n;
  });
  if (nums.some(Number.isNaN)) return undefined;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return { r: clamp(nums[0]), g: clamp(nums[1]), b: clamp(nums[2]), a: nums.length === 4 ? clamp(nums[3]) : 1 };
}

type Rgba = { r: number; g: number; b: number; a: number };

/** `hsl(210 50% 40% / .5)`, `hsla(...)` or `hwb(210 10% 20%)`: hue in degrees (or `deg`/`turn`), the rest percents. */
function parseHue(hwb: boolean, body: string): Rgba | undefined {
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const hm = /^([+-]?[\d.]+)(deg|turn)?$/.exec(parts[0]);
  if (!hm || !parts[1].endsWith('%') || !parts[2].endsWith('%')) return undefined;
  const hue = ((Number.parseFloat(hm[1]) * (hm[2] === 'turn' ? 360 : 1)) % 360 + 360) % 360;
  const p1 = Number.parseFloat(parts[1]) / 100, p2 = Number.parseFloat(parts[2]) / 100;
  let a = 1;
  if (parts.length === 4) {
    a = Number.parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1);
    if (!/^[+-]?[\d.]+%?$/.test(parts[3]) || !Number.isFinite(a)) return undefined;
  }
  if (![p1, p2].every(Number.isFinite)) return undefined;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const hsl = (n: number, s: number, l: number) => {
    const k = (n + hue / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  let ch: number[];
  if (hwb) {
    const total = p1 + p2, w = total > 1 ? p1 / total : p1, bl = total > 1 ? p2 / total : p2;
    ch = [0, 8, 4].map(n => hsl(n, 1, 0.5) * (1 - w - bl) + w);
  } else {
    ch = [0, 8, 4].map(n => hsl(n, clamp(p1), clamp(p2)));
  }
  return { r: clamp(ch[0]), g: clamp(ch[1]), b: clamp(ch[2]), a: clamp(a) };
}

/** The arguments of `color-mix(in srgb, A [p%], B [p%])` after the color space; undefined if a part does not parse. */
function parseMix(args: string): Rgba | undefined {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '(') depth++;
    else if (args[i] === ')') depth--;
    else if (args[i] === ',' && depth === 0) { parts.push(args.slice(start, i)); start = i + 1; }
  }
  parts.push(args.slice(start));
  if (parts.length !== 2) return undefined;
  const one = (s: string) => {
    const m = /^\s*(.*?)(?:\s+([\d.]+)%)?\s*$/.exec(s)!;
    const color = parseColor(m[1]);
    return color && { color, pct: m[2] === undefined ? undefined : Number.parseFloat(m[2]) / 100 };
  };
  const x = one(parts[0]), y = one(parts[1]);
  if (!x || !y) return undefined;
  let px = x.pct ?? (y.pct === undefined ? 0.5 : 1 - y.pct);
  let py = y.pct ?? 1 - px;
  const sum = px + py;
  if (!(sum > 0)) return undefined;
  px /= sum; py /= sum;
  const alpha = x.color.a * px + y.color.a * py;
  // Premultiplied mix, as CSS does.
  const ch = (k: 'r' | 'g' | 'b') => (alpha === 0 ? 0 : (x.color[k] * x.color.a * px + y.color[k] * y.color.a * py) / alpha);
  return { r: ch('r'), g: ch('g'), b: ch('b'), a: Math.min(1, alpha * (sum < 1 ? sum : 1)) };
}

const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (c: { r: number; g: number; b: number }) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);

/**
 * WCAG contrast ratio (1 to 21) of the color `fg` on `bg`; a translucent `fg` is mixed over `bg`, and a translucent `bg`
 * over `under` (the stage's black by default). Undefined if either does not parse (`oklch()`, another color space...).
 */
export function contrast(fg: string, bg: string, under = '#000000'): number | undefined {
  const f = parseColor(fg), b0 = parseColor(bg), u = parseColor(under);
  if (!f || !b0 || !u) return undefined;
  const mix = (top: typeof f, below: { r: number; g: number; b: number }) =>
    ({ r: top.r * top.a + below.r * (1 - top.a), g: top.g * top.a + below.g * (1 - top.a), b: top.b * top.a + below.b * (1 - top.a) });
  const b = mix(b0, u);
  const l1 = luminance(mix(f, b)), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Every hex color in a script (`kind` 'vn') or game.json (`kind` 'json'). Comment lines are skipped in scripts. */
export function findColors(text: string, kind: 'vn' | 'json'): ColorRef[] {
  const out: ColorRef[] = [];
  const re = kind === 'json' ? RE_JSON : RE_SCRIPT;
  text.split('\n').forEach((line, i) => {
    if (kind === 'vn' && line.trimStart().startsWith('#')) return;
    re.lastIndex = 0;
    for (let m; (m = re.exec(line));) {
      const c = parseHex(m[0]);
      if (c) out.push({ line: i + 1, col: m.index, length: m[0].length, ...c });
    }
  });
  return out;
}
