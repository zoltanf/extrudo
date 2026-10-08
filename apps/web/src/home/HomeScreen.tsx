import type { ProjectSummary } from '@extrudo/storage';
import {
  ArrowLeft,
  GraduationCap,
  HardDrive,
  Import,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  IconButton,
  LogoMark,
  Select,
  TextInput,
  Toasts,
  Tooltip,
  useTheme,
  useToasts,
  Wordmark,
} from '../design-system';
import { requestTutorial, tourOffered, writeTour } from '../onboarding/state';
import type { Persistence, Platform } from '../platform';
import {
  createProject,
  createTutorialProject,
  describeError,
  exportProject,
  importProject,
} from '../project/actions';
import { exampleHref, navigate, projectHref } from '../routes';
import { ThemeMenu } from '../shell/ThemeMenu';
import { useUpdateNotice } from '../shell/useUpdateNotice';
import { EXAMPLES } from './examples';
import { TEMPLATES, type Template } from './gallery';
import { usePersistence, useProjects } from './hooks';
import { LinkedFolderSection } from './LinkedFolderSection';
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
  useUpdateNotice(push, platform);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('modified');
  const [showTrash, setShowTrash] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [purging, setPurging] = useState<ProjectSummary>();
  const now = new Date();

  const run = (action: () => Promise<unknown>, failure: string) =>
    action()
      .catch((e: unknown) => push('error', `${failure}: ${describeError(e)}`))
      .finally(() => void refresh());

  const open = (id: string) => navigate(projectHref(id));
  const start = () =>
    createProject(platform)
      .then(open)
      .catch((e: unknown) => push('error', `Couldn't create the design: ${describeError(e)}`));
  // A template is a copy under a new ID, with its picture for the card (P3-12).
  const [starting, setStarting] = useState<string>();
  const startTemplate = (t: Template) => {
    setStarting(t.id);
    Promise.all([
      t.create(),
      fetch(t.thumbnail)
        .then((r) => r.blob())
        .catch(() => undefined),
    ])
      .then(([doc, thumbnail]) => createProject(platform, doc, thumbnail))
      .then(open)
      .catch((e: unknown) => push('error', `Couldn't start from the template: ${describeError(e)}`))
      .finally(() => setStarting(undefined));
  };
  // The tutorial is offered once (P3-12): started, dismissed or finished, the card is gone.
  const [tourCard, setTourCard] = useState(() => tourOffered(platform.preferences));
  const startTour = () =>
    createTutorialProject(platform)
      .then((id) => {
        requestTutorial(id);
        writeTour(platform.preferences, 'started');
        open(id);
      })
      .catch((e: unknown) => push('error', `Couldn't create the design: ${describeError(e)}`));
  const dismissTour = () => {
    writeTour(platform.preferences, 'dismissed');
    setTourCard(false);
  };
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
                  {/* Muted grey falls below 4.5:1 on the accent tint (P3-13 axe audit). */}
                  <span className="text-sm text-ink/75">An empty design in millimetres.</span>
                </button>
                {tourCard && (
                  <div className="relative flex min-h-32 rounded-card border border-line bg-raised transition-colors duration-(--x-fast) hover:border-accent">
                    <button
                      type="button"
                      onClick={() => void startTour()}
                      className="flex flex-1 flex-col items-start justify-end gap-1 rounded-card p-4 text-left"
                    >
                      <span className="mb-auto grid size-10 place-items-center rounded-control bg-accent-soft text-ink">
                        <GraduationCap size={22} strokeWidth={1.75} />
                      </span>
                      <span className="text-lg font-semibold">Take the tour</span>
                      <span className="text-sm text-muted">
                        Build your first box in five short steps.
                      </span>
                    </button>
                    <IconButton
                      label="Dismiss the tour"
                      className="absolute top-2 right-2 size-7"
                      onClick={dismissTour}
                    >
                      <X size={14} />
                    </IconButton>
                  </div>
                )}
              </div>
            </section>
          )}

          {!showTrash && (
            <section aria-labelledby="templates-heading" className="flex flex-col gap-3">
              <h2
                id="templates-heading"
                className="text-xs font-semibold tracking-[0.08em] text-muted uppercase"
              >
                Start from a template
              </h2>
              <ul
                aria-label="Templates"
                className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
              >
                {TEMPLATES.map((t) => (
                  <li key={t.id} className="flex">
                    <button
                      type="button"
                      disabled={starting !== undefined}
                      onClick={() => startTemplate(t)}
                      aria-label={`Start from the ${t.name} template`}
                      aria-describedby={`template-${t.id}`}
                      className="group flex w-full flex-col rounded-card border border-line bg-raised text-left transition-colors duration-(--x-fast) hover:border-accent focus-visible:border-accent disabled:opacity-60"
                    >
                      <span
                        className="block aspect-[4/3] overflow-hidden rounded-t-card"
                        style={{ background: 'var(--x-viewport-glow)' }}
                      >
                        <img
                          src={t.thumbnail}
                          alt=""
                          className="size-full object-contain transition-transform duration-(--x-normal) ease-ui group-hover:scale-[1.03]"
                          draggable={false}
                        />
                      </span>
                      <span className="flex flex-col gap-0.5 px-3 py-2">
                        <span className="font-semibold">{t.name}</span>
                        <span id={`template-${t.id}`} className="text-sm text-muted">
                          {t.summary}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div>
                <Button variant="ghost" onClick={() => setShowExamples(true)}>
                  More examples…
                </Button>
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

          {!showTrash && <LinkedFolderSection platform={platform} push={push} />}
        </div>
      </main>

      <ExamplesDialog open={showExamples} onOpenChange={setShowExamples} />
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

/**
 * More examples… (P6-06 S3): the example library, one row per example with
 * its level and description. Open navigates to `#/example/<id>`, the same
 * code path a link to the example runs (a copy is made there). No thumbnails
 * yet — slice S4 records them.
 */
function ExamplesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Examples"
      description="Each opens as a copy you can edit."
      size="medium"
    >
      <ul aria-label="Examples" className="flex flex-col divide-y divide-line">
        {EXAMPLES.map((e) => (
          <li key={e.id} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {e.title} <span className="text-xs font-normal text-muted">{e.level}</span>
              </p>
              <p className="text-sm text-muted">{e.description}</p>
            </div>
            <Button
              variant="ghost"
              aria-label={`Open the ${e.title} example`}
              onClick={() => navigate(exampleHref(e.id))}
            >
              Open
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
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
