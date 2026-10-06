import { autocompletion, closeCompletion, completionStatus } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { evaluateParameters } from '@extrudo/core';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { scriptCompletions, scriptDiagnostics } from './scriptSupport';
import type { DialogExtraProps } from './spec';

const theme = EditorView.theme({
  '&': {
    height: '320px',
    color: 'var(--x-ink)',
    backgroundColor: 'var(--x-bg)',
    border: '1px solid var(--x-line)',
    borderRadius: '6px',
  },
  '.cm-scroller': {
    height: '100%',
    fontFamily: 'var(--x-font-mono)',
    fontSize: '12px',
    lineHeight: '20px',
    overflow: 'auto',
  },
  '.cm-content': { minHeight: '320px', caretColor: 'var(--x-ink)' },
  '.cm-gutters': {
    backgroundColor: 'var(--x-panel)',
    color: 'color-mix(in srgb, var(--x-muted) 80%, var(--x-ink))',
    borderColor: 'var(--x-line)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--x-accent-soft)' },
  '.cm-cursor': { borderLeftColor: 'var(--x-ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--x-accent-soft)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--x-raised)',
    color: 'var(--x-ink)',
    borderColor: 'var(--x-line)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--x-accent)',
    color: 'var(--x-on-accent)',
  },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--x-error)',
  },
});

const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.comment, color: 'color-mix(in srgb, var(--x-muted) 80%, var(--x-ink))' },
    {
      tag: [tags.keyword, tags.operator],
      color: 'color-mix(in srgb, var(--x-accent) 60%, var(--x-ink))',
    },
    {
      tag: [tags.string, tags.number, tags.bool],
      color: 'color-mix(in srgb, var(--x-success) 60%, var(--x-ink))',
    },
    { tag: [tags.variableName, tags.propertyName, tags.typeName], color: 'var(--x-ink)' },
  ]),
);

/**
 * The same editor, read only (P5-05's Macro dialog): the recorded code to read, select and copy.
 * It keeps the focus order of a page: Tab leaves it, since nothing here is typed.
 */
export function CodeView({ code, label }: { code: string; label: string }) {
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!parent.current) return;
    const editor = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: code,
        extensions: [
          basicSetup,
          theme,
          highlighting,
          javascript({ typescript: true }),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ 'aria-label': label, tabindex: '0' }),
        ],
      }),
    });
    return () => editor.destroy();
  }, [code, label]);
  return <div ref={parent} data-macro-code className="max-h-80 overflow-hidden" />;
}

export function ScriptEditor({ open, controller }: DialogExtraProps) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const language = useRef(new Compartment());
  const current = useRef({ open, controller });
  current.current = { open, controller };
  const code = open.values.choices.code ?? '';
  const lang = open.values.choices.language ?? 'ts';
  useEffect(() => {
    if (!parent.current) return;
    const editor = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: current.current.open.values.choices.code ?? '',
        extensions: [
          basicSetup,
          theme,
          highlighting,
          lintGutter(),
          language.current.of(
            javascript({ typescript: current.current.open.values.choices.language !== 'js' }),
          ),
          EditorView.contentAttributes.of({
            'aria-label': 'Script code',
            tabindex: '0',
            'aria-describedby': 'script-key-help',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              update.view.setTabFocusMode(false);
              current.current.controller.setChoice('code', update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            focus: (_event, v) => {
              v.setTabFocusMode(false);
            },
          }),
          autocompletion({
            override: [
              (ctx) => {
                const doc = current.current.controller.context()?.doc;
                const params = doc
                  ? Object.fromEntries(
                      [...evaluateParameters(doc).parameters].flatMap(([name, { result }]) =>
                        result.ok ? [[name, result.value]] : [],
                      ),
                    )
                  : {};
                return scriptCompletions(ctx.state.sliceDoc(0, ctx.pos), params) ?? null;
              },
            ],
          }),
          Prec.highest(
            keymap.of([
              {
                key: 'Escape',
                run: (v) => {
                  if (completionStatus(v.state)) return closeCompletion(v);
                  v.setTabFocusMode(true);
                  return true;
                },
              },
              {
                key: 'Tab',
                run: (v) => {
                  return indentWithTab.run?.(v) ?? false;
                },
              },
            ]),
          ),
        ],
      }),
    });
    view.current = editor;
    const stop = (event: Event) => event.stopPropagation();
    editor.dom.addEventListener('keydown', stop);
    return () => {
      editor.dom.removeEventListener('keydown', stop);
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    // Switching language preserves the editor's text undo history.
    editor.dispatch({
      effects: language.current.reconfigure(javascript({ typescript: lang === 'ts' })),
    });
  }, [lang]);
  useEffect(() => {
    const editor = view.current;
    if (editor)
      editor.dispatch(
        setDiagnostics(
          editor.state,
          scriptDiagnostics(code, open.preview.pending ? undefined : open.preview.status),
        ),
      );
  }, [code, open.preview.pending, open.preview.status]);
  const run = open.preview.status?.script;
  return (
    <>
      <div ref={parent} className="max-h-80 overflow-hidden" />
      <p id="script-key-help" className="text-xs text-muted">
        Tab indents. Press Esc, then Tab to leave the editor. Use Cancel to close.
      </p>
      <section
        aria-label="Script output"
        className="max-h-40 overflow-auto rounded-input border border-line bg-panel p-2 font-mono text-xs"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users scroll the output
        tabIndex={0}
      >
        <pre className="whitespace-pre-wrap">
          {run?.log.length ? run.log.join('\n') : 'No output'}
        </pre>
      </section>
      <p data-script-made={run?.generated.length ?? 0} className="text-sm text-muted">
        Made {run?.generated.length ?? 0} features
      </p>
    </>
  );
}
