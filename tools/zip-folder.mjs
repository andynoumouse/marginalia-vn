// Zips a folder into `<parent>/<name>.zip`, the folder itself at the zip's root. Used by the Studio's packaging
// (scripts/package-studio.mjs) and the portable desktop export (export-web.mjs --desktop --portable).
//   Windows: bsdtar, which Windows 10 and later ship as System32's tar.exe. A GNU tar from Git or MSYS earlier on PATH
//   cannot write zips and reads the drive letter in an absolute path as a remote host, hence the full path and relative
//   names. Elsewhere zip(1).

import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Zip `parent/name` into `parent/name.zip` (which must not exist yet). Returns an error message, or null. */
export function zipFolder(parent, name, { stdio = 'inherit' } = {}) {
  const r = process.platform === 'win32'
    ? spawnSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', `${name}.zip`, name], { cwd: parent, stdio })
    : spawnSync('zip', ['-qry', `${name}.zip`, name], { cwd: parent, stdio });
  if (r.status === 0) return null;
  return `Making the zip failed${r.error ? `: ${r.error.message}` : ''}.`;
}
