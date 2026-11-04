import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, checkAssets, assetContext, opAssets, getCompletions, assetRefs } from '../../dist/engine/src/index.js';

const parse = line => compile([{ file: 't.vn', text: `label start:\n  ${line}\n  end` }]);
const movie = line => parse(line).ops.find(o => o.op === 'movie');
const errors = p => p.diagnostics.filter(d => d.severity === 'error').map(d => d.message);

test('movie play parses', () => {
  assert.deepEqual([movie('movie play opening').name, movie('movie play opening').noskip], ['opening', false]);
  assert.equal(movie('movie play opening noskip').noskip, true);
});

test('movie play loop', () => {
  assert.deepEqual([movie('movie play rain loop').loop, movie('movie play rain loop').noskip], [true, false]);
  assert.equal(movie('movie play rain').loop, false);
});

test('movie rejects bad usage', () => {
  for (const line of ['movie', 'movie opening', 'movie play', 'movie play a b', 'movie play a noskip extra', 'movie play a nowait', 'movie play a loop noskip', 'movie play a loop loop']) {
    assert.equal(errors(parse(line)).length, 1, line);
  }
});

test('a movie without a file is a warning, one with a file is not', () => {
  const p = parse('movie play intro');
  assert.match(checkAssets(p, { files: [] })[0].message, /No movie "intro" in assets\/movie/);
  for (const f of ['movie/intro.webm', 'movie/intro.mp4']) assert.deepEqual(checkAssets(p, { files: [f] }), []);
});

test('the preloader knows the movie file', () => {
  const p = parse('movie play intro');
  const ctx = assetContext({ files: ['movie/intro.webm'] });
  assert.deepEqual(opAssets(movie('movie play intro'), ctx), ['movie/intro']);
  assert.deepEqual(opAssets(movie('movie play other'), ctx), []);
  assert.ok(p.ops.some(o => o.op === 'movie'));
});

test('movie completes its argument and keyword', () => {
  const labels = text => getCompletions(parse('end'), text).map(c => c.label);
  assert.ok(labels('  movie ').includes('play'));
});

test('a movie file works as an overlay picture: found, preloaded, not warned about', () => {
  const line = 'image show rain movie/rain_window layer=-1';
  const p = parse(line);
  const op = p.ops.find(o => o.op === 'image');
  assert.equal(op.layer, -1);
  const ctx = assetContext({ files: ['movie/rain_window.webm'] });
  assert.deepEqual(opAssets(op, ctx), ['movie/rain_window']);
  for (const file of ['movie/rain_window', 'movie/rain_window.webm']) {
    assert.deepEqual(opAssets(parse(`image show rain ${file}`).ops.find(o => o.op === 'image'), ctx), ['movie/rain_window'], file);
  }
  assert.deepEqual(checkAssets(p, { files: ['movie/rain_window.webm'] }), []);
  assert.match(checkAssets(parse('image show rain movie/other'), { files: ['movie/rain_window.webm'] })[0].message, /No image "movie\/other"/);
});

test('renaming a movie used as an overlay picture finds its mention', () => {
  const refs = assetRefs([{ name: 't.vn', text: 'label start:\n  image show rain movie/rain_window.webm layer=-1\n  end' }], ['movie/rain_window.webm']);
  assert.deepEqual(refs.map(r => [r.kind, r.text, r.key]), [['image', 'movie/rain_window.webm', 'movie/rain_window']]);
});

test('renaming a movie file finds its mentions', () => {
  const refs = assetRefs([{ name: 't.vn', text: 'label start:\n  movie play intro noskip\n  end' }], ['movie/intro.webm']);
  assert.deepEqual(refs.map(r => [r.kind, r.text, r.key]), [['movie', 'intro', 'movie/intro']]);
});
