import { type Feature, isFeatureVisible, readSketch } from '@extrudo/core';
import {
  CirclePause,
  CirclePlay,
  Eye,
  EyeOff,
  FileDown,
  Pencil,
  TextCursorInput,
  Trash2,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef } from 'react';
import { MenuItem, MenuSeparator, TextInput } from '../design-system';
import type { FeatureActions } from './featureActions';

/**
 * A feature's right-click menu in the timeline and the browser (FR-TL-03,
 * partial): edit sketch, rename, show/hide, suppress, export a sketch
 * (P1-13), delete. "Roll back to
 * here" and "Move to end" come with the draggable marker (P2-11).
 */
export function FeatureMenuItems({
  feature,
  editable,
  actions,
  onRename,
}: {
  feature: Feature;
  /** An active, valid sketch, or a feature with a dialog: offer Edit Sketch / Edit Feature. */
  editable: boolean;
  actions: FeatureActions;
  onRename(): void;
}) {
  const visible = isFeatureVisible(feature);
  const locked = actions.locked() !== undefined;
  return (
    <>
      {editable && (
        <>
          <MenuItem icon={<Pencil size={14} />} onSelect={() => actions.edit(feature.id)}>
            {readSketch(feature) ? 'Edit Sketch' : 'Edit Feature'}
          </MenuItem>
          <MenuSeparator />
        </>
      )}
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
