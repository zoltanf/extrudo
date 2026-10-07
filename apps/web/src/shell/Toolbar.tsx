import { ChevronDown } from 'lucide-react';
import { type ButtonHTMLAttributes, forwardRef, useEffect, useState } from 'react';
import { keysFor } from '../commands/keymap';
import { shortcutLabel } from '../commands/shortcuts';
import { type IconName, Menu, MenuItem, MenuLabel, ToolIcon, Tooltip } from '../design-system';
import { ToolDemo } from '../onboarding/ToolDemo';
import { isToolReady } from './commands';
import { type TabId, TOOLS, type Tool, type ToolId, visibleTabs } from './tools';

export interface ToolbarProps {
  /** `sketch` while a sketch is open: the Sketch tab replaces Solid (UI spec §2). */
  mode?: 'model' | 'sketch';
  /** The running tool, shown pressed (Create Sketch while it waits for a plane). */
  activeTool?: ToolId;
  /** Runs a tool that works today (see `Tool.comesWith`). */
  onRun(tool: ToolId): void;
  /** Tools a registered feature dialog makes work (P2-05). */
  ready?: ReadonlySet<string>;
  /** Tools left out of the menus for now (Record Macro while recording, Stop Macro otherwise). */
  hidden?: ReadonlySet<string>;
  /**
   * Custom features of the enabled plugins (P6-03 slice 3, ADR-0077 §6): listed under a
   * "Plugins" label at the end of the Create menu and run through `onRunPlugin` by `id`.
   */
  pluginItems?: readonly PluginItem[];
}

export interface PluginItem {
  /** The feature's command ID. */
  id: string;
  label: string;
  icon: IconName;
  /** "Name plate 1.0.0": which plugin offers it. */
  hint: string;
}

/** Tabs and tool groups (UI spec §2). */
export function Toolbar({
  mode = 'model',
  activeTool,
  onRun,
  ready,
  hidden,
  pluginItems,
}: ToolbarProps) {
  const home: TabId = mode === 'sketch' ? 'sketch' : 'solid';
  const [tab, setTab] = useState<TabId>(home);
  // Entering or leaving a sketch brings its tab forward.
  useEffect(() => setTab(home), [home]);
  const tabs = visibleTabs(mode);
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div className="border-b border-line bg-bg">
      <div className="flex h-8 items-end gap-1 px-2">
        <div role="tablist" aria-label="Toolbar tabs" className="flex gap-1">
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
              {group.compact ? (
                <div
                  className="grid grid-flow-col gap-px"
                  style={{ gridTemplateRows: 'repeat(2, 26px)' }}
                >
                  {group.tools.map((id) => (
                    <ToolButton
                      key={id}
                      tool={TOOLS[id]}
                      ready={isToolReady(TOOLS[id], ready)}
                      shortcut={shortcutFor(id)}
                      pressed={activeTool === id}
                      onRun={() => onRun(id)}
                      compact
                    />
                  ))}
                </div>
              ) : (
                <div className="flex gap-0.5">
                  {group.tools.map((id) => (
                    <ToolButton
                      key={id}
                      tool={TOOLS[id]}
                      ready={isToolReady(TOOLS[id], ready)}
                      shortcut={shortcutFor(id)}
                      pressed={activeTool === id}
                      onRun={() => onRun(id)}
                    />
                  ))}
                </div>
              )}
              <Menu
                label={`${group.label} tools`}
                trigger={
                  <button
                    type="button"
                    // A running tool from the menu has no tile: its group's label shows it.
                    data-active={(activeTool && group.more?.includes(activeTool)) || undefined}
                    className="mt-auto inline-flex items-center gap-0.5 rounded-input px-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-muted uppercase hover:text-ink data-active:bg-accent-soft data-active:text-ink"
                  >
                    {group.label}
                    <ChevronDown size={10} />
                  </button>
                }
              >
                <MenuLabel>{group.label}</MenuLabel>
                {[...group.tools, ...(group.more ?? [])]
                  .filter((id) => !hidden?.has(id))
                  .map((id) => {
                    const tool: Tool = TOOLS[id];
                    return (
                      <MenuItem
                        key={id}
                        disabled={!isToolReady(tool, ready)}
                        shortcut={shortcutFor(id)}
                        icon={<ToolIcon name={tool.icon} category={tool.category} size={16} />}
                        onSelect={() => onRun(id)}
                      >
                        {tool.label}
                      </MenuItem>
                    );
                  })}
                {group.label === 'Create' && pluginItems && pluginItems.length > 0 && (
                  <>
                    <MenuLabel>Plugins</MenuLabel>
                    {pluginItems.map((item) => (
                      <MenuItem
                        key={item.id}
                        icon={<ToolIcon name={item.icon} category="create" size={16} />}
                        onSelect={() => onRun(item.id as ToolId)}
                      >
                        {item.label}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>
            </fieldset>
          </div>
        ))}
        {active?.id === 'sketch' && (
          <div className="flex items-stretch">
            <div className="mx-1.5 my-1.5 w-px bg-line" aria-hidden="true" />
            <fieldset aria-label="Finish" className="m-0 flex flex-col items-center border-0 p-0">
              <Tooltip
                label={TOOLS.finishSketch.label}
                hint={TOOLS.finishSketch.hint}
                demo={<ToolDemo tool="finishSketch" />}
              >
                <ToolTile
                  data-tool="finishSketch"
                  className="text-ink"
                  onClick={() => onRun('finishSketch')}
                >
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
      </div>
    </div>
  );
}

/** A tool's first key, as it reads on this platform. */
function shortcutFor(id: ToolId): string | undefined {
  const keys = keysFor(id)[0];
  return keys && shortcutLabel(keys);
}

function ToolButton({
  tool,
  ready,
  shortcut,
  pressed,
  onRun,
  compact = false,
}: {
  tool: Tool;
  ready: boolean;
  shortcut: string | undefined;
  pressed: boolean;
  onRun(): void;
  /** An icon-only 26 px button, labelled for assistive tech. */
  compact?: boolean;
}) {
  const unavailable = !ready;
  const tooltip = {
    label: tool.label,
    shortcut,
    hint: unavailable ? `${tool.hint} Arrives with ${tool.comesWith}.` : tool.hint,
    demo: <ToolDemo tool={tool.id} />,
  };
  if (compact) {
    return (
      <Tooltip {...tooltip}>
        <button
          type="button"
          data-tool={tool.id}
          aria-label={tool.label}
          aria-disabled={unavailable || undefined}
          aria-pressed={pressed || undefined}
          onClick={unavailable ? undefined : onRun}
          className={`grid size-[26px] place-items-center rounded-control transition-colors duration-(--x-fast) hover:bg-accent-soft aria-pressed:bg-accent-soft aria-disabled:cursor-default aria-disabled:hover:bg-transparent ${unavailable ? 'opacity-55' : ''}`}
        >
          <ToolIcon name={tool.icon} category={tool.category} size={18} />
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip {...tooltip}>
      <ToolTile
        data-tool={tool.id}
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
