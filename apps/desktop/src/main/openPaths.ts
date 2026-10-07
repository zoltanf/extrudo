/**
 * The queue for files the app is asked to open before it can deliver them
 * (P6-01 slice 2, ADR-0075 §2). A second instance or an `open-file` event can
 * arrive while the window is still loading, and `webContents.send` before the
 * renderer registered its handler is lost; the path waits here until the
 * renderer says it is ready (`app:ready`). Free of Electron, so it is tested in
 * Node.
 */

/** Whether a path names an `.extrudo` file (the association only opens those). */
export function isExtrudoPath(path: string): boolean {
  return path.toLowerCase().endsWith('.extrudo');
}

/** The `.extrudo` path in a command line, if there is one (Windows/Linux argv). */
export function extrudoPathFromArgv(argv: readonly string[]): string | undefined {
  return argv.find((arg) => !arg.startsWith('-') && isExtrudoPath(arg));
}

export interface OpenQueue {
  /** Queues a path; delivers it at once once ready (and delivered). */
  push(path: string): void;
  /** Sets where paths go (main's send to the renderer). */
  deliverWith(deliver: (path: string) => void): void;
  /** The renderer is listening: flush what was queued. */
  ready(): void;
}

export function createOpenQueue(): OpenQueue {
  const pending: string[] = [];
  let deliver: ((path: string) => void) | undefined;
  let isReady = false;

  const flush = () => {
    if (!isReady || !deliver) return;
    while (pending.length > 0) deliver(pending.shift() as string);
  };

  return {
    push(path) {
      if (!path) return;
      pending.push(path);
      flush();
    },
    deliverWith(next) {
      deliver = next;
      flush();
    },
    ready() {
      isReady = true;
      flush();
    },
  };
}
