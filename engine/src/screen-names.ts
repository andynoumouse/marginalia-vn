// What a screen reader calls a control when its drawn label is not enough: a slider has no label of its own, a switch says only "On",
// a save slot's button is blank over a card of text, a delete button is a "×". The name comes from what is already on the screen (the
// text beside the control, the text drawn on it, its tooltip), so it is in the player's language and follows a project's own layout.
// Pure; used by resolveScreen.

import type { StageRect, ViewPart } from './screens.js';
import { partBox } from './screen-layout.js';

type Text = Extract<ViewPart, { kind: 'text' }>;
type Control = Extract<ViewPart, { kind: 'hotspot' | 'button' }>;
interface Placed { text: string; box: StageRect }

const chars = (s: string) => Array.from(s).length;
const centerIn = (b: StageRect, outer: StageRect) => b.x + b.w / 2 >= outer.x && b.x + b.w / 2 <= outer.x + outer.w && b.y + b.h / 2 >= outer.y && b.y + b.h / 2 <= outer.y + outer.h;
const contains = (outer: StageRect, b: StageRect) => b.x >= outer.x && b.y >= outer.y && b.x + b.w <= outer.x + outer.w && b.y + b.h <= outer.y + outer.h;

/** The text drawn on a rectangle, in the order the screen's script lists it (so its author decides what a reader hears first). */
const textIn = (outer: StageRect, texts: Placed[]) => texts.filter(t => centerIn(t.box, outer)).map(t => t.text);

/** The text that says what a control sets: on its left in the same row, else just above it (a label over a full-width control). */
function labelOf(box: StageRect, texts: Placed[]): string {
  let left: Placed | null = null;
  for (const t of texts) if (t.box.x < box.x && t.box.y + t.box.h / 2 >= box.y && t.box.y + t.box.h / 2 <= box.y + box.h && (!left || t.box.x > left.box.x)) left = t;
  if (left) return left.text;
  let above: Placed | null = null;
  for (const t of texts) {
    const bottom = t.box.y + t.box.h;
    if (bottom <= box.y + 8 && box.y - bottom <= 48 && t.box.x <= box.x + 8 && t.box.x + t.box.w > box.x && (!above || bottom > above.box.y + above.box.h)) above = t;
  }
  return above?.text ?? '';
}

/** The parts with a `name` added to each slider, setting button, blank-labelled button and glyph button that needs one. */
export function nameParts(parts: ViewPart[]): ViewPart[] {
  const texts: Placed[] = parts.filter((p): p is Text => p.kind === 'text' && p.text.trim() !== '').map(p => ({ text: p.text.trim(), box: partBox(p) }));
  const buttons = parts.filter((p): p is Control => p.kind === 'button');
  return parts.map(p => {
    if (p.kind === 'slider') {
      const name = labelOf(partBox(p), texts);
      return name ? { ...p, name } : p;
    }
    if (p.kind !== 'button') return p;
    const label = p.label.trim();
    // a switch or a list of values: "Reduce motion: On"
    if (p.act === 'cycle' || p.select) {
      const row = labelOf(p.bounds, texts);
      return row && label ? { ...p, name: `${row}: ${label.replace(/\s*▾$/, '')}` } : p;
    }
    // a button with nothing written on it over a card of text (a save slot, a gallery picture): the card's text
    if (!label) {
      const name = textIn(p.bounds, texts).join(', ');
      return name ? { ...p, name } : p;
    }
    // a glyph or a page number with a longer tooltip ("×" / "Delete save"), told apart by the card it sits on
    if (p.tooltip && chars(label) <= 2 && chars(p.tooltip) > chars(label)) {
      const owner = buttons.filter(b => b !== p && !b.label.trim() && contains(b.bounds, p.bounds)).sort((a, b) => a.bounds.w * a.bounds.h - b.bounds.w * b.bounds.h)[0];
      const on = owner ? textIn(owner.bounds, texts)[0] : '';
      return { ...p, name: on ? `${p.tooltip}: ${on}` : p.tooltip };
    }
    return p;
  });
}
