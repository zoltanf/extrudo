import { useEffect, useState } from 'react';
import { demoUrl } from './demos';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Whether the user asked for less motion; follows the setting while the page is open. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => globalThis.matchMedia?.(QUERY).matches ?? false);
  useEffect(() => {
    const query = globalThis.matchMedia?.(QUERY);
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * A tool's demo clip for its tooltip (FR-UX-04): a muted loop. It is rendered
 * by the open tooltip only, so the file is fetched on first use. With reduced
 * motion the clip doesn't play: the browser shows its first frame as a still.
 * It is decoration (the words say the same), hidden from assistive tech, and it
 * disappears when the file can't be loaded (offline).
 */
export function ToolDemo({ tool }: { tool: string }) {
  const src = demoUrl(tool);
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <video
      aria-hidden="true"
      tabIndex={-1}
      data-tool-demo={tool}
      data-playing={reduced ? 'false' : 'true'}
      className="mt-2 block aspect-[8/5] w-[236px] rounded-input bg-bg object-cover"
      src={reduced ? `${src}#t=0.01` : src}
      muted
      loop
      playsInline
      disablePictureInPicture
      disableRemotePlayback
      autoPlay={!reduced}
      preload={reduced ? 'metadata' : 'auto'}
      onError={() => setFailed(true)}
    />
  );
}
