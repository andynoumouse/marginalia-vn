import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalHost, isOwnOrigin, isOpenable } from '../../dist/engine/src/request-guard.js';

test('only local host names pass, with or without a port', () => {
  for (const h of ['localhost', 'localhost:5173', 'LOCALHOST:80', '127.0.0.1:5173', '[::1]:5173', '[::1]']) assert.ok(isLocalHost(h), h);
  for (const h of [undefined, '', 'evil.example:5173', 'localhost.evil.example', '127.0.0.2:5173', '0.0.0.0:5173', '127.0.0.1.nip.io'])
    assert.ok(!isLocalHost(h), String(h));
});

test('a write may have no Origin, or the server\'s own', () => {
  assert.ok(isOwnOrigin(undefined, 'localhost:5173'));
  assert.ok(isOwnOrigin('http://localhost:5173', 'localhost:5173'));
  assert.ok(isOwnOrigin('http://127.0.0.1:5173', '127.0.0.1:5173'));
  assert.ok(!isOwnOrigin('null', 'localhost:5173'));
  assert.ok(!isOwnOrigin('http://localhost:5174', 'localhost:5173'), 'another local server');
  assert.ok(!isOwnOrigin('https://localhost:5173', 'localhost:5173'));
  assert.ok(!isOwnOrigin('http://evil.example:5173', 'localhost:5173'));
  assert.ok(!isOwnOrigin('http://evil.example:5173', 'evil.example:5173'), 'a foreign host never passes');
});

test('only art, audio, fonts, scripts and data open in the default app', () => {
  for (const f of ['masters/char/mina.psd', 'assets/bg/park.PNG', 'assets/music/rain.ogg', 'assets/fonts/a.woff2', 'script/park.vn', 'assets/char/mina/rig.json'])
    assert.ok(isOpenable(f), f);
  for (const f of ['assets/setup.bat', 'assets/run.exe', 'assets/x.cmd', 'assets/x.ps1', 'assets/x.lnk', 'assets/x.js', 'assets/x.html', 'assets/png', 'assets/x.png.bat'])
    assert.ok(!isOpenable(f), f);
});
