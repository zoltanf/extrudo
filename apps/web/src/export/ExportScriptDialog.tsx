import type { DocumentStore, ModelStore, SessionStore } from '@extrudo/core';
import { isExportCancelled, type MeshOptions } from '@extrudo/kernel';
import { Copy, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { Button, Dialog, DialogClose, IconButton } from '../design-system';
import { designCode, scriptFileName } from '../macro/macro';
import type { FileAccess } from '../platform/files';
import type { Preferences } from '../platform/preferences';
import type { BodyEntry } from '../shell/bodies';
import { Choice, Hint } from '../sketch/ExportSketchDialog';
import {
  BodiesField,
  ResolutionField,
  useBodyRows,
  useChosenBodies,
  useResolutionEvaluate,
  useTessellation,
} from './exportFields';
import { type ModelExporter, type Resolution, scadFile } from './modelExport';

export interface ExportScriptDialogProps {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<unknown>;
  /** The model's live bodies, in browser order. */
  bodies: readonly BodyEntry[];
  /** The project's kernel; OpenSCAD needs it, TypeScript doesn't. */
  kernel: ModelExporter | undefined;
  open: boolean;
  files: FileAccess;
  preferences: Preferences;
  onClose(): void;
  notify?(tone: 'info' | 'success' | 'error', text: string): void;
}

type Language = 'ts' | 'scad';

/** What the dialog remembers between exports (preference `export.script`). */
interface Remembered {
  language: Language;
  resolution: Resolution;
  /** Custom deviation and angle, as typed. */
  deviation: string;
  angle: string;
}

const PREFERENCE = 'export.script';
const DEFAULTS: Remembered = {
  language: 'ts',
  resolution: 'medium',
  deviation: '0.02 mm',
  angle: '15 deg',
};
const LANGUAGES: Record<Language, { label: string; ext: string; text: string }> = {
  ts: {
    label: 'TypeScript',
    ext: '.ts',
    text: "Rebuilds the whole design with Extrudo's document API: every sketch, feature and parameter.",
  },
  scad: {
    label: 'OpenSCAD',
    ext: '.scad',
    text: 'Editable OpenSCAD code with a Customizer. Fillets, shells and the like come out as meshes.',
  },
};
const PREVIEW_MAX_LINES = 400;

/** The file Export writes, as the preview shows it. */
interface ScriptFile {
  /** The choices it was written for. */
  key: string;
  text: string;
  blob: Blob;
  name: string;
}

/**
 * Export Design as Script… (ADR-0088 §9, ADR-0073): the design as code you can run or edit,
 * in TypeScript (the whole design through the document API) or OpenSCAD (the P6-09 export of
 * the chosen bodies). The preview shows (up to 400 lines of) the exact file Export writes, and
 * Copy puts all of it on the clipboard.
 */
export function ExportScriptDialog(props: ExportScriptDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(value) => {
        if (!value) props.onClose();
      }}
      size="small"
      title="Export as script"
      description="The design as code you can run or edit."
      actions={
        <DialogClose asChild>
          <IconButton label="Close">
            <X size={18} strokeWidth={1.75} />
          </IconButton>
        </DialogClose>
      }
    >
      <ExportScriptForm {...props} />
    </Dialog>
  );
}

/** The dialog's body, without the dialog around it (the unit test renders this). */
export function ExportScriptForm({
  store,
  session,
  model,
  bodies,
  kernel,
  open,
  files,
  preferences,
  onClose,
  notify = () => {},
}: ExportScriptDialogProps) {
  const doc = useStore(store, (s) => s.doc);
  const status = useStore(model, (s) => s.status);
  const computedDoc = useStore(model, (s) => s.doc);

  const [settings, setSettings] = useState<Remembered>(() => {
    const stored = { ...DEFAULTS, ...preferences.get<Partial<Remembered>>(PREFERENCE, {}) };
    // An unknown stored language falls back to TypeScript.
    return stored.language in LANGUAGES ? stored : { ...stored, language: DEFAULTS.language };
  });
  const update = (change: Partial<Remembered>) =>
    setSettings((current) => {
      const next = { ...current, ...change };
      preferences.set(PREFERENCE, next);
      return next;
    });
  const inScad = settings.language === 'scad';

  // Each opening starts from the selection, or every shown body.
  const request = useMemo(() => (open ? {} : undefined), [open]);
  const { chosen, toggle, toggleMany } = useChosenBodies(bodies, session, request);
  const rows = useBodyRows(bodies, doc.components);
  const selected = useMemo(() => rows.all.filter((b) => chosen.has(b.id)), [rows.all, chosen]);
  const evaluate = useResolutionEvaluate(doc);
  const tessellation = useTessellation(settings, evaluate);
  const current = status === 'ready' && computedDoc === doc;

  // The file is written as soon as the choice settles; Export saves that very text.
  const [written, setWritten] = useState<{ doc: unknown; file: ScriptFile }>();
  const [problem, setProblem] = useState<string>();
  const key = JSON.stringify([
    settings.language,
    inScad ? [selected.map((b) => b.id), tessellation] : null,
  ]);
  const writable = !inScad || (!!kernel && current && !!tessellation && selected.length > 0);
  useEffect(() => {
    setProblem(undefined);
    if (!open || !writable) return;
    // A newer choice or closing the dialog supersedes this write.
    let cancelled = false;
    const timer = setTimeout(() => {
      const write = async (): Promise<ScriptFile> => {
        if (!inScad) {
          const text = await designCode(doc);
          return {
            key,
            text,
            blob: new Blob([text], { type: 'text/plain' }),
            name: scriptFileName(doc.name),
          };
        }
        const file = await scadFile(
          kernel as ModelExporter,
          selected,
          tessellation as MeshOptions,
          doc.name,
        );
        return { key, text: await file.blob.text(), blob: file.blob, name: file.name };
      };
      write().then(
        (file) => {
          if (!cancelled) setWritten({ doc, file });
        },
        (error: unknown) => {
          if (cancelled || isExportCancelled(error)) return;
          setProblem(error instanceof Error ? error.message : String(error));
        },
      );
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, writable, inScad, doc, kernel, tessellation, selected, key]);
  // A closed dialog lets its file go.
  useEffect(() => {
    if (!open) setWritten(undefined);
  }, [open]);
  const file = written?.doc === doc && written.file.key === key ? written.file : undefined;

  const lines = useMemo(() => {
    if (!file) return undefined;
    const all = file.text.split('\n');
    if (all[all.length - 1] === '') all.pop();
    return {
      shown: all.slice(0, PREVIEW_MAX_LINES),
      more: Math.max(0, all.length - PREVIEW_MAX_LINES),
    };
  }, [file]);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let summary: { text: string; tone: 'muted' | 'error' };
  if (!inScad) {
    const parts = [
      doc.features.length > 0 && plural(doc.features.length, 'feature'),
      doc.parameters.length > 0 && plural(doc.parameters.length, 'parameter'),
    ].filter(Boolean);
    summary = {
      text: `The whole design${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`,
      tone: 'muted',
    };
    if (problem) summary = { text: problem, tone: 'error' };
  } else if (!kernel) summary = { text: "The kernel isn't running.", tone: 'error' };
  else if (bodies.length === 0) {
    summary = { text: 'There are no bodies to export. Extrude a sketch first.', tone: 'error' };
  } else if (selected.length === 0) summary = { text: 'Choose a body to export.', tone: 'error' };
  else if (problem) summary = { text: problem, tone: 'error' };
  else if (!current)
    summary = { text: 'Waiting for the model to finish computing…', tone: 'muted' };
  else if (!tessellation) summary = { text: 'Fix the custom resolution.', tone: 'error' };
  else
    summary = {
      text: `${selected.length} ${selected.length === 1 ? 'body' : 'bodies'} as OpenSCAD code`,
      tone: 'muted',
    };

  const language = LANGUAGES[settings.language];
  const canExport = file !== undefined;

  const save = () => {
    if (!file) return;
    files.download(file.blob, file.name);
    notify('success', `Exported ${file.name}.`);
    onClose();
  };
  const copy = () => {
    if (!file) return;
    navigator.clipboard.writeText(file.text).then(
      () => notify('success', 'Copied'),
      () => notify('error', 'The browser did not allow copying. Select the code and copy it.'),
    );
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Choice legend="Language">
        {(Object.keys(LANGUAGES) as Language[]).map((id) => (
          <label
            key={id}
            className={`flex cursor-pointer flex-col rounded-input px-1 py-1 ${
              settings.language === id ? 'bg-accent-soft' : 'hover:bg-accent-soft'
            }`}
          >
            <span className="flex h-5 items-center gap-2">
              <input
                type="radio"
                name="script-language"
                checked={settings.language === id}
                onChange={() => update({ language: id })}
                className="accent-(--x-accent)"
              />
              <span>
                {LANGUAGES[id].label} <Hint>{LANGUAGES[id].ext}</Hint>
              </span>
            </span>
            <span className="pl-6 text-sm text-muted">{LANGUAGES[id].text}</span>
          </label>
        ))}
      </Choice>

      {inScad && (
        <>
          <BodiesField rows={rows} chosen={chosen} toggle={toggle} toggleMany={toggleMany} />
          <ResolutionField
            doc={doc}
            evaluate={evaluate}
            name="script-resolution"
            resolution={settings.resolution}
            deviation={settings.deviation}
            angle={settings.angle}
            onChange={update}
          />
        </>
      )}

      {(lines || (writable && !problem)) && (
        <div className="flex flex-col gap-1">
          <span className="font-semibold">Preview</span>
          {lines ? (
            <pre
              data-script-preview
              className="max-h-60 overflow-auto whitespace-pre rounded-input border border-line p-2 font-mono text-xs"
            >
              {lines.shown.join('\n')}
              {lines.more > 0 && (
                <span className="block text-muted">{`… ${lines.more} more line${lines.more === 1 ? '' : 's'}`}</span>
              )}
            </pre>
          ) : (
            <p className="text-sm text-muted">Writing the preview…</p>
          )}
        </div>
      )}

      <p className="min-h-5 text-sm" aria-live="polite" data-export-summary={summary.text}>
        <span className={summary.tone === 'error' ? 'text-error' : 'text-muted'}>
          {summary.text}
        </span>
      </p>

      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="secondary" disabled={!canExport} onClick={copy}>
          <Copy size={16} strokeWidth={1.75} />
          Copy
        </Button>
        <Button type="submit" variant="primary" disabled={!canExport}>
          Export {language.label}
        </Button>
      </div>
    </form>
  );
}
