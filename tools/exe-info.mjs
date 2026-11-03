// The portable desktop export's exe (a renamed electron.exe): its icon and version info, written with resedit (pure JS, no native
// tool). The engine side (engine/src/app-info.ts) makes the .ico and the version strings; this edits the file.

import fs from 'node:fs';
import * as ResEdit from 'resedit';

/** US English, the language Electron's own version info is written in. */
const LANG = 1033;
/** UTF-16, the code page of that string table. */
const CODEPAGE = 1200;

/**
 * Rewrites the Windows exe at `file` in place: the main icon (the first icon group, which Explorer and the taskbar show) from
 * `ico` (an .ico file's bytes) when given, and the version info: `version` as file and product version ("1.2.0.0"), `title` as
 * product name and description, and `originalFilename` (the exe's name). The output is unsigned, like the input.
 */
export function patchExe(file, { ico, version, title, originalFilename }) {
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(file), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  if (ico) {
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    if (!groups.length) throw new Error('The exe has no icon to replace');
    const icons = ResEdit.Data.IconFile.from(ico).icons.map(i => i.data);
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups[0].id, groups[0].lang, icons);
  }
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (!info) throw new Error('The exe has no version info');
  info.setFileVersion(version, LANG);
  info.setProductVersion(version, LANG);
  // Electron's own strings (CompanyName "GitHub, Inc.", LegalCopyright, InternalName "electron", SquirrelAwareVersion, which tells
  // a Squirrel installer the app handles its events) are dropped, not left to describe the game as Electron.
  for (const l of info.getAllLanguagesForStringValues()) {
    for (const key of ['CompanyName', 'LegalCopyright', 'InternalName', 'Comments', 'SquirrelAwareVersion']) info.removeStringValue(l, key);
  }
  info.setStringValues({ lang: LANG, codepage: CODEPAGE }, {
    ProductName: title, FileDescription: title, OriginalFilename: originalFilename, InternalName: title,
  });
  info.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(file, Buffer.from(exe.generate()));
}
