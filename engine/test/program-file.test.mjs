import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, playtest, packProgram, unpackProgram, scriptsVersion, hashText, PROGRAM_FORMAT } from '../../dist/engine/src/index.js';

const dir = new URL('../../games/sample/script/', import.meta.url);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.vn')).map(f => ({ file: f, text: fs.readFileSync(new URL(f, dir), 'utf8') }));
const roundTrip = program => unpackProgram(JSON.parse(JSON.stringify(packProgram(program, scriptsVersion(files))))).program;

test('the sample program survives a JSON round trip unchanged', () => {
  const program = compile(files);
  assert.deepEqual(program.diagnostics.filter(d => d.severity === 'error'), []);
  const back = roundTrip(program);
  assert.ok(Object.keys(program.strings).length > 0, 'the sample has strings, so dropping them is a real test');
  assert.equal(JSON.stringify(back), JSON.stringify({ ...program, diagnostics: [], strings: {} }), 'the packed program drops the strings copy');
  assert.deepEqual(back.ops, JSON.parse(JSON.stringify(program.ops)), 'nothing in an op is lost to JSON (undefined, NaN, Infinity, Map, Set)');
});

test('a round-tripped program plays like the compiled one', () => {
  const program = compile(files);
  const a = playtest(program, { allLabels: true });
  const b = playtest(roundTrip(program), { allLabels: true });
  assert.equal(JSON.stringify(b), JSON.stringify(a));
  assert.equal(b.complete, true);
});

test('the version is the hash of the scripts, as saves record it', () => {
  assert.equal(scriptsVersion([{ file: 'a.vn', text: 'x' }]), hashText('a.vn\nx'));
  assert.notEqual(scriptsVersion([{ file: 'a.vn', text: 'x' }]), scriptsVersion([{ file: 'a.vn', text: 'y' }]));
});

test('a program of another format or a damaged one is refused with a message', () => {
  const ok = packProgram(compile([{ file: 't.vn', text: 'label start:\n    "hi"\n' }]), 'v');
  assert.equal(unpackProgram(ok).format, PROGRAM_FORMAT);
  assert.throws(() => unpackProgram({ ...ok, format: PROGRAM_FORMAT + 1 }), /export the game again/);
  assert.throws(() => unpackProgram({ ...ok, program: {} }), /damaged/);
  assert.throws(() => unpackProgram(undefined), /no compiled program/);
});
