// help.html: the F1 help in a window of its own. help.html?doc=game-json#characters opens game-json.md at "characters".

import { HelpDialog, HELP_DOCS, type HelpSource } from './help-dialog.js';

const doc = new URLSearchParams(location.search).get('doc');
const source: HelpSource = doc && Object.hasOwn(HELP_DOCS, doc) ? doc as HelpSource : 'commands';
const topic = () => decodeURIComponent(location.hash.slice(1)) || null;

const help = new HelpDialog(document.body, true);
void help.open(topic(), undefined, source);
window.addEventListener('hashchange', () => help.show(topic() ?? undefined));
