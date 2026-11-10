/**
 * The editor's Files panel as a tree: script paths ('ui/title.vn') and folders (empty ones too) become nested nodes,
 * folders first, then by name. While a filter is typed the result is a flat list of the matching files instead.
 */

export interface FileTreeFolder { path: string; name: string; folders: FileTreeFolder[]; files: string[] }

export type FileTree = { flat: false; root: FileTreeFolder } | { flat: true; files: string[] };

const byName = (a: string, b: string) => a.localeCompare(b);

/** `files` are paths like 'ui/title.vn', `dirs` folder paths like 'ui' (parents of files are implied). */
export function buildFileTree(files: string[], dirs: string[] = [], filter = ''): FileTree {
  const q = filter.trim().toLowerCase();
  if (q) return { flat: true, files: files.filter(f => f.toLowerCase().includes(q)).sort(byName) };
  const root: FileTreeFolder = { path: '', name: '', folders: [], files: [] };
  const folder = (p: string): FileTreeFolder => {
    let cur = root;
    for (const part of p.split('/').filter(Boolean)) {
      const sub = cur.path ? `${cur.path}/${part}` : part;
      let next = cur.folders.find(f => f.path === sub);
      if (!next) { next = { path: sub, name: part, folders: [], files: [] }; cur.folders.push(next); }
      cur = next;
    }
    return cur;
  };
  for (const d of dirs) folder(d);
  for (const f of files) {
    const i = f.lastIndexOf('/');
    folder(i < 0 ? '' : f.slice(0, i)).files.push(f);
  }
  const sort = (n: FileTreeFolder) => {
    n.folders.sort((a, b) => byName(a.name, b.name));
    n.files.sort(byName);
    n.folders.forEach(sort);
  };
  sort(root);
  return { flat: false, root };
}

/**
 * The Assets panel's folders: asset paths ('bg/park.png') grouped by their top folder, names in order. A layered
 * character's files (`layered`: its char/<name>/ folder is shown under Characters instead) and .gitkeep are left out, as
 * is anything `keep` rejects. One pass, so a folder of thousands of files costs no more than that many.
 */
export function groupAssetFiles(files: readonly string[], layered: readonly string[] = [], keep: (file: string) => boolean = () => true): Map<string, string[]> {
  const hidden = new Set(layered);
  const out = new Map<string, string[]>();
  for (const file of files) {
    const slash = file.indexOf('/');
    const dir = slash < 0 ? file : file.slice(0, slash), rest = slash < 0 ? '' : file.slice(slash + 1);
    if (file.endsWith('.gitkeep')) continue;
    if (dir === 'char' && rest.includes('/') && hidden.has(rest.slice(0, rest.indexOf('/')))) continue;
    if (!keep(file)) continue;
    let names = out.get(dir);
    if (!names) out.set(dir, names = []);
    names.push(rest);
  }
  for (const names of out.values()) names.sort();
  return out;
}
