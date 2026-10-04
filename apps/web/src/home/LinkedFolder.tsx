/**
 * The linked folder on the home screen (FR-PRJ-06, P4-09, ADR-0065 §3): one
 * folder of `.extrudo` files on disk that Extrudo reads and writes beside the
 * designs it keeps in the browser. Only where the browser has the File System
 * Access API (Chromium); elsewhere the section is not drawn at all.
 *
 * The card list is a component of its own with the state passed in, so what
 * each state says can be checked without a browser.
 */
import { FolderOpen, FolderSync, RefreshCw, Unlink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, IconButton, Tooltip } from '../design-system';
import type { FolderFile, FolderLink, LinkedFolders } from '../platform';
import { describeError } from '../project/actions';
import { formatModified } from './time';

export type LinkedFolderState =
  /** Reading the folder: what was linked, and whether we may use it. */
  | { kind: 'loading' }
  /** No folder is linked. */
  | { kind: 'none' }
  /** Linked, but the browser needs permission again (a `Reconnect` click). */
  | { kind: 'needs-permission'; folder: string }
  /** Linked and usable: the `.extrudo` files at its top level. */
  | { kind: 'ready'; folder: string; files: FolderFile[] }
  /** Linked, but reading it failed (it moved, the disk is gone). */
  | { kind: 'error'; folder: string; message: string };

export interface LinkedFolderActions {
  link(): void;
  reconnect(): void;
  unlink(): void;
  open(file: string): void;
  refresh(): void;
}

/** The state a set of files describes, for the cards and the buttons. */
export function linkedFolderState(
  folder: FolderLink | undefined,
  files: FolderFile[] | undefined,
  permission: string | undefined,
): LinkedFolderState {
  if (!folder) return { kind: 'none' };
  if (permission === 'denied') return { kind: 'needs-permission', folder: folder.name };
  if (permission !== 'granted' || !files) {
    return { kind: 'needs-permission', folder: folder.name };
  }
  return { kind: 'ready', folder: folder.name, files };
}

/**
 * The section itself. The region is named "Linked folder"; each file is a card
 * with its name and when it was last written, and opening one imports it as a
 * project linked to that file.
 */
export function LinkedFolderCards({
  state,
  actions,
  opening,
  now = new Date(),
}: {
  state: LinkedFolderState;
  actions: LinkedFolderActions;
  /** The file being imported, so its card can say so. */
  opening?: string;
  now?: Date;
}) {
  const files = state.kind === 'ready' ? state.files : [];
  return (
    <section
      aria-labelledby="linked-folder-heading"
      data-linked-folder={state.kind}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="linked-folder-heading"
          className="mr-auto flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase"
        >
          <FolderSync size={14} aria-hidden="true" />
          Linked folder
        </h2>
        {state.kind !== 'none' && state.kind !== 'loading' && state.kind !== 'error' && (
          <>
            <Tooltip
              label="Read the folder again"
              hint="Extrudo lists the .extrudo files here when the folder changes on disk."
            >
              <IconButton label="Refresh the linked folder" onClick={actions.refresh}>
                <RefreshCw size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip
              label="Forget this folder"
              hint="Extrudo stops writing to it. The files stay where they are."
            >
              <IconButton label="Unlink the folder" onClick={actions.unlink}>
                <Unlink size={14} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>

      {state.kind === 'none' && (
        <Button onClick={actions.link}>
          <FolderOpen size={16} />
          Link a folder…
        </Button>
      )}
      {state.kind === 'needs-permission' && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted">
            Extrudo needs permission to read and write {state.folder}.
          </p>
          <Button onClick={actions.reconnect}>Reconnect</Button>
        </div>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="text-sm text-error">
          Extrudo couldn't read {state.folder}: {state.message}
        </p>
      )}
      {state.kind === 'loading' && <p className="text-sm text-muted">Reading the folder…</p>}
      {state.kind === 'ready' && (
        <>
          <p className="text-sm text-muted">
            {files.length === 0
              ? `${state.folder} has no .extrudo files yet.`
              : `${files.length} ${files.length === 1 ? 'file' : 'files'} in ${state.folder}.`}
          </p>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {files.map((file) => (
              <li key={file.name}>
                <button
                  type="button"
                  data-linked-file={file.name}
                  data-linked-modified={file.modified}
                  disabled={opening !== undefined}
                  onClick={() => actions.open(file.name)}
                  className="flex w-full flex-col rounded-card border border-line bg-raised px-3 py-2 text-left transition-colors duration-(--x-fast) hover:border-accent focus-visible:border-accent disabled:opacity-60"
                >
                  <span className="truncate font-semibold">{file.name}</span>
                  <span className="text-sm text-muted">
                    {opening === file.name ? 'Opening…' : formatModified(file.modified, now)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The folder's files as they are now; read when the section opens and on demand. */
export function useLinkedFolder(folders: LinkedFolders) {
  const [state, setState] = useState<LinkedFolderState>({ kind: 'loading' });

  const read = useCallback(async () => {
    const folder = await folders.current().catch(() => undefined);
    if (!folder) {
      setState({ kind: 'none' });
      return;
    }
    try {
      const permission = await folder.permission();
      const files = permission === 'granted' ? await folder.list() : undefined;
      setState(linkedFolderState(folder, files, permission));
    } catch (error) {
      // The folder is still linked; it just could not be read this time.
      setState({ kind: 'error', folder: folder.name, message: describeError(error) });
    }
  }, [folders]);

  useEffect(() => {
    void read().catch(() => {});
  }, [read]);

  return { state, read };
}
