import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ResEdit from 'resedit';
import { patchExe } from '../../tools/exe-info.mjs';
import { icoFromPng } from '../../dist/engine/src/index.js';

const electronExe = path.join(import.meta.dirname, '../../node_modules/electron/dist/electron.exe');

/** A PNG header of this size (resedit stores the bytes as they are; the image itself is never decoded here). */
const png = (width, height) => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
};

const read = file => {
  const res = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(fs.readFileSync(file)));
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  return { strings: Object.assign({}, ...info.getAllLanguagesForStringValues().map(l => info.getStringValues(l))), info, icons: ResEdit.Resource.IconGroupEntry.fromEntries(res.entries) };
};

test('patchExe: a copy of electron.exe gets the icon and version info, Electron\'s own strings go', { skip: !fs.existsSync(electronExe) && 'no node_modules/electron/dist/electron.exe' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-exe-'));
  try {
    const exe = path.join(dir, 'My Game.exe');
    fs.copyFileSync(electronExe, exe);
    const before = read(exe).icons[0];
    const image = png(256, 256);
    patchExe(exe, { ico: icoFromPng(image), version: '1.2.3.0', title: 'My Game', originalFilename: 'My Game.exe' });
    const { strings, info, icons } = read(exe);
    assert.equal(strings.ProductName, 'My Game');
    assert.equal(strings.FileDescription, 'My Game');
    assert.equal(strings.FileVersion, '1.2.3.0');
    assert.equal(strings.ProductVersion, '1.2.3.0');
    assert.equal(strings.OriginalFilename, 'My Game.exe');
    for (const gone of ['CompanyName', 'LegalCopyright', 'SquirrelAwareVersion']) assert.equal(strings[gone], undefined, gone);
    assert.deepEqual([info.fixedInfo.fileVersionMS, info.fixedInfo.fileVersionLS], [0x10002, 0x30000]);
    assert.equal(icons[0].id, before.id);
    assert.deepEqual(icons[0].icons.map(i => [i.width, i.height, i.dataSize]), [[0, 0, image.length]]);

    // Without an icon only the version info changes.
    patchExe(exe, { version: '2.0.0.0', title: 'My Game', originalFilename: 'My Game.exe' });
    const again = read(exe);
    assert.equal(again.strings.FileVersion, '2.0.0.0');
    assert.deepEqual(again.icons[0].icons.map(i => i.dataSize), [image.length]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
