import type { VersionSummary } from '@extrudo/storage';
import { History, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Button, ConfirmDialog, Dialog, IconButton, TextInput, Tooltip } from '../design-system';
import { formatModified } from '../home/time';
import { describeError } from './actions';
import {
  deleteVersions,
  olderVersions,
  openVersionCopy,
  PRUNE_KEEP,
  restoreVersion,
  saveVersion,
  type VersionContext,
  versionLabel,
  versionsLabel,
} from './versions';

export interface VersionsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  ctx: VersionContext;
  notify(tone: 'info' | 'success' | 'error', text: string): void;
  /** Called before a version is restored: end an open sketch or feature dialog. */
  beforeRestore(): void;
  /** A version was saved as a design of its own: open it. */
  onOpenCopy(id: string): void;
}

const exact = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Save version and version history (FR-PRJ-03, P2-14, UI spec §2): a
 * description field with Save version (Ctrl+S opens the dialog there), and
 * the versions saved so far, newest first, each with Restore (brings it
 * back into this design as one undo step, keeping what is there now as a
 * version first), Open as copy (a new design) and Delete (P3-13); with more
 * than `PRUNE_KEEP` versions, "Delete older versions" keeps the newest.
 * Deleting asks first: it can't be undone.
 *
 * Test hooks: the dialog "Versions", the list "Saved versions" with an
 * item per version (`data-version` = its number).
 */
export function VersionsDialog({
  open,
  onOpenChange,
  ctx,
  notify,
  beforeRestore,
  onOpenCopy,
}: VersionsDialogProps) {
  const [description, setDescription] = useState('');
  const [versions, setVersions] = useState<VersionSummary[]>();
  const [busy, setBusy] = useState(false);
  /** Versions waiting for the user to confirm their deletion. */
  const [deleting, setDeleting] = useState<number[]>();
  /** What the last deletion did, said inside the dialog (toasts sit behind a modal dialog). */
  const [said, setSaid] = useState('');
  const id = ctx.store.getState().doc.id;

  useEffect(() => {
    if (!open) return;
    let current = true;
    setDescription('');
    setVersions(undefined);
    setSaid('');
    ctx.projects.versions(id).then(
      (list) => {
        if (current) setVersions(list);
      },
      (error: unknown) => {
        if (current) {
          setVersions([]);
          notify('error', `Couldn't read the versions: ${describeError(error)}`);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [open, ctx, id, notify]);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (error) {
      notify('error', describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const version = await saveVersion(ctx, description);
      notify('success', `Saved ${versionLabel(version)}.`);
      onOpenChange(false);
    });
  };

  const onRestore = (v: VersionSummary) =>
    run(async () => {
      beforeRestore();
      const { restored, kept } = await restoreVersion(ctx, v.number);
      onOpenChange(false);
      notify(
        'success',
        kept
          ? `Restored ${versionLabel(restored)}. What you had is kept as ${versionLabel(kept)}; Undo brings it back too.`
          : `Restored ${versionLabel(restored)}. Undo brings back what you had.`,
      );
    });

  const onDelete = (numbers: number[]) =>
    run(async () => {
      await deleteVersions(ctx, numbers);
      const gone = new Set(numbers);
      setVersions((list) => list?.filter((v) => !gone.has(v.number)));
      setSaid(`Deleted ${versionsLabel(numbers)}.`);
    });

  const older = versions ? olderVersions(versions) : [];

  const onCopy = (v: VersionSummary) =>
    run(async () => {
      const copy = await openVersionCopy(ctx, v.number);
      onOpenChange(false);
      onOpenCopy(copy);
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Versions"
      description="Save the design as a version to come back to it later."
      size="medium"
    >
      <form className="flex items-end gap-2" onSubmit={onSave}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="version-description" className="text-sm text-muted">
            Description
          </label>
          <TextInput
            id="version-description"
            placeholder="What changed? (optional)"
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" disabled={busy}>
          <Save size={14} /> Save version
        </Button>
      </form>
      <div className="mt-5 mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Saved versions</h3>
        <p role="status" aria-label="Versions status" className="text-xs text-muted">
          {said}
        </p>
      </div>
      {versions === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted">
          No versions yet. A version keeps the design as it is now; restore it or open it as a copy
          any time.
        </p>
      ) : (
        <ol aria-label="Saved versions" className="flex flex-col divide-y divide-line">
          {versions.map((v) => (
            <li key={v.number} data-version={v.number} className="flex items-center gap-3 py-2">
              <span className="grid h-6 min-w-8 place-items-center rounded-control bg-accent-soft px-1.5 font-mono text-xs font-semibold">
                {versionLabel(v)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={`truncate text-sm ${v.description ? '' : 'text-muted'}`}>
                  {v.description || 'No description'}
                </span>
                <span className="truncate text-xs text-muted" title={exact(v.created)}>
                  {formatModified(v.created)}
                  {v.name !== ctx.store.getState().doc.name && ` · ${v.name}`}
                </span>
              </div>
              <Tooltip
                label="Open as copy"
                hint="Opens this version as a new design; this one stays as it is."
              >
                <Button
                  variant="ghost"
                  aria-label={`Open ${versionLabel(v)} as a copy`}
                  disabled={busy}
                  onClick={() => void onCopy(v)}
                >
                  Open copy
                </Button>
              </Tooltip>
              <Tooltip
                label="Restore"
                hint="Brings this version back into the design. What you have now is kept as a version first."
              >
                <Button
                  variant="ghost"
                  aria-label={`Restore ${versionLabel(v)}`}
                  disabled={busy}
                  onClick={() => void onRestore(v)}
                >
                  <History size={14} /> Restore
                </Button>
              </Tooltip>
              <IconButton
                label={`Delete ${versionLabel(v)}`}
                disabled={busy}
                onClick={() => setDeleting([v.number])}
              >
                <Trash2 size={14} strokeWidth={1.75} />
              </IconButton>
            </li>
          ))}
        </ol>
      )}
      {older.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted">
          <span>
            {versions?.length} versions. Keep the newest {PRUNE_KEEP} and delete the {older.length}{' '}
            older?
          </span>
          <Button disabled={busy} onClick={() => setDeleting(older.map((v) => v.number))}>
            <Trash2 size={14} /> Delete older versions
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(isOpen) => !isOpen && setDeleting(undefined)}
        title={`Delete ${versionsLabel(deleting ?? [])}?`}
        description={
          (deleting?.length ?? 0) > 1
            ? `The ${deleting?.length} versions are removed from this design for good. The others keep their numbers. This can't be undone.`
            : "The version is removed from this design for good. The others keep their numbers. This can't be undone."
        }
        confirm="Delete"
        destructive
        onConfirm={() => {
          const numbers = deleting ?? [];
          setDeleting(undefined);
          void onDelete(numbers);
        }}
      />
    </Dialog>
  );
}
