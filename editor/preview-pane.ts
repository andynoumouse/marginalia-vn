// Whether the preview can be seen. Beside the code it is a pane (`body.no-preview` hides it); at 900 px and below there is no
// room for both, so it covers the editor instead (`body.preview-over`) and the bar's "Editor" button brings the code back.
// Every command that asks for the preview shows it, so none claims success while nothing appears.

import { $ } from './state.js';

const query = () => matchMedia('(max-width: 900px)');
export const narrowWindow = () => query().matches;

const body = () => document.body.classList;

export function previewVisible() {
  return narrowWindow() ? body().contains('preview-over') : !body().contains('no-preview');
}

export function showPreviewPane() {
  body().remove('no-preview');
  if (narrowWindow()) body().add('preview-over');
}

export function hidePreviewPane() {
  if (narrowWindow()) body().remove('preview-over'); else body().add('no-preview');
}

export const togglePreviewPane = () => (previewVisible() ? hidePreviewPane() : showPreviewPane());

/** Back to the code from the covering preview: the bar's Editor button. Wide windows keep the pane beside it. */
export function initPreviewPane(back: () => void) {
  const button = $('paneBack');
  button.addEventListener('click', () => { hidePreviewPane(); back(); });
  // Widening the window puts the pane beside the code again; narrowing it starts with the code.
  query().addEventListener('change', () => body().remove('preview-over'));
}
