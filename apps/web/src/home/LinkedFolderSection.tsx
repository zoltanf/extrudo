/**
 * The linked folder section of the home screen (P4-09, ADR-0065 §3), wired to
 * the folder this browser has linked: link it, reconnect it, forget it, and
 * open one of its files as a project linked to that file. Nothing is drawn
 * where the browser has no File System Access API.
 */
import { useState } from 'react';
import type { Platform } from '../platform';
import { describeError, noteOnOpen } from '../project/actions';
import { navigate, projectHref } from '../routes';
import { type LinkedFolderActions, LinkedFolderCards, useLinkedFolder } from './LinkedFolder';

export function LinkedFolderSection({
  platform,
  push,
}: {
  platform: Platform;
  push(tone: 'info' | 'success' | 'error', text: string): void;
}) {
  const { folders } = platform;
  // Nothing to link in Firefox or Safari: the section isn't there at all.
  return folders ? <LinkedFolder folders={folders} platform={platform} push={push} /> : null;
}

function LinkedFolder({
  folders,
  platform,
  push,
}: {
  folders: NonNullable<Platform['folders']>;
  platform: Platform;
  push(tone: 'info' | 'success' | 'error', text: string): void;
}) {
  const { state, read } = useLinkedFolder(folders);
  const [opening, setOpening] = useState<string>();

  const run = (task: () => Promise<unknown>, failure: string) =>
    task()
      .catch((error: unknown) => push('error', `${failure}: ${describeError(error)}`))
      .finally(() => void read());

  /** Opens a file from the folder: a new project, linked to the file it came from. */
  const open = async (name: string) => {
    setOpening(name);
    try {
      const folder = await folders.current();
      if (!folder) throw new Error('There is no linked folder.');
      const { bytes, modified } = await folder.read(name);
      const notices: string[] = [];
      const summary = await platform.projects.importFile(
        new Blob([bytes as Uint8Array<ArrayBuffer>]),
        { onNotice: (message) => notices.push(message) },
      );
      // The link lives in the project index, not the document (ADR-0065 §3).
      await platform.projects.link(summary.id, { file: name, modified });
      for (const notice of notices) noteOnOpen(summary.id, notice);
      navigate(projectHref(summary.id));
    } catch (error) {
      push('error', `Couldn't open ${name}: ${describeError(error)}`);
      setOpening(undefined);
    }
  };

  const actions: LinkedFolderActions = {
    link: () => run(async () => void (await folders.link()), "Couldn't link that folder"),
    reconnect: () =>
      run(async () => {
        const folder = await folders.current();
        if (!folder) return;
        if (!(await folder.request())) {
          push('error', `Extrudo still may not use ${folder.name}.`);
        }
      }, "Couldn't reconnect the folder"),
    unlink: () =>
      run(async () => {
        // Projects that were linked to a file in it aren't linked any more.
        for (const project of await platform.projects.list()) {
          if (project.linked) await platform.projects.link(project.id, undefined);
        }
        await folders.unlink();
        push('info', 'The folder is unlinked. Its files are still there.');
      }, "Couldn't unlink the folder"),
    refresh: () => void read(),
    open: (name) => void open(name),
  };

  return <LinkedFolderCards state={state} actions={actions} opening={opening} />;
}
