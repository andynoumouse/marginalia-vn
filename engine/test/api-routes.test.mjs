import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { API_ROUTES } from '../../dist/engine/src/api-routes.js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const sorted = a => [...a].sort();

test('the dev server serves exactly the paths of the /api route table', () => {
  const served = new Set([...read('preview/dev-server.mjs').matchAll(/url\.pathname === '(\/api\/[\w\-/]+)'/g)].map(m => m[1]));
  assert.deepEqual(sorted(served), sorted(new Set(API_ROUTES.map(r => r.path))));
});

test('the online demo answers exactly the routes marked online', () => {
  const cases = [...read('online/routes.ts').matchAll(/case '((?:GET|PUT|POST) \/api\/[\w\-/]+)'/g)].map(m => m[1]);
  assert.deepEqual(sorted(cases), sorted(API_ROUTES.filter(r => r.online).map(r => `${r.method} ${r.path}`)));
});

test('the dev server checks the method of each route as the table says', () => {
  const src = read('preview/dev-server.mjs');
  for (const r of API_ROUTES) {
    if (r.path === '/api/capabilities' || r.path === '/api/project') continue; // answered for any method
    const found = src.split('\n').some(l => l.includes(`'${r.path}'`) && l.includes(`req.method === '${r.method}'`));
    assert.ok(found, `${r.method} ${r.path} in dev-server.mjs`);
  }
});
