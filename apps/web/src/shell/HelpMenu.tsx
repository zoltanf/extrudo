import {
  BookOpen,
  CircleHelp,
  Code,
  GraduationCap,
  Info,
  ListChecks,
  RefreshCw,
  Search,
  Shapes,
  Wrench,
} from 'lucide-react';
import { keysFor } from '../commands/keymap';
import { shortcutLabel } from '../commands/shortcuts';
import { IconButton, Menu, MenuItem, MenuLabel, MenuSeparator } from '../design-system';
import type { DocsPage } from './docsLinks';

/** A command's first key as it reads here ("Ctrl+K"). */
const keyLabel = (id: string) => {
  const keys = keysFor(id)[0];
  return keys && shortcutLabel(keys);
};

/** Every handler is optional: an item shows only when the page can do it. */
export interface HelpMenuProps {
  /** Opens the search, centred. */
  onSearch?(): void;
  /** Starts the tutorial (P3-12). */
  onTutorial?(): void;
  /** Opens a docs page (P6-06 S9): the User Guide, Tutorials, Examples and Tool Reference. */
  onDocs?(page: DocsPage): void;
  /** Runs the `help` command: the page of the tool last hovered, else the guide. */
  onHelp?(): void;
  /** Check for Updates… (desktop only, ADR-0075's 2026-10-09 amendment). */
  onCheckUpdates?(): void;
  /** Source on GitHub (ADR-0079 round 5). */
  onSource?(): void;
  /** About Extrudo (ADR-0085). */
  onAbout?(): void;
}

/**
 * The Help menu of the app bar and the home screen: search, the tutorial, the
 * docs on the landing site (ADR-0080 §5), updates and About. F1 is the help
 * command's key ("Help for This Tool").
 */
export function HelpMenu({
  onSearch,
  onTutorial,
  onDocs,
  onHelp,
  onCheckUpdates,
  onSource,
  onAbout,
}: HelpMenuProps) {
  const docs = onDocs !== undefined;
  return (
    <Menu
      label="Help"
      align="end"
      trigger={
        <IconButton label="Help">
          <CircleHelp size={18} strokeWidth={1.75} />
        </IconButton>
      }
    >
      <MenuLabel>Help</MenuLabel>
      {onSearch && (
        <>
          <MenuItem icon={<Search size={14} />} shortcut={keyLabel('search')} onSelect={onSearch}>
            Search…
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      {/* Five steps that build a box (P3-12). */}
      {onTutorial && (
        <>
          <MenuItem icon={<GraduationCap size={14} />} onSelect={onTutorial}>
            Tutorial
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      {docs && (
        <>
          <MenuItem icon={<BookOpen size={14} />} onSelect={() => onDocs('guide')}>
            User Guide
          </MenuItem>
          {onHelp && (
            <MenuItem icon={<CircleHelp size={14} />} shortcut={keyLabel('help')} onSelect={onHelp}>
              Help for This Tool
            </MenuItem>
          )}
          <MenuItem icon={<ListChecks size={14} />} onSelect={() => onDocs('tutorials')}>
            Tutorials
          </MenuItem>
          <MenuItem icon={<Shapes size={14} />} onSelect={() => onDocs('examples')}>
            Examples
          </MenuItem>
          <MenuItem icon={<Wrench size={14} />} onSelect={() => onDocs('tools')}>
            Tool Reference
          </MenuItem>
        </>
      )}
      {onCheckUpdates && (
        <>
          <MenuSeparator />
          <MenuItem icon={<RefreshCw size={14} />} onSelect={onCheckUpdates}>
            Check for Updates…
          </MenuItem>
        </>
      )}
      {onSource && (
        <>
          <MenuSeparator />
          <MenuItem icon={<Code size={14} />} onSelect={onSource}>
            Source on GitHub
          </MenuItem>
        </>
      )}
      {onAbout && (
        <>
          <MenuSeparator />
          <MenuItem icon={<Info size={14} />} onSelect={onAbout}>
            About Extrudo
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
