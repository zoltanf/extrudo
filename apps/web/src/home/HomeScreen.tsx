import type { ProjectSummary } from '@extrudo/storage';
import { ArrowLeft, HardDrive, Import, Plus, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  LogoMark,
  Select,
  TextInput,
  Toasts,
  Tooltip,
  useTheme,
  useToasts,
  Wordmark,
} from '../design-system';
import type { Persistence, Platform } from '../platform';
import { createProject, describeError, exportProject, importProject } from '../project/actions';
import { TEMPLATES } from '../project/templates';
import { navigate, projectHref } from '../routes';
import { ThemeMenu } from '../shell/ThemeMenu';
import { usePersistence, useProjects } from './hooks';
import { type CardActions, ProjectCard } from './ProjectCard';

type Sort = 'modified' | 'name';

/**
 * The home screen (UI spec §6, FR-PRJ-01): new design, templates, the
 * project grid with search and sort, import, and the trash.
 */
export function HomeScreen({ platform }: { platform: Platform }) {
  const { choice, setChoice } = useTheme(platform.preferences);
  const { projects, error, refresh } = useProjects(platform);
  const persistence = usePersistence(platform);
  const { toasts, push, dismiss } = useToasts();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('modified');
  const [showTrash, setShowTrash] = useState(false);
  const [purging, setPurging] = useState<ProjectSummary>();
  const now = new Date();

  const run = (action: () => Promise<unknown>, failure: string) =>
    action()
      .catch((e: unknown) => push('error', `${failure}: ${describeError(e)}`))
      .finally(() => void refresh());

  const open = (id: string) => navigate(projectHref(id));
  const start = (make?: () => Parameters<typeof createProject>[1]) =>
    createProject(platform, make?.())
      .then(open)
      .catch((e: unknown) => push('error', `Couldn't create the design: ${describeError(e)}`));
  const importFile = () =>
    importProject(platform)
      .then((summary) => summary && open(summary.id))
      .catch((e: unknown) => push('error', `Import failed: ${describeError(e)}`));

  const actions: CardActions = {
    rename: (p, name) => run(() => platform.projects.rename(p.id, name), "Couldn't rename"),
    duplicate: (p) => run(() => platform.projects.duplicate(p.id), "Couldn't duplicate"),
    exportFile: (p) =>
      run(async () => {
        push('success', `Exported ${await exportProject(platform, p.id, p.name)}.`);
      }, "Couldn't export"),
    trash: (p) =>
      run(async () => {
        await platform.projects.trash(p.id);
        push('info', `Moved “${p.name}” to the trash.`);
      }, "Couldn't move it to the trash"),
    restore: (p) => run(() => platform.projects.restore(p.id), "Couldn't restore"),
    purge: (p) => setPurging(p),
  };

  const trashed = projects?.filter((p) => p.trashed) ?? [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (projects ?? [])
      .filter((p) => !!p.trashed === showTrash)
      .filter((p) => !q || p.name.toLowerCase().includes(q));
    return sort === 'name'
      ? list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      : list;
  }, [projects, query, sort, showTrash]);

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <LogoMark size={22} title="Extrudo" />
        <Wordmark className="text-[17px]" />
        <div className="flex-1" />
        <StorageBadge persistence={persistence} />
        <ThemeMenu theme={choice} onThemeChange={setChoice} />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-6 py-8">
          {!showTrash && (
            <section aria-labelledby="start-heading" className="flex flex-col gap-3">
              <h2
                id="start-heading"
                className="text-xs font-semibold tracking-[0.08em] text-muted uppercase"
              >
                Start
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                <button
                  type="button"
                  onClick={() => void start()}
                  className="group flex min-h-32 flex-col items-start justify-end gap-1 rounded-card border border-accent/40 bg-accent-soft p-4 text-left transition-colors duration-(--x-fast) hover:border-accent"
                >
                  <span className="mb-auto grid size-10 place-items-center rounded-control bg-accent text-on-accent transition-transform duration-(--x-normal) ease-ui group-hover:-translate-y-0.5">
                    <Plus size={22} strokeWidth={2.25} />
                  </span>
                  <span className="text-lg font-semibold">New design</span>
                  <span className="text-sm text-muted">An empty design in millimetres.</span>
                </button>
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void start(t.create)}
                    aria-label={`Start from the ${t.name} template`}
                    className="flex min-h-32 flex-col items-start justify-end gap-1 rounded-card border border-line bg-raised p-4 text-left transition-colors duration-(--x-fast) hover:border-accent"
                  >
                    <span className="mb-auto text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                      Template
                    </span>
                    <span className="text-lg font-semibold">{t.name}</span>
                    <span className="text-sm text-muted">{t.summary}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="designs-heading" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {showTrash && (
                <Button variant="ghost" className="px-2" onClick={() => setShowTrash(false)}>
                  <ArrowLeft size={16} />
                  Designs
                </Button>
              )}
              <h1
                id="designs-heading"
                className="mr-auto text-2xl font-semibold tracking-[-0.02em]"
              >
                {showTrash ? 'Trash' : 'Your designs'}
              </h1>
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <TextInput
                  type="search"
                  aria-label="Search designs"
                  placeholder="Search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-52 pl-8"
                />
              </div>
              <label htmlFor="home-sort" className="text-sm text-muted">
                Sort
              </label>
              <div className="w-36">
                <Select
                  id="home-sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                >
                  <option value="modified">Last edited</option>
                  <option value="name">Name</option>
                </Select>
              </div>
              {!showTrash && (
                <>
                  <Button onClick={() => void importFile()}>
                    <Import size={16} />
                    Import .extrudo
                  </Button>
                  <Button variant="ghost" onClick={() => setShowTrash(true)}>
                    <Trash2 size={16} />
                    Trash{trashed.length > 0 && ` (${trashed.length})`}
                  </Button>
                </>
              )}
            </div>

            {error ? (
              <p role="alert" className="text-error">
                Couldn't read your designs: {describeError(error)}
              </p>
            ) : projects === undefined ? null : shown.length === 0 ? (
              <p className="rounded-card border border-dashed border-line px-6 py-10 text-center text-muted">
                {query
                  ? `No designs match “${query}”.`
                  : showTrash
                    ? 'The trash is empty.'
                    : 'No designs yet. Start with a new design or a template.'}
              </p>
            ) : (
              <ul
                aria-label={showTrash ? 'Trashed designs' : 'Designs'}
                className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
              >
                {shown.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    platform={platform}
                    actions={actions}
                    now={now}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <ConfirmDialog
        open={!!purging}
        onOpenChange={(open) => !open && setPurging(undefined)}
        title={`Delete “${purging?.name ?? ''}” forever?`}
        description="The design and its thumbnail are removed from this browser. This can't be undone. Export it first if you might need it."
        confirm="Delete forever"
        destructive
        onConfirm={() => {
          const p = purging;
          setPurging(undefined);
          if (p) void run(() => platform.projects.purge(p.id), "Couldn't delete");
        }}
      />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/** Whether the browser keeps the designs for good (FR-PRJ-05, UI spec §6). */
function StorageBadge({ persistence }: { persistence: Persistence | undefined }) {
  if (!persistence) return null;
  if (persistence === 'persistent') {
    return (
      <Tooltip
        label="Stored on this device"
        hint="Your designs are saved in this browser, and it won't clear them to free up space."
      >
        <span className="inline-flex items-center gap-1.5 px-1.5 text-sm text-muted" tabIndex={-1}>
          <HardDrive size={14} aria-hidden="true" />
          <span role="status" aria-label="Storage">
            Stored on this device
          </span>
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip
      label="Storage may be cleared"
      hint="The browser didn't grant persistent storage, so it may delete your designs when the disk is nearly full. Export important designs as .extrudo files."
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-0.5 text-sm text-ink"
        tabIndex={-1}
      >
        <ShieldAlert size={14} className="text-warning" aria-hidden="true" />
        <span role="status" aria-label="Storage">
          Storage may be cleared
        </span>
      </span>
    </Tooltip>
  );
}
