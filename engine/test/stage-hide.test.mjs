import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleHidden, soloHidden } from '../../dist/engine/src/index.js';

test('toggleHidden hides a shown part and shows a hidden one', () => {
  assert.deepEqual(toggleHidden([], 'arm'), ['arm']);
  assert.deepEqual(toggleHidden(['arm', 'head'], 'arm'), ['head']);
});

test('soloHidden hides every part but the kept ones, and a second solo shows all again', () => {
  const all = ['torso', 'arm', 'head'];
  assert.deepEqual(soloHidden([], all, ['torso']), ['arm', 'head']);
  assert.deepEqual(soloHidden(['head', 'arm'], all, ['torso']), []);
  assert.deepEqual(soloHidden(['arm'], all, ['torso', 'head']), []);
  assert.deepEqual(soloHidden([], all, ['torso', 'head']), ['arm']);
});
