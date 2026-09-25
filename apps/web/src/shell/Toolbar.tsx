import { ChevronDown, MousePointer2 } from 'lucide-react';
import { type ButtonHTMLAttributes, forwardRef, useEffect, useState } from 'react';
import { shortcutLabel } from '../commands/shortcuts';
import { Menu, MenuItem, MenuLabel, ToolIcon, Tooltip } from '../design-system';
import { TABS, type TabId, TOOLS, type Tool, type ToolId } from './tools';

export interface ToolbarProps {
  /** `sketch` while a sketch is open: the Sketch tab replaces Solid (UI spec §2). */
  mode?: 'model' | 'sketch';
  /** The running tool, shown pressed (Create Sketch while it waits for a plane). */
  activeTool?: ToolId;
  /** Runs a tool that works today (see `Tool.comesWith`). */
  onRun(tool: ToolId): void;
}

/** Workspace switcher, tabs and tool groups (UI spec §2). */
export function Toolbar({ mode = 'model', activeTool, onRun }: ToolbarProps) {
  const home: TabId = mode === 'sketch' ? 'sketch' : 'solid';
  const [tab, setTab] = useState<TabId>(home);
  // Entering or leaving a sketch brings its tab forward.
  useEffect(() => setTab(home), [home]);
  const tabs = TABS.filter((t) => (mode === 'sketch' ? t.id !== 'solid' : t.id !== 'sketch'));
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div className="border-b border-line bg-bg">
      <div className="flex h-8 items-end gap-1 px-2">
        <Menu
          label="Workspace"
          trigger={
            <button
              type="button"
              className="mb-1 inline-flex h-6 items-center gap-1 rounded-input border border-line px-2 text-xs font-semibold tracking-[0.08em] uppercase hover:bg-accent-soft"
            >
              Design
              <ChevronDown size={12} />
            </button>
          }
        >
          <MenuLabel>Workspace</MenuLabel>
          <MenuItem>Design</MenuItem>
        </Menu>
        <div role="tablist" aria-label="Toolbar tabs" className="flex gap-1 pl-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={t.id === active?.id}
              aria-controls="toolbar-groups"
              onClick={() => setTab(t.id)}
              className="h-7 border-b-2 border-transparent px-2.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase hover:text-ink aria-selected:border-accent aria-selected:text-ink"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div
        id="toolbar-groups"
        role="tabpanel"
        aria-labelledby={`tab-${active?.id}`}
        className="flex min-h-[70px] items-stretch gap-1 overflow-x-auto px-2 pt-1 pb-1"
      >
        {active?.groups.map((group, i) => (
          <div key={group.label} className="flex items-stretch">
            {i > 0 && <div className="mx-1.5 my-1.5 w-px bg-line" aria-hidden="true" />}
            <fieldset
              aria-label={group.label}
              className="m-0 flex flex-col items-center border-0 p-0"
            >
              <div className="flex gap-0.5">
                {group.tools.map((id) => (
                  <ToolButton
                    key={id}
                    tool={TOOLS[id]}
                    pressed={activeTool === id}
                    onRun={() => onRun(id)}
                  />
                ))}
              </div>
              <Menu
                label={`${group.label} tools`}
                trigger={
                  <button
                    type="button"
                    className="mt-auto inline-flex items-center gap-0.5 rounded-input px-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-muted uppercase hover:text-ink"
                  >
                    {group.label}
                    <ChevronDown size={10} />
                  </button>
                }
              >
                <MenuLabel>{group.label}</MenuLabel>
                {[...group.tools, ...(group.more ?? [])].map((id) => {
                  const tool: Tool = TOOLS[id];
                  return (
                    <MenuItem
                      key={id}
                      disabled={tool.comesWith !== undefined}
                      shortcut={tool.shortcut}
                      icon={<ToolIcon name={tool.icon} category={tool.category} size={16} />}
                      onSelect={() => onRun(id)}
                    >
                      {tool.label}
                    </MenuItem>
                  );
                })}
              </Menu>
            </fieldset>
          </div>
        ))}
        {active?.id === 'sketch' && (
          <div className="flex items-stretch">
            <div className="mx-1.5 my-1.5 w-px bg-line" aria-hidden="true" />
            <fieldset aria-label="Finish" className="m-0 flex flex-col items-center border-0 p-0">
              <Tooltip label={TOOLS.finishSketch.label} hint={TOOLS.finishSketch.hint}>
                <ToolTile className="text-ink" onClick={() => onRun('finishSketch')}>
                  <ToolIcon
                    name={TOOLS.finishSketch.icon}
                    category="sketch"
                    color="var(--x-success)"
                  />
                  <span>{TOOLS.finishSketch.label}</span>
                </ToolTile>
              </Tooltip>
              <span className="mt-auto px-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-muted uppercase">
                Finish
              </span>
            </fieldset>
          </div>
        )}
        {active?.id === 'solid' && (
          <div className="flex items-stretch">
            <div className="mx-1.5 my-1.5 w-px bg-line" aria-hidden="true" />
            <fieldset aria-label="Select" className="m-0 flex flex-col items-center border-0 p-0">
              <Tooltip
                label="Select"
                hint="Pick faces, edges and bodies. Filters arrive with P2-03."
              >
                <ToolTile aria-pressed="true">
                  <MousePointer2 size={22} strokeWidth={1.75} className="text-ink" />
                  <span>Select</span>
                </ToolTile>
              </Tooltip>
              <span className="mt-auto px-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-muted uppercase">
                Select
              </span>
            </fieldset>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolButton({ tool, pressed, onRun }: { tool: Tool; pressed: boolean; onRun(): void }) {
  const unavailable = tool.comesWith !== undefined;
  return (
    <Tooltip
      label={tool.label}
      shortcut={tool.shortcut && shortcutLabel(tool.shortcut)}
      hint={unavailable ? `${tool.hint} Arrives with ${tool.comesWith}.` : tool.hint}
    >
      <ToolTile
        aria-disabled={unavailable || undefined}
        aria-pressed={pressed || undefined}
        onClick={unavailable ? undefined : onRun}
        className={unavailable ? 'opacity-55' : ''}
      >
        <ToolIcon name={tool.icon} category={tool.category} />
        <span>{tool.short ?? tool.label}</span>
      </ToolTile>
    </Tooltip>
  );
}

/** A 40 px tool button: icon over label. */
const ToolTile = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function ToolTile({ className = '', children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={`flex min-w-10 flex-col items-center gap-0.5 whitespace-nowrap rounded-control px-2 py-1 text-xs text-muted transition-colors duration-(--x-fast) hover:bg-accent-soft hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-ink aria-disabled:cursor-default aria-disabled:hover:bg-transparent ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);
