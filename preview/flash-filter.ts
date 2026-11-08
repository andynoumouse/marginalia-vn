// A transform's `flash=` channel on a display object: a color matrix filter that exists only while the flash is above 0.

import { ColorMatrixFilter, type ColorMatrix, type Container } from 'pixi.js';
import { flashMatrix } from '../engine/src/index.js';

const filters = new WeakMap<Container, ColorMatrixFilter>();

/** Mix `target` `flash.amount` of the way to `flash.color` (0xrrggbb); none (or an amount of 0) takes the filter off again. */
export function applyFlash(target: Container, flash: { color: number; amount: number } | undefined): void {
  const own = filters.get(target);
  if (!flash || flash.amount <= 0) {
    if (!own) return;
    filters.delete(target);
    if (!target.destroyed) target.filters = (Array.isArray(target.filters) ? target.filters : target.filters ? [target.filters] : []).filter(f => f !== own);
    own.destroy();
    return;
  }
  let f = own;
  if (!f) {
    f = new ColorMatrixFilter();
    filters.set(target, f);
    target.filters = [...(Array.isArray(target.filters) ? target.filters : target.filters ? [target.filters] : []), f];
  }
  f.matrix = flashMatrix(flash.color, flash.amount) as ColorMatrix;
}
