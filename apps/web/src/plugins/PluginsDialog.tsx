import { Download, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { Button, ConfirmDialog, Dialog, IconButton } from '../design-system';
import type { FileAccess } from '../platform';
import type { DesignPlugin, PluginEntry, PluginsStore } from './plugins';

/** What the list shows and does; pure, so it renders without stores. */
export interface PluginsListProps {
  installed: readonly PluginEntry[] | undefined;
  /** Plugins this design carries that aren't installed. */
  inDesign: readonly DesignPlugin[];
  status: string;
  refused: boolean;
  busy: boolean;
  onInstall(): void;
  onInstallFromDesign(plugin: DesignPlugin): void;
  onEnabled(id: string, enabled: boolean): void;
  onRemove(entry: PluginEntry): void;
}

/**
 * The Plugins dialog's body (P6-03 slice 2, ADR-0077 §6): Install…, a status
 * line, the installed plugins — name, version, description, the "Enabled"
 * checkbox, Remove and their details (the README as **plain text**, the
 * commands and features with their labels and hints, the license) — and the
 * plugins this design carries that aren't installed, each with Install.
 *
 * Test hooks: the list "Installed plugins" with an item per plugin
 * (`data-plugin` = its id), the list "In this design" (`data-design-plugin`),
 * the status line "Plugins status" (`data-refused` when it says why not).
 */
export function PluginsList({
  installed,
  inDesign,
  status,
  refused,
  busy,
  onInstall,
  onInstallFromDesign,
  onEnabled,
  onRemove,
}: PluginsListProps) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <Button variant="primary" disabled={busy} onClick={onInstall}>
          <Upload size={14} /> Install…
        </Button>
        <p
          role="status"
          aria-label="Plugins status"
          {...(refused && { 'data-refused': '' })}
          className={`min-w-0 text-xs ${refused ? 'text-error' : 'text-muted'}`}
        >
          {status}
        </p>
      </div>
      <h3 className="mt-5 mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        Installed
      </h3>
      {installed === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : installed.length === 0 ? (
        <p className="text-sm text-muted">
          No plugins yet. A plugin is a <code>.extrudo-plugin</code> file: install one to add its
          commands to Ctrl+K.
        </p>
      ) : (
        <ul aria-label="Installed plugins" className="flex flex-col divide-y divide-line">
          {installed.map((entry) => (
            <InstalledRow
              key={entry.plugin.id}
              entry={entry}
              busy={busy}
              onEnabled={onEnabled}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
      {inDesign.length > 0 && (
        <>
          <h3 className="mt-5 mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            In this design, not installed
          </h3>
          <ul aria-label="In this design" className="flex flex-col divide-y divide-line">
            {inDesign.map((plugin) => (
              <li
                key={plugin.manifest.id}
                data-design-plugin={plugin.manifest.id}
                className="flex items-center gap-3 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">
                    {plugin.manifest.name}{' '}
                    <span className="text-muted">{plugin.manifest.version}</span>
                  </span>
                  <span className="truncate text-xs text-muted">
                    In this design, not installed · {plugin.manifest.description}
                  </span>
                </div>
                <Button
                  aria-label={`Install ${plugin.manifest.name}`}
                  disabled={busy}
                  onClick={() => onInstallFromDesign(plugin)}
                >
                  <Download size={14} /> Install
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function InstalledRow({
  entry,
  busy,
  onEnabled,
  onRemove,
}: {
  entry: PluginEntry;
  busy: boolean;
  onEnabled(id: string, enabled: boolean): void;
  onRemove(entry: PluginEntry): void;
}) {
  const { plugin, file } = entry;
  const checkbox = `plugin-enabled-${plugin.id}`;
  return (
    <li data-plugin={plugin.id} className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">
            {plugin.name} <span className="text-muted">{plugin.version}</span>
          </span>
          <span className={`truncate text-xs ${entry.error ? 'text-error' : 'text-muted'}`}>
            {entry.error ?? file?.manifest.description}
          </span>
        </div>
        <label htmlFor={checkbox} className="flex items-center gap-1.5 text-sm">
          <input
            id={checkbox}
            type="checkbox"
            checked={plugin.enabled}
            disabled={busy}
            aria-label={`Enabled: ${plugin.name}`}
            onChange={(event) => onEnabled(plugin.id, event.target.checked)}
          />
          Enabled
        </label>
        <IconButton label={`Remove ${plugin.name}`} disabled={busy} onClick={() => onRemove(entry)}>
          <Trash2 size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
      {file && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted">Details</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs text-muted">
              By {file.manifest.author} · {file.manifest.license}
            </p>
            {file.manifest.commands.length > 0 && (
              <section aria-label={`Commands of ${plugin.name}`}>
                <h4 className="text-xs font-semibold">Commands</h4>
                <ul className="list-disc pl-5">
                  {file.manifest.commands.map((command) => (
                    <li key={command.id} data-plugin-command={command.id}>
                      {command.label}
                      {command.hint && <span className="text-muted"> — {command.hint}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {file.manifest.features.length > 0 && (
              <section aria-label={`Features of ${plugin.name}`}>
                <h4 className="text-xs font-semibold">Features</h4>
                <ul className="list-disc pl-5">
                  {file.manifest.features.map((feature) => (
                    <li key={feature.type} data-plugin-feature={feature.type}>
                      {feature.label}
                      {feature.hint && <span className="text-muted"> — {feature.hint}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {file.readme !== undefined && (
              // The README as written, never rendered: a plugin brings no HTML.
              <section aria-label={`README of ${plugin.name}`}>
                <pre
                  // Scrollable, so reachable from the keyboard.
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region
                  tabIndex={0}
                  className="max-h-48 overflow-auto rounded-control bg-sunken p-2 text-xs whitespace-pre-wrap"
                >
                  {file.readme}
                </pre>
              </section>
            )}
            {file.license !== undefined && (
              <section aria-label={`License of ${plugin.name}`}>
                <pre
                  // Scrollable, so reachable from the keyboard.
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region
                  tabIndex={0}
                  className="max-h-32 overflow-auto rounded-control bg-sunken p-2 text-xs whitespace-pre-wrap"
                >
                  {file.license}
                </pre>
              </section>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

export interface PluginsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  plugins: PluginsStore;
  files: FileAccess;
  /** The plugins the open design carries that aren't installed, asked when the dialog opens. */
  inDesign(): Promise<DesignPlugin[]>;
}

/**
 * The Plugins dialog (P6-03 slice 2): File › Plugins… and Ctrl+K "Plugins…".
 * Installing picks a `.extrudo-plugin` file; a refused file says why in the
 * status line (a toast would sit behind the modal dialog). Remove asks first.
 */
export function PluginsDialog({
  open,
  onOpenChange,
  plugins,
  files,
  inDesign,
}: PluginsDialogProps) {
  const installed = useStore(plugins, (s) => s.installed);
  const status = useStore(plugins, (s) => s.status);
  const refused = useStore(plugins, (s) => s.refused);
  const [busy, setBusy] = useState(false);
  const [design, setDesign] = useState<DesignPlugin[]>([]);
  const [removing, setRemoving] = useState<PluginEntry>();

  // What the design carries depends on what is installed: ask again after every change.
  useEffect(() => {
    if (!open || installed === undefined) return;
    let current = true;
    inDesign().then(
      (list) => current && setDesign(list),
      () => current && setDesign([]),
    );
    return () => {
      current = false;
    };
  }, [open, installed, inDesign]);

  useEffect(() => {
    if (open) void plugins.getState().refresh();
  }, [open, plugins]);

  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Plugins"
      description="Plugins add commands that build features in your design. They run sandboxed and can only add features."
      size="medium"
    >
      <PluginsList
        installed={installed}
        inDesign={design}
        status={status}
        refused={refused}
        busy={busy}
        onInstall={() =>
          void run(async () => {
            const file = await files.pick('.extrudo-plugin');
            if (file) await plugins.getState().install(new Uint8Array(await file.arrayBuffer()));
          })
        }
        onInstallFromDesign={(plugin) =>
          void run(() => plugins.getState().install(plugin.bytes, 'from this design'))
        }
        onEnabled={(id, enabled) => void run(() => plugins.getState().setEnabled(id, enabled))}
        onRemove={setRemoving}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(isOpen) => !isOpen && setRemoving(undefined)}
        title={`Remove ${removing?.plugin.name ?? ''}?`}
        description="Its commands leave the app. Designs that use its features keep working: each carries its own copy."
        confirm="Remove"
        destructive
        onConfirm={() => {
          const id = removing?.plugin.id;
          setRemoving(undefined);
          if (id) void run(() => plugins.getState().remove(id));
        }}
      />
    </Dialog>
  );
}
