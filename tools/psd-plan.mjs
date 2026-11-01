// Character PSD layer tree -> a plan of parts (psd-convert.mjs renders the plan). Pure, so it can be tested
// with hand-built layer objects instead of real PSDs.
//
//   { type: 'part', name, layers }                        always drawn: a layer plus the layers clipped to it
//   { type: 'slot', slot, default, variants: [{ name, aliases, layer }] }
//
// Entries come bottom to top. A top-level group is a slot, unless its name starts with `prefix` ("+" by default):
// then it is only a folder for organizing the PSD, and its layers are processed as if they sat beside it.

export const DEFAULT_PREFIX = '+';

export const fileSafe = s => s.replace(/[^\w\-]+/g, '_');
export const parseName = raw => {
  const [name, ...aliases] = raw.split(',').map(s => s.trim()).filter(Boolean);
  return { name: name ?? '', aliases };
};
export const isIdent = s => /^[A-Za-z_]\w*$/.test(s);

const skipped = l => l.name?.startsWith('_');
const isGroup = l => Array.isArray(l.children);

/** The folder prefix from game.json's `psdPrefix`: a string ("" turns folders off), else "+". */
export const prefixFrom = game => (typeof game?.psdPrefix === 'string' ? game.psdPrefix : DEFAULT_PREFIX);

export function planCharacter(top, { prefix = DEFAULT_PREFIX, warn = () => {} } = {}) {
  const plan = [];
  const partFiles = new Map(); // file-safe part name -> layer name, to catch two layers writing one PNG
  const isFolder = l => isGroup(l) && prefix !== '' && (l.name ?? '').trim().startsWith(prefix);

  const walk = layers => {
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (skipped(l) || l.clipping) continue; // clipped layers are merged into their base
      if (isFolder(l)) {
        if (!l.hidden) walk(l.children);
        continue;
      }
      if (!isGroup(l)) {
        const stack = [l];
        while (layers[i + 1]?.clipping) stack.push(layers[++i]);
        if (l.hidden) continue;
        const name = l.name ?? 'layer', file = fileSafe(name);
        if (partFiles.has(file)) warn(`layers "${partFiles.get(file)}" and "${name}" write the same image; the upper one wins`);
        else partFiles.set(file, name);
        plan.push({ type: 'part', name, layers: stack });
        continue;
      }
      plan.push(planSlot(l));
    }
  };

  const planSlot = l => {
    const slot = l.name?.trim() ?? '';
    if (!isIdent(slot)) warn(`slot "${slot}" is not a valid script name (letters, digits, _)`);
    const variants = [], seen = new Set();
    let def = null;
    for (const v of [...l.children].reverse()) { // top-most first, so the top visible child is the default
      if (skipped(v)) continue;
      const { name, aliases } = parseName(v.name ?? '');
      if (!isIdent(name)) { warn(`variant "${v.name}" in "${slot}" is not a valid script name; skipped`); continue; }
      if (seen.has(name)) warn(`"${slot}" has two variants named "${name}"; using the upper one`);
      else { seen.add(name); variants.push({ name, aliases, layer: v }); }
      if (!v.hidden && def === null) def = name;
    }
    return { type: 'slot', slot, default: def, variants };
  };

  walk(top);
  return plan;
}
