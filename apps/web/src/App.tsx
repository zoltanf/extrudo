import { lazy, Suspense, useEffect } from 'react';
import { HomeScreen } from './home/HomeScreen';
import type { Platform } from './platform';
import { ProjectPage } from './project/ProjectPage';
import { HOME_HREF, useRoute } from './routes';

// Loaded on demand: the kernel client and the debug page aren't part of the app.
const KernelDebug = lazy(() =>
  import('./debug/KernelDebug').then((m) => ({ default: m.KernelDebug })),
);

/** Hash routes (Electron-safe, architecture §8): home, a project, debug pages. */
export function App({ platform }: { platform: Platform }) {
  const route = useRoute();
  switch (route.page) {
    case 'home':
      return <HomeScreen platform={platform} />;
    case 'project':
      return <ProjectPage key={route.id} id={route.id} platform={platform} />;
    case 'debug-kernel':
      return (
        <Suspense fallback={null}>
          <KernelDebug platform={platform} />
        </Suspense>
      );
    case 'not-found':
      return <Redirect to={HOME_HREF} />;
  }
}

function Redirect({ to }: { to: string }) {
  useEffect(() => window.location.replace(to), [to]);
  return null;
}
