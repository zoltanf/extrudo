import {
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type DocumentStore,
  type ExtrudoDocument,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import type { ProjectId } from '@extrudo/storage';
import { useEffect, useMemo, useState } from 'react';
import { Button, LogoMark, useToasts } from '../design-system';
import type { Platform } from '../platform';
import { HOME_HREF, navigate, projectHref } from '../routes';
import type { FileActions } from '../shell/AppBar';
import { AppShell } from '../shell/AppShell';
import { createViewportStore, type ViewportStore } from '../viewport/store';
import {
  createProject,
  describeError,
  exportProject,
  importProject,
  loadProject,
  takeOpenNotices,
} from './actions';
import { type Autosaver, allSaved, closeAutosaver, createAutosaver } from './autosave';
import { useRecompute } from './useRecompute';

/** How long a notice about the opened file stays (it is long, and it is in the history after). */
const NOTICE_LIFETIME_MS = 20_000;

type Loaded =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; doc: ExtrudoDocument; hasThumbnail: boolean };

/** `#/p/<id>`: loads a project and opens it in the shell, with autosave (P0-08). */
export function ProjectPage({ id, platform }: { id: string; platform: Platform }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoaded({ kind: 'loading' });
    (async () => {
      // A project that was just closed may still be saving.
      await allSaved();
      const projectId = id as ProjectId;
      const [doc, summary] = await Promise.all([
        loadProject(platform, projectId),
        platform.projects.get(projectId),
      ]);
      if (!cancelled) setLoaded({ kind: 'ready', doc, hasThumbnail: !!summary?.hasThumbnail });
    })().catch((error: unknown) => {
      if (!cancelled) setLoaded({ kind: 'error', message: describeError(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [id, platform]);

  if (loaded.kind === 'loading') {
    return <div className="h-full bg-bg" aria-busy="true" />;
  }
  if (loaded.kind === 'error') {
    return (
      <main className="grid h-full place-items-center bg-bg p-8 text-ink">
        <div className="flex max-w-96 flex-col items-center gap-4 text-center">
          <LogoMark size={40} title="Extrudo" />
          <h1 className="text-xl font-semibold">Couldn't open this design</h1>
          <p className="text-muted" role="alert">
            {loaded.message}
          </p>
          <Button variant="primary" onClick={() => navigate(HOME_HREF)}>
            All designs
          </Button>
        </div>
      </main>
    );
  }
  return (
    <ProjectEditor
      key={loaded.doc.id}
      doc={loaded.doc}
      hasThumbnail={loaded.hasThumbnail}
      platform={platform}
    />
  );
}

function ProjectEditor({
  doc,
  hasThumbnail,
  platform,
}: {
  doc: ExtrudoDocument;
  hasThumbnail: boolean;
  platform: Platform;
}) {
  const store = useMemo(() => createDocumentStore(doc), [doc]);
  const session = useMemo(() => createSessionStore(), []);
  const model = useMemo(() => createModelStore<BodyMesh>(), []);
  const recomputer = useRecompute(store, model);
  const viewport = useMemo(
    () => createViewportStore({ preferences: platform.preferences }),
    [platform],
  );
  const autosave = useAutosave(store, viewport, platform);
  const { toasts, push, dismiss, notifications } = useToasts();
  useFirstThumbnail(doc.id, hasThumbnail, viewport, platform);
  // What opening needed to leave out (a file from a newer Extrudo, P3-13): long, so it stays a while.
  useEffect(() => {
    for (const notice of takeOpenNotices(doc.id))
      push('info', notice, { lifetime: NOTICE_LIFETIME_MS });
  }, [doc.id, push]);

  const file = useMemo<FileActions>(
    () => ({
      home: () => navigate(HOME_HREF),
      newDesign: () => {
        createProject(platform)
          .then((id) => navigate(projectHref(id)))
          .catch((error: unknown) => push('error', describeError(error)));
      },
      exportFile: () => {
        (async () => {
          await autosave?.flush();
          const name = await exportProject(platform, doc.id, store.getState().doc.name);
          push('success', `Exported ${name}.`);
        })().catch((error: unknown) => push('error', describeError(error)));
      },
      importFile: () => {
        importProject(platform)
          .then((summary) => summary && navigate(projectHref(summary.id)))
          .catch((error: unknown) => push('error', `Import failed: ${describeError(error)}`));
      },
    }),
    [platform, autosave, doc.id, store, push],
  );

  if (!autosave) return null;
  return (
    <AppShell
      store={store}
      session={session}
      model={model}
      viewport={viewport}
      autosave={autosave}
      file={file}
      platform={platform}
      notify={push}
      toasts={{ toasts, onDismiss: dismiss, history: notifications }}
      kernel={recomputer}
    />
  );
}

/**
 * One autosaver per open project, created in an effect so React's strict
 * mode (mount, unmount, mount) gets a fresh one. Leaving the page or hiding
 * the tab saves at once; since a closing page may stop that save half-way,
 * unsaved changes also go into a rescue copy first, which the next start
 * recovers (`platform.rescue`). A save that leaves nothing unsaved clears it.
 */
function useAutosave(store: DocumentStore, viewport: ViewportStore, platform: Platform) {
  const [autosave, setAutosave] = useState<Autosaver>();
  useEffect(() => {
    const autosaver = createAutosaver({
      store,
      projects: platform.projects,
      thumbnail: () => viewport.getState().snapshot?.() ?? Promise.resolve(null),
    });
    setAutosave(autosaver);
    const rescue = () => {
      if (autosaver.getState().status !== 'saved') platform.rescue.put(store.getState().doc);
    };
    // Not unsubscribed: the last save after closing clears the copy too.
    autosaver.subscribe((s) => {
      if (s.status === 'saved') platform.rescue.clear(store.getState().doc.id);
    });
    const flush = () => {
      rescue();
      void autosaver.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      rescue();
      closeAutosaver(autosaver);
    };
  }, [store, viewport, platform]);
  return autosave;
}

/** A project without a thumbnail (a new one) gets one once the viewport has drawn. */
function useFirstThumbnail(
  id: ProjectId,
  hasThumbnail: boolean,
  viewport: ViewportStore,
  platform: Platform,
) {
  useEffect(() => {
    if (hasThumbnail) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const take = (snapshot: (() => Promise<Blob | null>) | undefined) => {
      if (!snapshot || timer) return;
      // Let the first frames settle (fonts, the home-view fit).
      timer = setTimeout(async () => {
        const png = await snapshot().catch(() => null);
        if (png) await platform.projects.setThumbnail(id, png).catch(() => {});
      }, 500);
    };
    take(viewport.getState().snapshot);
    const unsubscribe = viewport.subscribe((s) => take(s.snapshot));
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [id, hasThumbnail, viewport, platform]);
}
