import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../design-system';
import type { FolderFile } from '../platform';
import {
  type LinkedFolderActions,
  LinkedFolderCards,
  type LinkedFolderState,
  linkedFolderState,
} from './LinkedFolder';

/** A set of files as the folder reports them. */
const files = (names: { name: string; modified: number }[]): FolderFile[] =>
  names.map((f) => ({ ...f, size: 100 }));

const noop = (): LinkedFolderActions => ({
  link: vi.fn(),
  reconnect: vi.fn(),
  unlink: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
});

const markup = (state: LinkedFolderState, opening?: string) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <LinkedFolderCards
        state={state}
        actions={noop()}
        opening={opening}
        now={new Date(10 * 86_400_000)}
      />
    </TooltipProvider>,
  );

describe('the linked folder section (P4-09, ADR-0065 §3)', () => {
  it('offers to link a folder when none is linked', () => {
    const html = markup({ kind: 'none' });
    expect(html).toContain('aria-labelledby="linked-folder-heading"');
    expect(html).toContain('Linked folder');
    expect(html).toContain('>Link a folder…</button>');
    // Nothing to unlink or reconnect yet.
    expect(html).not.toContain('Unlink the folder');
    expect(html).not.toContain('>Reconnect</button>');
  });

  it('says the folder needs permission, and offers to reconnect', () => {
    const html = markup({ kind: 'needs-permission', folder: 'Designs' });
    expect(html).toContain('Extrudo needs permission to read and write Designs.');
    expect(html).toContain('>Reconnect</button>');
    expect(html).toContain('Unlink the folder');
    expect(html).not.toContain('>Link a folder…</button>');
  });

  it('lists the .extrudo files with their names and dates, and nothing else', () => {
    const html = markup({
      kind: 'ready',
      folder: 'Designs',
      files: files([
        { name: 'Bracket.extrudo', modified: 1_000 },
        { name: 'Storage box.extrudo', modified: 2_000 },
      ]),
    });
    expect(html).toContain('2 files in Designs.');
    expect(html).toContain('data-linked-file="Bracket.extrudo"');
    expect(html).toContain('data-linked-file="Storage box.extrudo"');
    // A relative date, as the project cards use.
    expect(html).toContain('1 Jan 1970');
  });

  it('says when the folder has no files yet', () => {
    const html = markup({ kind: 'ready', folder: 'Designs', files: files([]) });
    expect(html).toContain('Designs has no .extrudo files yet.');
    expect(html).not.toContain('data-linked-file');
  });

  it('says which file is being opened, and draws the cards disabled meanwhile', () => {
    const state: LinkedFolderState = {
      kind: 'ready',
      folder: 'Designs',
      files: files([{ name: 'Bracket.extrudo', modified: 1_000 }]),
    };
    const html = markup(state, 'Bracket.extrudo');
    expect(html).toContain('Opening…');
    expect(html).toContain('disabled');
  });

  it('says it is reading the folder before it knows', () => {
    expect(markup({ kind: 'loading' })).toContain('Reading the folder…');
  });
});

describe('the folder state (P4-09)', () => {
  const folder = { name: 'Designs' } as never;

  it('is none without a folder', () => {
    expect(linkedFolderState(undefined, undefined, undefined)).toEqual({ kind: 'none' });
  });

  it('needs permission until the browser says granted', () => {
    expect(linkedFolderState(folder, undefined, 'prompt')).toEqual({
      kind: 'needs-permission',
      folder: 'Designs',
    });
    expect(linkedFolderState(folder, undefined, 'denied')).toEqual({
      kind: 'needs-permission',
      folder: 'Designs',
    });
    // Granted but not read yet (a slow disk): still waiting, not empty.
    expect(linkedFolderState(folder, undefined, 'granted')).toEqual({
      kind: 'needs-permission',
      folder: 'Designs',
    });
  });

  it('is ready with its files once it may be read', () => {
    const listed = files([{ name: 'a.extrudo', modified: 1 }]);
    expect(linkedFolderState(folder, listed, 'granted')).toEqual({
      kind: 'ready',
      folder: 'Designs',
      files: listed,
    });
  });
});
