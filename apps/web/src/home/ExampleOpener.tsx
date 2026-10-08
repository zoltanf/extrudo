import { useEffect, useRef } from 'react';
import { useToasts } from '../design-system';
import type { Platform } from '../platform';
import { createProject, describeError } from '../project/actions';
import { HOME_HREF, projectHref, replaceRoute } from '../routes';
import { createFromExample, exampleById } from './examples';

/**
 * The `#/example/<id>` route (P6-06 S3): copies the example's design into a
 * new project (the way `HomeScreen`'s `startTemplate` opens a template, no
 * thumbnail yet) and replaces the route with the project's, so Back doesn't
 * return to the opener. An unknown ID, or a failure to fetch or save, lands
 * on the home screen with a toast instead.
 */
export function ExampleOpener({ id, platform }: { id: string; platform: Platform }) {
  const { push } = useToasts();
  const example = exampleById(id);
  // StrictMode runs an effect twice: the second pass must not open a second
  // project (its toast and navigation would race the first's).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!example) {
      push('error', `There's no example named "${id}".`);
      replaceRoute(HOME_HREF);
      return;
    }
    createFromExample(example)
      .then((doc) => createProject(platform, doc, undefined))
      .then((projectId) => replaceRoute(projectHref(projectId)))
      .catch((e: unknown) => {
        push('error', `Couldn't open the ${example.title} example: ${describeError(e)}`);
        replaceRoute(HOME_HREF);
      });
  }, [example, id, platform, push]);

  if (!example) return null;
  return (
    <div className="grid h-full place-items-center bg-bg text-ink">
      <p role="status" aria-live="polite" className="text-lg text-muted">
        Opening {example.title}…
      </p>
    </div>
  );
}
