import type { ProjectSummary } from '@extrudo/storage';
import { Copy, Ellipsis, FolderOpen, Pencil, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  ContextMenu,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  TextInput,
} from '../design-system';
import type { Platform } from '../platform';
import { projectHref } from '../routes';
import { useThumbnailUrl } from './hooks';
import { formatModified } from './time';

export interface CardActions {
  rename(project: ProjectSummary, name: string): void;
  duplicate(project: ProjectSummary): void;
  exportFile(project: ProjectSummary): void;
  trash(project: ProjectSummary): void;
  restore(project: ProjectSummary): void;
  purge(project: ProjectSummary): void;
}

/**
 * A project on the home screen (UI spec §6): thumbnail over the viewport
 * glow, name, last edit, and a menu. The thumbnail is transparent, so the
 * glow behind it follows the theme.
 */
export function ProjectCard({
  project,
  platform,
  actions,
  now,
}: {
  project: ProjectSummary;
  platform: Platform;
  actions: CardActions;
  now: Date;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const thumbnail = useThumbnailUrl(platform, project.id, project.modified, project.hasThumbnail);
  const trashed = !!project.trashed;
  const href = projectHref(project.id);

  const finishRename = (commit: boolean) => {
    setRenaming(false);
    if (commit && draft.trim() && draft.trim() !== project.name) actions.rename(project, draft);
    else setDraft(project.name);
  };

  const menuItems = (
    <>
      <MenuItem
        icon={<FolderOpen size={14} />}
        onSelect={() => {
          window.location.hash = href;
        }}
      >
        Open
      </MenuItem>
      <MenuItem
        icon={<Pencil size={14} />}
        onSelect={() => {
          setDraft(project.name);
          // After the menu has closed and returned focus.
          setTimeout(() => setRenaming(true));
        }}
      >
        Rename
      </MenuItem>
      <MenuItem icon={<Copy size={14} />} onSelect={() => actions.duplicate(project)}>
        Duplicate
      </MenuItem>
      <MenuItem icon={<Upload size={14} />} onSelect={() => actions.exportFile(project)}>
        Export .extrudo
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 size={14} />} onSelect={() => actions.trash(project)}>
        Move to trash
      </MenuItem>
    </>
  );

  const picture = (
    <div
      className="aspect-[4/3] overflow-hidden rounded-t-card"
      style={{ background: 'var(--x-viewport-glow)' }}
    >
      {thumbnail && (
        <img src={thumbnail} alt="" className="size-full object-contain" draggable={false} />
      )}
    </div>
  );

  const card = (
    <li className="group relative flex flex-col rounded-card border border-line bg-raised transition-shadow duration-(--x-fast) hover:shadow-raised focus-within:shadow-raised">
      {picture}
      <div className="flex items-center gap-1 py-2 pr-1.5 pl-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              className="relative z-10"
              onSubmit={(e) => {
                e.preventDefault();
                finishRename(true);
              }}
            >
              <TextInput
                aria-label={`New name for ${project.name}`}
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finishRename(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    finishRename(false);
                  }
                }}
                className="h-7"
              />
            </form>
          ) : trashed ? (
            <h3 className="truncate font-semibold">{project.name}</h3>
          ) : (
            <h3 className="truncate font-semibold">
              {/* The link covers the whole card (::after); the menu sits above it. */}
              <a
                href={href}
                className="rounded-input outline-offset-2 after:absolute after:inset-0 after:rounded-card hover:underline"
              >
                {project.name}
              </a>
            </h3>
          )}
          <p className="truncate text-sm text-muted">
            {trashed
              ? `In the trash since ${formatModified(project.trashed ?? '', now).toLowerCase()}`
              : `Edited ${formatModified(project.modified, now).toLowerCase()}`}
          </p>
        </div>
        {trashed ? (
          <div className="flex gap-1">
            <Button className="h-7 px-2" onClick={() => actions.restore(project)}>
              <RotateCcw size={14} />
              Restore
            </Button>
            <Button variant="danger" className="h-7 px-2" onClick={() => actions.purge(project)}>
              Delete forever
            </Button>
          </div>
        ) : (
          <Menu
            label={`${project.name} actions`}
            align="end"
            trigger={
              <IconButton
                label={`More actions for ${project.name}`}
                className="relative z-10 size-7"
              >
                <Ellipsis size={16} />
              </IconButton>
            }
          >
            {menuItems}
          </Menu>
        )}
      </div>
    </li>
  );
  // The same menu on a right-click anywhere on the card (P3-11); a trashed one has buttons.
  return (
    <ContextMenu label={`${project.name} actions`} disabled={trashed || renaming} trigger={card}>
      {menuItems}
    </ContextMenu>
  );
}
