import { type BodyId, type DocumentStore, updateBody } from '@extrudo/core';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Video,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useStore } from 'zustand';
import { IconButton, ToolIcon } from '../design-system';

export const BROWSER_ID = 'browser-panel';

export interface BrowserPanelProps {
  store: DocumentStore;
  width: number;
  collapsed: boolean;
  onToggle(): void;
}

/**
 * The browser (UI spec §2): document settings, views, origin, sketches and
 * bodies. Built from the document; the eye on a body is a real, undoable
 * visibility change. Hover highlighting and renaming come with P2-08.
 */
export function BrowserPanel({ store, width, collapsed, onToggle }: BrowserPanelProps) {
  const doc = useStore(store, (s) => s.doc);

  if (collapsed) {
    return (
      <aside
        id={BROWSER_ID}
        aria-label="Browser"
        className="flex w-10 shrink-0 flex-col items-center border-r border-line bg-panel py-2"
      >
        <IconButton label="Show browser" onClick={onToggle}>
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </IconButton>
      </aside>
    );
  }

  const sketches = doc.features.filter((f) => f.type === 'sketch');
  const bodies = Object.entries(doc.bodies) as [BodyId, (typeof doc.bodies)[BodyId]][];

  return (
    <aside
      id={BROWSER_ID}
      aria-label="Browser"
      style={{ width }}
      className="flex shrink-0 flex-col overflow-hidden bg-panel"
    >
      <div className="flex h-9 items-center justify-between pr-1 pl-3">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">Browser</h2>
        <IconButton label="Hide browser" onClick={onToggle}>
          <PanelLeftClose size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 text-base">
        <Folder label="Document settings" icon={<Settings2 size={14} />} defaultOpen={false}>
          <Leaf>
            Units{' '}
            <span className="ml-auto font-mono text-field text-muted">{doc.settings.units}</span>
          </Leaf>
        </Folder>
        <Folder label="Named views" icon={<Video size={14} />} defaultOpen={false}>
          <Leaf muted>
            {doc.views.length === 0 ? 'No named views yet' : `${doc.views.length} views`}
          </Leaf>
        </Folder>
        <Folder label="Origin" icon={<ToolIcon name="axis" category="construct" size={16} />}>
          {['XY plane', 'XZ plane', 'YZ plane', 'X axis', 'Y axis', 'Z axis'].map((o) => (
            <Leaf key={o}>{o}</Leaf>
          ))}
        </Folder>
        <Folder
          label="Sketches"
          icon={<ToolIcon name="create-sketch" category="sketch" size={16} />}
        >
          {sketches.length === 0 ? (
            <Leaf muted>No sketches yet</Leaf>
          ) : (
            sketches.map((s) => <Leaf key={s.id}>{s.name}</Leaf>)
          )}
        </Folder>
        <Folder label="Bodies" icon={<Box size={14} />}>
          {bodies.length === 0 ? (
            <Leaf muted>No bodies yet</Leaf>
          ) : (
            bodies.map(([id, body]) => (
              <Leaf key={id}>
                <span className={body.visible ? '' : 'text-muted'}>{body.name}</span>
                <IconButton
                  label={`${body.visible ? 'Hide' : 'Show'} ${body.name}`}
                  className="ml-auto size-6"
                  onClick={() =>
                    store
                      .getState()
                      .dispatch(updateBody({ id, changes: { visible: !body.visible } }))
                  }
                >
                  {body.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </IconButton>
              </Leaf>
            ))
          )}
        </Folder>
      </ul>
    </aside>
  );
}

function Folder({
  label,
  icon,
  defaultOpen = true,
  children,
}: {
  label: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1.5 rounded-input px-1 text-left hover:bg-accent-soft"
      >
        <span className="text-muted">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="grid w-4 place-items-center text-muted">{icon}</span>
        {label}
      </button>
      {open && <ul className="pb-1">{children}</ul>}
    </li>
  );
}

function Leaf({ muted, children }: { muted?: boolean; children: ReactNode }) {
  return (
    <li
      className={`flex h-7 items-center gap-1.5 rounded-input pr-1 pl-[46px] ${muted ? 'text-muted' : ''}`}
    >
      {children}
    </li>
  );
}
