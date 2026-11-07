// The projects screen of Marginalia Studio (projects.html): recent projects, Open Folder, New Project, Open the Demo.
// Everything that touches the disk goes through window.vnStudio.projects (studio/preload.cjs → studio/main.cjs).

const api = window.vnStudio.projects;
const $ = id => document.getElementById(id);
let defaults = { documents: '', parent: '', git: false };

const showError = text => { $('error').textContent = text || ''; };

/** Run an open-like call with the busy overlay; on success the window has moved on to the editor. */
async function opening(run) {
  showError('');
  document.body.classList.add('busy');
  try {
    const r = await run();
    if (r?.error) showError(r.error);
    if (r?.warning) showError(r.warning);
    if (r?.error || r?.cancelled) await refresh();
    return r;
  } finally { document.body.classList.remove('busy'); }
}

function when(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(t).toLocaleDateString();
}

function mark(text, kind = '', title = '') {
  const m = document.createElement('span');
  m.className = `mark ${kind}`;
  m.textContent = text;
  if (title) m.title = title;
  return m;
}

function row(p) {
  const li = document.createElement('li');
  li.dataset.folder = p.folder;
  li.className = p.missing ? 'missing' : 'openable';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = p.title || p.folder;
  const folder = document.createElement('div');
  folder.className = 'folder';
  folder.textContent = p.folder;
  const marks = document.createElement('div');
  marks.className = 'marks';
  if (p.missing) marks.append(mark('missing', 'bad', 'The folder is not there any more. Remove it from the list, or move it back.'));
  else {
    const e = p.engine;
    if (e?.status === 'newer-game') marks.append(mark(`engine ${e.wanted}: newer than this Studio`, 'bad', `This Studio has engine ${e.have}; update the Studio before editing.`));
    else if (e?.status === 'older-game') marks.append(mark(`engine ${e.wanted}: older`, 'warn', `This Studio has engine ${e.have}; opening it says what changed.`));
    else if (e?.wanted) marks.append(mark(`engine ${e.wanted}`));
    if (!p.project) marks.append(mark('not a project', 'bad', 'No game.json or script/ folder'));
    if (p.npm) marks.append(mark('npm setup', '', 'It also has a package.json with the engine; the Studio uses its own engine.'));
  }
  if (p.sharedId?.length) marks.append(mark(`same id as ${p.sharedId.length === 1 ? 'another project' : `${p.sharedId.length} projects`}`, 'warn',
    `Game id "${p.id}" is also used by:\n${p.sharedId.join('\n')}\nThe preview keeps saves and settings per game id.`));
  const last = when(p.lastOpened);
  if (last) marks.append(mark(`opened ${last}`));

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const reveal = document.createElement('button');
  reveal.textContent = 'Reveal';
  reveal.title = 'Show the folder in the file manager';
  reveal.disabled = !!p.missing;
  reveal.dataset.action = 'reveal';
  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.title = 'Remove from this list (the folder stays)';
  remove.dataset.action = 'remove';
  actions.append(reveal, remove);
  li.append(title, actions, folder, marks);
  return li;
}

async function refresh(list) {
  list ??= await api.list();
  $('list').replaceChildren(...list.map(row));
}

$('list').addEventListener('click', async e => {
  const li = e.target.closest('li');
  if (!li) return;
  const folder = li.dataset.folder;
  const action = e.target.closest('button')?.dataset.action;
  if (action === 'reveal') return api.reveal(folder);
  if (action === 'remove') return refresh(await api.remove(folder));
  if (li.classList.contains('openable')) await opening(() => api.open(folder));
});

$('openFolder').addEventListener('click', async () => {
  const folder = await api.pickFolder('Open a game project folder', defaults.documents);
  if (folder) await opening(() => api.open(folder));
});

$('openDemo').addEventListener('click', () => opening(() => api.openDemo()));

// The animation studio on a character folder (the PSD converter's output, or one image per pose), with no game project.
$('openCharacter').addEventListener('click', () => opening(() => api.openCharacter()));

// ---- New project ----

const folderName = title => title.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
let nameEdited = false;

$('newProject').addEventListener('click', () => {
  $('newTitle').value = '';
  $('newName').value = '';
  $('newParent').value ||= defaults.parent || defaults.documents;
  $('newError').textContent = '';
  nameEdited = false;
  $('newDialog').showModal();
  $('newTitle').focus();
});
$('newTitle').addEventListener('input', () => { if (!nameEdited) $('newName').value = folderName($('newTitle').value); });
$('newName').addEventListener('input', () => { nameEdited = $('newName').value !== ''; });
$('newBrowse').addEventListener('click', async () => {
  const folder = await api.pickFolder('Where to put the new project', $('newParent').value || defaults.parent || defaults.documents);
  if (folder) $('newParent').value = folder;
});
const chosenTemplate = () => $('newTemplate').querySelector('input:checked')?.value;
const templateNote = () => {
  const t = defaults.templates.find(t => t.id === chosenTemplate());
  const size = t?.stage && `${t.stage.width}x${t.stage.height}`;
  if (size && [...$('newStage').options].some(o => o.value === size)) { $('newStage').value = size; $('newStage').dispatchEvent(new Event('change')); }
};
$('newTemplate').addEventListener('change', templateNote);
$('newStage').addEventListener('change', () => {
  const custom = $('newStage').value === 'custom';
  $('newWidth').hidden = $('newHeight').hidden = !custom;
});
$('newCancel').addEventListener('click', () => $('newDialog').close());
$('newForm').addEventListener('submit', async e => {
  e.preventDefault();
  const preset = $('newStage').value;
  const [width, height] = preset === 'custom' ? [Number($('newWidth').value), Number($('newHeight').value)] : preset.split('x').map(Number);
  $('newError').textContent = '';
  $('newCreate').disabled = true;
  try {
    const r = await opening(() => api.create({
      title: $('newTitle').value, parent: $('newParent').value, name: $('newName').value,
      stage: { width, height }, git: $('newGit').checked, template: chosenTemplate(),
    }));
    if (r?.error) { $('newError').textContent = r.error; showError(''); }
    else $('newDialog').close();
  } finally { $('newCreate').disabled = false; }
});

(async () => {
  defaults = await api.defaults();
  $('version').textContent = `engine ${defaults.engineVersion}`;
  for (const t of defaults.templates) {
    const card = document.createElement('label');
    const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'template', value: t.id, checked: t.id === defaults.defaultTemplate });
    const title = Object.assign(document.createElement('strong'), { textContent: t.title });
    const text = Object.assign(document.createElement('small'), { textContent: t.description });
    card.append(radio, title, text);
    $('newTemplate').append(card);
  }
  templateNote();
  $('newGit').disabled = !defaults.git;
  $('newGit').checked = defaults.git;
  $('gitNote').textContent = defaults.git
    ? 'Commit from the editor\'s git dialog. Without Git LFS installed the PSDs are stored in git as they are.'
    : 'git is not installed, so this is off. Install it from git-scm.com and restart the Studio to use it; the project works without.';
  await refresh();
  document.body.dataset.ready = '1';
})();
