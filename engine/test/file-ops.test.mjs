import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProjectPath, planMove, movedPath, isUnder } from '../../dist/engine/src/index.js';

test('only paths inside script/, assets/ and masters/ can change', () => {
  assert.equal(checkProjectPath('script/park.vn'), null);
  assert.equal(checkProjectPath('assets/bg'), null);
  assert.equal(checkProjectPath('masters/char/mina.psd'), null);
  assert.ok(checkProjectPath('script'));
  assert.ok(checkProjectPath('assets/'));
  assert.ok(checkProjectPath('game.json'));
  assert.ok(checkProjectPath('build/web'));
  assert.ok(checkProjectPath('script/../game.json'));
  assert.ok(checkProjectPath('assets/bg/.hidden'));
  assert.ok(checkProjectPath('assets//bg'));
  assert.ok(checkProjectPath('assets/my file.png'));
});

test('scripts keep .vn, other files keep their extension', () => {
  assert.deepEqual(planMove('script/park.vn', 'script/ch1/park'), { to: 'script/ch1/park.vn' });
  assert.deepEqual(planMove('script/park.vn', ' script/garden.vn '), { to: 'script/garden.vn' });
  assert.deepEqual(planMove('assets/bg/park.png', 'assets/cg/park_day.PNG'), { to: 'assets/cg/park_day.PNG' });
  assert.ok('error' in planMove('assets/bg/park.png', 'assets/bg/park.webp'));
  assert.ok('error' in planMove('assets/bg/park.png', 'assets/bg/park'));
  assert.ok('error' in planMove('masters/bg/park.psd', 'masters/bg/park.png'));
});

test('moves stay under the same top folder and never into themselves', () => {
  assert.ok('error' in planMove('script/park.vn', 'assets/park.vn'));
  assert.ok('error' in planMove('assets/bg/park.png', 'masters/bg/park.png'));
  assert.ok('error' in planMove('script/park.vn', 'script/park.vn'));
  assert.ok('error' in planMove('script', 'script2', true));
  assert.deepEqual(planMove('script/ch1', 'script/part1/ch1', true), { to: 'script/part1/ch1' });
  assert.deepEqual(planMove('assets/sfx', 'assets/sound/', true), { to: 'assets/sound' });
  assert.ok('error' in planMove('script/ch1', 'script/ch1/inner', true));
  assert.deepEqual(planMove('script/ch1', 'script/ch10', true), { to: 'script/ch10' }); // a prefix of the name is not "inside"
});

test('paths follow a moved file or folder', () => {
  assert.equal(movedPath('script/ch1/a.vn', 'script/ch1', 'script/one'), 'script/one/a.vn');
  assert.equal(movedPath('script/ch1', 'script/ch1', 'script/one'), 'script/one');
  assert.equal(movedPath('script/ch10/a.vn', 'script/ch1', 'script/one'), null);
  assert.ok(isUnder('assets/bg/park.png', 'assets/bg'));
  assert.ok(isUnder('assets/bg', 'assets/bg'));
  assert.ok(!isUnder('assets/bg2/x.png', 'assets/bg'));
});
