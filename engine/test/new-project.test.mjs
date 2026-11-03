import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProjectFiles, projectSlug, titleFromFolder } from '../../dist/engine/src/index.js';

test('projectSlug and titleFromFolder', () => {
  assert.equal(projectSlug('The Long Night!'), 'the-long-night');
  assert.equal(projectSlug('???'), 'game');
  assert.equal(titleFromFolder('my_new-GameName'), 'my new Game Name');
});

test('newProjectFiles npm kind links the engine', () => {
  const files = newProjectFiles({ title: 'Rain Park', engineVersion: '0.2.1', kind: 'npm', engineRef: '../engine', engineRoot: '/e' });
  const pkg = JSON.parse(files['package.json']);
  assert.equal(pkg.name, 'rain-park');
  assert.equal(pkg.devDependencies['marginalia-vn'], 'file:../engine');
  const game = JSON.parse(files['game.json']);
  assert.equal(game.id, 'rain-park');
  assert.equal(game.title, 'Rain Park');
  assert.equal(game.engine, '0.2');
  assert.equal(game.stage, undefined);
  assert.match(files['README.md'], /npm install/);
  assert.match(files['.gitignore'], /node_modules/);
  assert.match(files['.gitattributes'], /masters\/\*\* filter=lfs/);
  assert.match(files['script/start.vn'], /label start:/);
});

test('newProjectFiles studio kind has no npm parts', () => {
  const files = newProjectFiles({ title: 'Rain Park', engineVersion: '0.2.1', kind: 'studio' });
  assert.equal(files['package.json'], undefined);
  assert.doesNotMatch(files['README.md'], /npm/);
  assert.doesNotMatch(files['script/start.vn'], /npm/);
  assert.doesNotMatch(files['.gitignore'], /node_modules/);
  assert.deepEqual(Object.keys(files).filter(f => f.startsWith('masters/')), ['masters/bg/.gitkeep', 'masters/char/.gitkeep', 'masters/ui/.gitkeep']);
});

test('newProjectFiles writes a non-default stage and rejects a bad one', () => {
  const portrait = newProjectFiles({ title: 'P', engineVersion: '0.2.1', kind: 'studio', stage: { width: 1080, height: 1920 } });
  assert.deepEqual(JSON.parse(portrait['game.json']).stage, { width: 1080, height: 1920 });
  const landscape = newProjectFiles({ title: 'P', engineVersion: '0.2.1', kind: 'studio', stage: { width: 1920, height: 1080 } });
  assert.equal(JSON.parse(landscape['game.json']).stage, undefined);
  assert.throws(() => newProjectFiles({ title: 'P', engineVersion: '0.2.1', kind: 'studio', stage: { width: 0, height: 1920 } }), /stage\.width/);
});

test('new projects, the sample and the demo all hold the full folder structure', async () => {
  const { PROJECT_FOLDERS } = await import('../../dist/engine/src/index.js');
  const { readdirSync } = await import('node:fs');
  const files = newProjectFiles({ title: 'Rain Park', engineVersion: '0.2.1', kind: 'studio' });
  const has = (list, dir) => list.some(f => f.startsWith(`${dir}/`));
  for (const dir of PROJECT_FOLDERS) assert.ok(has(Object.keys(files), dir), `a new project has ${dir}/`);
  for (const project of ['sample', 'demo']) {
    const all = readdirSync(new URL(`../../games/${project}`, import.meta.url), { recursive: true }).map(f => f.replaceAll('\\', '/'));
    for (const dir of PROJECT_FOLDERS) assert.ok(has(all, dir), `${project}/${dir}/ holds a file (add a .gitkeep to an empty folder)`);
  }
});
