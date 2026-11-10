// The script language in Monaco: the vn language id, its brackets and indentation, the highlighting and the editor theme, completions
// from the engine (getCompletions), and the quick fixes for "did you mean" diagnostics (recompile fills quickFixes).

import { COMMAND_WORDS, getCompletions, insideScreen, type RigManifest } from '../engine/src/index.js';
import { S } from './state.js';

declare const monaco: any;

/** The "did you mean" names of the current markers, by fixKey(). */
export const quickFixes = new Map<string, string[]>();
export const fixKey = (uri: { toString(): string }, line: number, message: string) => `${uri.toString()}|${line}|${message}`;

// ---- language: highlighting, indentation, completions ----
export function registerLanguage(host: { liveRigs(): Record<string, RigManifest> }) {
  monaco.languages.register({ id: 'vn' });
  registerLanguageConfig();
  registerTokenizer();
  defineTheme();
  registerCompletions(host);
  registerQuickFixes();
}

/** Comments, brackets, auto-closing pairs and the indent after a line that ends in a colon. */
function registerLanguageConfig() {
  monaco.languages.setLanguageConfiguration('vn', {
    comments: { lineComment: '#' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [{ open: '"', close: '"' }, { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }],
    onEnterRules: [{
      beforeText: /^\s*(label\s+[^\s(:]+\s*(\([^()]*\))?\s*:|menu\s*:|if\s.+:|elif\s.+:|else\s*:|".*"[^:]*:)\s*$/,
      action: { indentAction: monaco.languages.IndentAction.Indent },
    }],
  });
}

/** Syntax colouring: dialogue, quoted menu options and command lines. */
function registerTokenizer() {
  monaco.languages.setMonarchTokensProvider('vn', {
    // Every statement word comes from the parser; the rest start the elements of a screen block.
    keywords: [...COMMAND_WORDS, 'hotspot', 'button', 'text', 'each', 'scroll', 'row', 'column', 'grid', 'cancel'],
    modifiers: ['at', 'fade', 'to', 'loop', 'nowait', 'play', 'stop', 'on', 'off', 'clear', 'cut', 'dissolve', 'wipe', 'iris', 'blinds', 'pixelate', 'pan', 'zoom', 'reset',
      'left', 'right', 'center', 'up', 'down', 'size', 'poly', 'ellipse', 'mask', 'step', 'cursor', 'enabled', 'anchor', 'margin', 'padding', 'gap', 'align', 'cell', 'as', 'and', 'or', 'not', 'true', 'false', 'screen'],
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        // Labels and variables may be in any alphabet: Monarch has no \p{L} without the u flag, so the colouring takes every character from
        // U+00C0 up as a letter (names.ts has the real rule).
        [/^(\s*)(label)(\s+)([A-Za-z_À-￿][\wÀ-￿]*)/, ['', 'keyword', '', 'type.identifier']],
        [/^(\s*)([A-Za-z_]\w*)(:)(?=\s)/, ['', 'type', 'delimiter'], '@dialogue'],
        [/^\s*(?=")/, '', '@quoted'],
        [/^\s*(?=[A-Za-z_À-￿])/, '', '@command'],
        [/\s+/, ''],
      ],
      dialogue: [
        [/\s#[A-Za-z0-9]{4,8}(?=\s*$)/, 'meta.id'],
        [/\{[^}]*\}/, 'tag'],
        [/\[[A-Za-z_À-￿][\wÀ-￿]*\]/, 'variable'],
        [/[^{\[\s]+/, 'string'],
        [/\s+/, 'string'],
        [/./, 'string'],
        [/$/, '', '@pop'],
      ],
      quoted: [
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/\s#[A-Za-z0-9]{4,8}(?=\s*:?\s*$)/, 'meta.id'],
        [/\bif\b/, 'keyword'],
        [/[0-9]+(\.[0-9]+)?(?:ms|s)?/, 'number'],
        [/[A-Za-z_À-￿][\wÀ-￿]*/, 'identifier'],
        [/[<>=!+\-*\/%():]+/, 'delimiter'],
        [/\s+/, ''],
        [/$/, '', '@pop'],
      ],
      command: [
        [/[A-Za-z_À-￿][\wÀ-￿]*(?==)/, 'attribute.name'],
        [/[A-Za-z_À-￿][\wÀ-￿]*/, { cases: { '@keywords': 'keyword', '@modifiers': 'keyword.other', '@default': 'identifier' } }],
        [/#[0-9a-fA-F]{3,8}/, 'number.hex'],
        [/[0-9]+(\.[0-9]+)?(?:ms|s)?/, 'number'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/[<>=!+\-*\/%():]+/, 'delimiter'],
        [/\s+/, ''],
        [/$/, '', '@pop'],
      ],
    },
  });
}

function defineTheme() {
  monaco.editor.defineTheme('vn-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '6b7385', fontStyle: 'italic' },
      { token: 'meta.id', foreground: '4a5163' },
      { token: 'type', foreground: '5fd1c3', fontStyle: 'bold' },
      { token: 'type.identifier', foreground: '5fd1c3' },
      { token: 'keyword', foreground: '9db8ff' },
      { token: 'keyword.other', foreground: 'c1a6ff' },
      { token: 'string', foreground: 'e3d9b4' },
      { token: 'tag', foreground: 'e8b64c' },
      { token: 'variable', foreground: 'f0a1c0' },
      { token: 'number', foreground: 'b5e08f' },
      { token: 'number.hex', foreground: 'b5e08f' },
      { token: 'attribute.name', foreground: '8fc7e8' },
    ],
    colors: { 'editor.background': '#0e1117', 'editor.lineHighlightBackground': '#171b2380' },
  });
}

/** Ctrl+Space and the trigger characters: the engine's completions for the line, with paths replacing everything typed since the quote. */
function registerCompletions(host: { liveRigs(): Record<string, RigManifest> }) {
  const K = monaco.languages.CompletionItemKind;
  const kinds: Record<string, number> = {
    command: K.Keyword, keyword: K.EnumMember, character: K.Class, label: K.Reference, variable: K.Variable, asset: K.Value,
  };
  monaco.languages.registerCompletionItemProvider('vn', {
    triggerCharacters: [' ', '{', '[', ':'],
    provideCompletionItems(model: any, position: any) {
      const prefix = model.getValueInRange({
        startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column,
      });
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      };
      const typed = /[^\s"=]*$/.exec(prefix)![0].length;
      const pathRange = { ...range, startColumn: position.column - typed };
      // A typed `{` was closed by the editor: a text tag brings its own `}`, so it takes the one that is waiting after the cursor.
      const closed = model.getValueInRange({ ...range, startColumn: position.column, endColumn: position.column + 1 }) === '}';
      const tagRange = { ...range, endColumn: range.endColumn + 1 };
      const above = model.getLinesContent().slice(Math.max(0, position.lineNumber - 13), position.lineNumber - 1);
      const inScreen = insideScreen(model.getLinesContent().slice(0, position.lineNumber - 1), /^\s/.test(prefix));
      return {
        suggestions: getCompletions(S.program, prefix, host.liveRigs(), above, inScreen, S.projectAssets.files).map((s, i) => ({
          label: s.label,
          kind: kinds[s.kind] ?? K.Text,
          detail: s.detail,
          insertText: s.insertText ?? s.label,
          insertTextRules: s.insertText?.includes('$0') ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          sortText: String(i).padStart(3, '0'),
          range: s.path ? pathRange : closed && s.insertText?.includes('}') ? tagRange : range, // a path holds `/` and `.`, which end a word: replace everything typed since the quote, space or `=`
        })),
      };
    },
  });
}

function registerQuickFixes() {
  // Quick fixes (Ctrl+.) for the markers with a "did you mean": replace the unknown word with a close name.
  monaco.languages.registerCodeActionProvider('vn', {
    provideCodeActions(model: any, _range: any, context: any) {
      const actions = (context.markers as any[]).flatMap(m => {
        const options = quickFixes.get(fixKey(model.uri, m.startLineNumber, m.message)) ?? [];
        return options.map((o, i) => ({
          title: `Change to "${o}"`,
          kind: 'quickfix',
          diagnostics: [m],
          isPreferred: i === 0,
          edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: {
            range: { startLineNumber: m.startLineNumber, endLineNumber: m.endLineNumber, startColumn: m.startColumn, endColumn: m.endColumn },
            text: o,
          } }] },
        }));
      });
      return { actions, dispose() {} };
    },
  });
}
