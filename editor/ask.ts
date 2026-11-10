// An in-page confirm and prompt. window.confirm and window.prompt are blocked in embedded browsers and iframes (a blocked
// one answers "no"), so the editor and the online project list ask with a <dialog> of their own.

const STYLE = `
dialog.ask { background: var(--panel, #171b23); color: var(--text, #e6e9ef); border: 1px solid var(--line, #2a303c); border-radius: 8px; padding: 18px 20px; max-width: 460px; }
dialog.ask::backdrop { background: #0e1117cc; }
dialog.ask p { margin: 0 0 12px; white-space: pre-line; }
dialog.ask input { width: 100%; margin-bottom: 12px; }
dialog.ask .buttons { display: flex; justify-content: flex-end; gap: 8px; }
dialog.ask button.primary { background: var(--accent, #5fd1c3); color: var(--ink, #0e1117); border-color: var(--accent, #5fd1c3); }`;

/** The text typed (a prompt, when `value` is given), true (a confirm) or null when cancelled. */
function ask(message: string, ok: string, value?: string, safe = false): Promise<string | boolean | null> {
  if (!document.getElementById('askStyle')) document.head.append(Object.assign(document.createElement('style'), { id: 'askStyle', textContent: STYLE }));
  return new Promise(resolve => {
    const dlg = Object.assign(document.createElement('dialog'), { className: 'ask' });
    const form = document.createElement('form');
    form.method = 'dialog';
    const input = value !== undefined ? Object.assign(document.createElement('input'), { type: 'text', value, autocomplete: 'off' }) : null;
    const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel' });
    const yes = Object.assign(document.createElement('button'), { type: 'submit', textContent: ok, className: 'primary' });
    const buttons = Object.assign(document.createElement('div'), { className: 'buttons' });
    buttons.append(cancel, yes);
    form.append(Object.assign(document.createElement('p'), { textContent: message }), ...(input ? [input] : []), buttons);
    dlg.append(form);
    document.body.append(dlg);
    let result: string | boolean | null = null;
    form.addEventListener('submit', () => { result = input ? input.value : true; });
    cancel.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
    (input ?? (safe ? cancel : yes)).focus();
    input?.select();
  });
}

/** Ask which of `choices` (button labels, the first one the default) to take: its index, or null when cancelled. */
export function choiceAsk(message: string, choices: string[]): Promise<number | null> {
  if (!document.getElementById('askStyle')) document.head.append(Object.assign(document.createElement('style'), { id: 'askStyle', textContent: STYLE }));
  return new Promise(resolve => {
    const dlg = Object.assign(document.createElement('dialog'), { className: 'ask' });
    const buttons = Object.assign(document.createElement('div'), { className: 'buttons' });
    let result: number | null = null;
    const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel' });
    cancel.addEventListener('click', () => dlg.close());
    const picks = choices.map((label, i) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, className: i === 0 ? 'primary' : '' });
      b.addEventListener('click', () => { result = i; dlg.close(); });
      return b;
    });
    buttons.append(cancel, ...[...picks].reverse()); // the default last, at the right as in the confirm
    dlg.append(Object.assign(document.createElement('p'), { textContent: message }), buttons);
    document.body.append(dlg);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
    picks[0]?.focus();
  });
}

/** Ask a yes/no question; the confirming button reads `ok`. `safe` puts the focus on Cancel, so a key typed ahead (Enter, Space) declines: for what cannot be undone. */
export const confirmAsk = async (message: string, ok = 'OK', safe = false) => (await ask(message, ok, undefined, safe)) === true;

/** Ask for a line of text; null when cancelled. */
export const promptAsk = async (message: string, value: string, ok = 'OK') => (await ask(message, ok, value)) as string | null;
