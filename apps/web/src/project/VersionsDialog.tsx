import type { VersionSummary } from '@extrudo/storage';
import { History, Save } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Button, Dialog, TextInput, Tooltip } from '../design-system';
import { formatModified } from '../home/time';
import { describeError } from './actions';
import {
  openVersionCopy,
  restoreVersion,
  saveVersion,
  type VersionContext,
  versionLabel,
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
 * version first) and Open as copy (a new design).
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
  const id = ctx.store.getState().doc.id;

  useEffect(() => {
    if (!open) return;
    let current = true;
    setDescription('');
    setVersions(undefined);
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
      <h3 className="mt-5 mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        Saved versions
      </h3>
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
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
