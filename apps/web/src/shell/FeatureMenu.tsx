import { type Feature, type FeatureId, isFeatureVisible, readSketch } from '@extrudo/core';
import {
  ArrowRightToLine,
  CheckCheck,
  ChevronsLeftRight,
  CirclePause,
  CirclePlay,
  Eye,
  EyeOff,
  FileDown,
  Folder,
  FolderOpen,
  Pencil,
  RefreshCcwDot,
  SquareDashedMousePointer,
  TextCursorInput,
  Trash2,
  Undo2,
  Ungroup,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef } from 'react';
import { MenuItem, MenuSeparator, TextInput } from '../design-system';
import type { FeatureActions } from './featureActions';
import type { GroupActions } from './groupActions';
import type { GroupRun } from './timelineGroups';

/**
 * A feature's right-click menu in the timeline and the browser (FR-TL-03):
 * edit sketch or feature, Redefine Plane for a sketch, Fix References and
 * Keep Closest Match when the kernel lost or guessed a reference (FR-TL-05),
 * rename, show/hide, suppress, export a sketch (P1-13), roll the marker to
 * it, move it to the end (P2-11), delete. With two or more chips picked it
 * groups them first (P4-09).
 */
export function FeatureMenuItems({
  feature,
  editable,
  actions,
  onRename,
  position,
  group,
}: {
  feature: Feature;
  /** An active, valid sketch, or a feature with a dialog: offer Edit Sketch / Edit Feature. */
  editable: boolean;
  actions: FeatureActions;
  onRename(): void;
  /** Where it is in the timeline: offers Roll Back to Here and Move to End. */
  position?: { index: number; marker: number; count: number };
  /** The picked chips and the group command, when more than one chip is picked (P4-09). */
  group?: { features: readonly FeatureId[]; actions: GroupActions };
}) {
  const visible = isFeatureVisible(feature);
  const locked = actions.locked() !== undefined;
  const sketch = readSketch(feature) !== undefined;
  const issues = actions.issues(feature.id);
  const guessed = issues.some((i) => i.state === 'guessed' && i.now);
  const edits = editable || sketch || issues.length > 0;
  return (
    <>
      {group && (
        <>
          <MenuItem
            icon={<Folder size={14} />}
            onSelect={() => group.actions.group(group.features)}
          >
            Group {group.features.length} features
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      {editable && (
        <MenuItem icon={<Pencil size={14} />} onSelect={() => actions.edit(feature.id)}>
          {sketch ? 'Edit Sketch' : 'Edit Feature'}
        </MenuItem>
      )}
      {sketch && (
        <MenuItem
          icon={<SquareDashedMousePointer size={14} />}
          disabled={locked}
          onSelect={() => actions.redefinePlane(feature.id)}
        >
          Redefine Plane…
        </MenuItem>
      )}
      {issues.length > 0 && (
        <MenuItem
          icon={<RefreshCcwDot size={14} />}
          disabled={locked}
          onSelect={() => actions.fix(feature.id)}
        >
          Fix References…
        </MenuItem>
      )}
      {guessed && (
        <MenuItem
          icon={<CheckCheck size={14} />}
          disabled={locked}
          onSelect={() => actions.keepClosest(feature.id)}
        >
          Keep Closest Match
        </MenuItem>
      )}
      {edits && <MenuSeparator />}
      <MenuItem icon={<TextCursorInput size={14} />} shortcut="F2" onSelect={onRename}>
        Rename
      </MenuItem>
      <MenuItem
        icon={visible ? <EyeOff size={14} /> : <Eye size={14} />}
        onSelect={() => actions.setVisible([feature.id], !visible)}
      >
        {visible ? 'Hide' : 'Show'}
      </MenuItem>
      <MenuItem
        icon={feature.suppressed ? <CirclePlay size={14} /> : <CirclePause size={14} />}
        disabled={locked}
        onSelect={() => actions.toggleSuppressed(feature.id)}
      >
        {feature.suppressed ? 'Unsuppress' : 'Suppress'}
      </MenuItem>
      {readSketch(feature) && (
        <MenuItem icon={<FileDown size={14} />} onSelect={() => actions.exportSketch(feature.id)}>
          Export SVG or DXF…
        </MenuItem>
      )}
      {position && (
        <>
          <MenuSeparator />
          {position.index + 1 !== position.marker && (
            <MenuItem
              icon={<Undo2 size={14} />}
              disabled={locked}
              onSelect={() => actions.rollTo(position.index + 1)}
            >
              {position.index + 1 < position.marker ? 'Roll Back to Here' : 'Roll Forward to Here'}
            </MenuItem>
          )}
          {position.index < position.count - 1 && (
            <MenuItem
              icon={<ArrowRightToLine size={14} />}
              disabled={locked}
              onSelect={() => actions.move(feature.id, position.count - 1)}
            >
              Move to End
            </MenuItem>
          )}
        </>
      )}
      <MenuSeparator />
      <MenuItem
        icon={<Trash2 size={14} />}
        shortcut="Del"
        disabled={locked}
        onSelect={() => actions.remove(feature.id)}
      >
        Delete
      </MenuItem>
    </>
  );
}

/**
 * A group's menu, on its folded chip or on the label of its open band (P4-09,
 * ADR-0065 §2): rename (F2), expand or collapse it, show or hide every member,
 * suppress or unsuppress them all, and ungroup. Suppressing and hiding are one
 * undo step over the members (core's `groupSuppressed` and `groupVisibility`).
 */
export function GroupMenuItems({
  run,
  actions,
  onRename,
}: {
  run: GroupRun;
  actions: GroupActions;
  onRename(): void;
}) {
  const group = run.group;
  const count = run.members.length;
  return (
    <>
      <MenuItem icon={<TextCursorInput size={14} />} shortcut="F2" onSelect={onRename}>
        Rename
      </MenuItem>
      <MenuItem
        icon={group.collapsed ? <FolderOpen size={14} /> : <ChevronsLeftRight size={14} />}
        onSelect={() => actions.setCollapsed(group.id, !group.collapsed)}
      >
        {group.collapsed ? 'Expand' : 'Collapse'}
      </MenuItem>
      <MenuItem
        icon={run.visible ? <EyeOff size={14} /> : <Eye size={14} />}
        onSelect={() => actions.setVisible(group.id, !run.visible)}
      >
        {run.visible ? 'Hide' : 'Show'}
      </MenuItem>
      <MenuItem
        icon={run.suppressed ? <CirclePlay size={14} /> : <CirclePause size={14} />}
        onSelect={() => actions.setSuppressed(group.id, !run.suppressed)}
      >
        {run.suppressed ? 'Unsuppress' : 'Suppress'}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<Ungroup size={14} />}
        onSelect={() => actions.ungroup(group.id)}
      >{`Ungroup ${count} ${count === 1 ? 'feature' : 'features'}`}</MenuItem>
    </>
  );
}

/**
 * A feature's name as a text field (F2 or Rename). Enter or leaving the
 * field keeps the name; Esc puts the old one back. A refused name (empty)
 * keeps the field open.
 */
export function RenameField({
  name,
  label,
  onCommit,
  onDone,
  className,
}: {
  name: string;
  label: string;
  /** Returns `false` to keep the field open. */
  onCommit(name: string): boolean;
  onDone(): void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const commit = () => {
    if (done.current) return;
    if (onCommit(input.current?.value ?? name)) {
      done.current = true;
      onDone();
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keys typed into the name aren't shortcuts.
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      done.current = true;
      onDone();
    }
  };
  return (
    <TextInput
      ref={input}
      aria-label={label}
      defaultValue={name}
      onKeyDown={onKeyDown}
      onBlur={commit}
      className={className}
    />
  );
}
