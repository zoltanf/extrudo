import { ChevronDown } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { keysFor } from '../commands/keymap';
import { shortcutLabel } from '../commands/shortcuts';
import { type IconName, Menu, MenuItem, MenuLabel, ToolIcon, Tooltip } from '../design-system';
import { ToolDemo } from '../onboarding/ToolDemo';
import { isToolReady } from './commands';
import { type FitGroup, fitToolbar, groupWidth } from './toolbarFit';
import {
  defaultTab,
  type TabId,
  TOOLS,
  type Tool,
  type ToolGroup,
  type ToolId,
  visibleTabs,
} from './tools';

export interface ToolbarProps {
  /** `sketch` while a sketch is open: the Sketch tab replaces Solid (UI spec §2). */
  mode?: 'model' | 'sketch';
  /** The selected tab (`useToolbarTab`); the tabs themselves are in the top bar (ADR-0079). */
  tab: TabId;
  /** The running tool, shown pressed (Create Sketch while it waits for a plane). */
  activeTool?: ToolId;
  /** Runs a tool that works today (see `Tool.comesWith`), or a Home tab file command. */
  onRun(tool: ToolId): void;
  /** Tools a registered feature dialog makes work (P2-05). */
  ready?: ReadonlySet<string>;
  /**
   * Tools left out (Record Macro while recording, Stop Macro otherwise, a file
   * command the page doesn't offer, such as Save to Linked Folder with no folder).
   */
  hidden?: ReadonlySet<string>;
  /**
   * Custom features of the enabled plugins (P6-03 slice 3, ADR-0077 §6): listed under a
   * "Plugins" label at the end of the Create menu and run through `onRunPlugin` by `id`.
   */
  pluginItems?: readonly PluginItem[];
  /**
   * The desktop app's recent files (ADR-0075, 2026-10-09): listed under "Open Recent" in the
   * Home tab's Design menu, with Clear Recent. Absent on the web.
   */
  recentFiles?: RecentFilesMenu;
}

/** A key per entry: names can repeat (two folders, one file name), so the occurrence joins it. */
function recentKeys(names: readonly string[]) {
  const seen = new Map<string, number>();
  return names.map((name, index) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return { key: `${name}#${n}`, name, index };
  });
}

export interface RecentFilesMenu {
  names: readonly string[];
  onOpen(index: number): void;
  onClear(): void;
}

export interface PluginItem {
  /** The feature's command ID. */
  id: string;
  label: string;
  icon: IconName;
  /** "Name plate 1.0.0": which plugin offers it. */
  hint: string;
}

/**
 * The tile under the pointer or the focus (P6-06 S9): F1 opens the docs page
 * of the tool it was on, or the user guide when none was. Module state, read
 * at the moment F1 runs; the `help` command needs nothing else from React.
 */
let hoveredTool: string | undefined;

/** The tool whose toolbar tile was hovered or focused last, if any. */
export function toolUnderPointer(): string | undefined {
  return hoveredTool;
}

/** Sets the tracked tool (the tiles' pointer/focus handlers; exported for tests). */
export function setHoveredTool(tool: string | undefined): void {
  hoveredTool = tool;
}

/**
 * Forgets `tool` if it is the tracked one. A tile that unmounts while hovered
 * (a tab switch) sends no pointerleave, so its cleanup calls this (P6-06 S10).
 */
export function releaseTool(tool: string): void {
  if (toolUnderPointer() === tool) setHoveredTool(undefined);
}

/** Pointer/focus tracking for one tile: in on enter/focus, out on leave/blur. */
function trackTool(id: string) {
  return {
    onPointerEnter: () => setHoveredTool(id),
    onPointerLeave: () => releaseTool(id),
    onFocus: () => setHoveredTool(id),
    onBlur: () => releaseTool(id),
  };
}

/**
 * The selected toolbar tab: the mode's default (Solid, or Sketch in a sketch),
 * brought forward again whenever a sketch opens or closes.
 */
export function useToolbarTab(mode: 'model' | 'sketch') {
  const home = defaultTab(mode);
  const [tab, setTab] = useState<TabId>(home);
  // Entering or leaving a sketch brings its tab forward.
  useEffect(() => setTab(home), [home]);
  const tabs = visibleTabs(mode);
  const shown = tabs.some((t) => t.id === tab) ? tab : home;
  return [shown, setTab] as const;
}

/** The tabs, drawn in the top bar after the logo (ADR-0079 §1). */
export function ToolbarTabs({
  mode = 'model',
  tab,
  onTab,
}: {
  mode?: 'model' | 'sketch';
  tab: TabId;
  onTab(tab: TabId): void;
}) {
  return (
    <div role="tablist" aria-label="Toolbar tabs" className="flex h-full items-stretch gap-0.5">
      {visibleTabs(mode).map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          data-tab={t.id}
          aria-selected={t.id === tab}
          aria-controls="toolbar-groups"
          onClick={() => onTab(t.id)}
          // The top padding puts the labels' baseline on the wordmark's (ADR-0079 §1).
          className="whitespace-nowrap border-b-2 border-transparent px-1.5 pt-[9px] lg:px-2.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent aria-selected:border-accent aria-selected:text-ink"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** What the fit rule measured for one tab's tiles, so a resize needs no new measurement. */
interface Measured {
  key: string;
  groups: FitGroup[];
  chrome: number;
}

/** The selected tab's tool groups (UI spec §2), fitted to the window (ADR-0079 §3). */
export function Toolbar({
  mode = 'model',
  tab,
  activeTool,
  onRun,
  ready,
  hidden,
  pluginItems,
  recentFiles,
}: ToolbarProps) {
  const tabs = visibleTabs(mode);
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  const showsFinish = active?.id === 'sketch';
  useEffect(() => (showsFinish ? () => releaseTool('finishSketch') : undefined), [showsFinish]);
  const groups: ToolGroup[] = (active?.groups ?? []).map((g) => ({
    ...g,
    tools: g.tools.filter((id) => !hidden?.has(id)),
    more: g.more?.filter((id) => !hidden?.has(id)),
  }));
  const plugins = pluginItems && pluginItems.length > 0 ? pluginItems : undefined;
  const hasMenu = (g: ToolGroup) =>
    (g.more?.length ?? 0) > 0 ||
    (g.label === 'Create' && !!plugins) ||
    (g.label === 'Design' && !!recentFiles);
  // The tiles drawn: what is measured once, and redrawn whenever it changes.
  const key = `${active?.id}|${groups.map((g) => `${g.tools.join(',')}${hasMenu(g) ? '▾' : ''}`).join(';')}`;

  const row = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Measured>();
  const [width, setWidth] = useState<number>();
  const fresh = measured?.key === key ? measured : undefined;
  const fit =
    fresh && width !== undefined
      ? fitToolbar(fresh.groups, width, fresh.chrome)
      : groups.map(() => 0);

  // Measure every tile with nothing hidden, once per set of tiles (labels differ).
  useLayoutEffect(() => {
    const element = row.current;
    if (!element || measured?.key === key) return;
    const fieldsets = [...element.querySelectorAll<HTMLElement>('[data-toolbar-group]')];
    const measuredGroups = fieldsets.map((fieldset, i): FitGroup => {
      const group = groups[i];
      const tiles = [...fieldset.querySelectorAll<HTMLElement>('[data-toolbar-tiles] > *')];
      const label = fieldset.querySelector<HTMLElement>('[data-group-label-text]');
      return {
        // A compact group (the constraints' grid) moves as one: it is never shortened.
        tiles: group?.compact
          ? [fieldset.querySelector<HTMLElement>('[data-toolbar-tiles]')?.offsetWidth ?? 0]
          : tiles.map((tile) => tile.offsetWidth + 2),
        menu: group ? hasMenu(group) : false,
        label: (label?.offsetWidth ?? 0) + 12,
      };
    });
    // The row's content, wherever it ends: not `scrollWidth`, which is the row's own width
    // while the content is narrower.
    const last = element.lastElementChild?.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const content = last
      ? last.right -
        box.left +
        element.scrollLeft +
        Number.parseFloat(getComputedStyle(element).paddingRight)
      : 0;
    const sum = measuredGroups.reduce((total, g) => total + groupWidth(g, 0), 0);
    setMeasured({ key, groups: measuredGroups, chrome: content - sum });
    setWidth(element.clientWidth);
  });

  // Fit again on every resize of the toolbar.
  useEffect(() => {
    const element = row.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="border-b border-line bg-bg">
      <div
        ref={row}
        id="toolbar-groups"
        role="tabpanel"
        aria-labelledby={`tab-${active?.id}`}
        data-toolbar-fit={fit.join(',')}
        className="flex min-h-[70px] items-stretch gap-1 overflow-x-auto px-2 pt-1 pb-1"
      >
        {groups.map((group, i) => {
          const hide = group.compact ? 0 : (fit[i] ?? 0);
          const tiles = group.tools.slice(0, group.tools.length - hide);
          const moved = group.tools.slice(group.tools.length - hide);
          const menu = [...moved, ...(group.more ?? [])];
          const showMenu =
            menu.length > 0 ||
            (group.label === 'Create' && !!plugins) ||
            (group.label === 'Design' && !!recentFiles);
          return (
            <div key={group.label} className="flex items-stretch">
              {i > 0 && <div className="mx-1.5 my-1.5 w-px bg-line" aria-hidden="true" />}
              <fieldset
                aria-label={group.label}
                data-toolbar-group={group.label}
                data-hidden-tiles={hide || undefined}
                className="m-0 flex flex-col items-center border-0 p-0"
              >
                {group.compact ? (
                  <div
                    data-toolbar-tiles=""
                    className="grid grid-flow-col gap-px"
                    style={{ gridTemplateRows: 'repeat(2, 26px)' }}
                  >
                    {tiles.map((id) => (
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
                  <div data-toolbar-tiles="" className="flex gap-0.5">
                    {tiles.map((id) => (
                      <ToolButton
                        key={id}
                        tool={TOOLS[id]}
                        label={group.labels?.[id]}
                        ready={isToolReady(TOOLS[id], ready)}
                        shortcut={shortcutFor(id)}
                        pressed={activeTool === id}
                        onRun={() => onRun(id)}
                      />
                    ))}
                  </div>
                )}
                {showMenu ? (
                  <Menu
                    label={`${group.label} tools`}
                    trigger={
                      <button
                        type="button"
                        // A running tool from the menu has no tile: its group's label shows it.
                        data-active={(activeTool && menu.includes(activeTool)) || undefined}
                        className={`${LABEL} rounded-input hover:text-ink data-active:bg-accent-soft data-active:text-ink`}
                      >
                        <span data-group-label-text="">{group.label}</span>
                        <ChevronDown size={10} />
                      </button>
                    }
                  >
                    <MenuLabel>{group.label}</MenuLabel>
                    {menu.map((id) => {
                      const tool: Tool = TOOLS[id];
                      return (
                        <MenuItem
                          key={id}
                          disabled={!isToolReady(tool, ready)}
                          shortcut={shortcutFor(id)}
                          icon={<ToolIcon name={tool.icon} category={tool.category} size={16} />}
                          onSelect={() => onRun(id)}
                        >
                          {group.labels?.[id] ?? tool.label}
                        </MenuItem>
                      );
                    })}
                    {group.label === 'Design' && recentFiles && (
                      <>
                        <MenuLabel>Open Recent</MenuLabel>
                        {recentFiles.names.length === 0 && (
                          <MenuItem disabled onSelect={() => {}}>
                            No recent files
                          </MenuItem>
                        )}
                        {recentKeys(recentFiles.names).map(({ key, name, index }) => (
                          <MenuItem key={key} onSelect={() => recentFiles.onOpen(index)}>
                            {name}
                          </MenuItem>
                        ))}
                        <MenuItem
                          disabled={recentFiles.names.length === 0}
                          onSelect={recentFiles.onClear}
                        >
                          Clear Recent
                        </MenuItem>
                      </>
                    )}
                    {group.label === 'Create' && plugins && (
                      <>
                        <MenuLabel>Plugins</MenuLabel>
                        {plugins.map((item) => (
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
                ) : (
                  <span className={LABEL}>
                    <span data-group-label-text="">{group.label}</span>
                  </span>
                )}
              </fieldset>
            </div>
          );
        })}
        {active?.id === 'sketch' && (
          <div className="flex items-stretch">
            <div className="mx-1.5 my-1.5 w-px bg-line" aria-hidden="true" />
            <fieldset aria-label="Finish" className="m-0 flex flex-col items-center border-0 p-0">
              <Tooltip
                label={TOOLS.finishSketch.label}
                hint={TOOLS.finishSketch.hint}
                demo={<ToolDemo tool="finishSketch" />}
                footer="F1 for more"
              >
                <ToolTile
                  data-tool="finishSketch"
                  data-label={TOOLS.finishSketch.label}
                  className="text-ink"
                  onClick={() => onRun('finishSketch')}
                  {...trackTool('finishSketch')}
                >
                  <ToolIcon
                    name={TOOLS.finishSketch.icon}
                    category="sketch"
                    color="var(--x-success)"
                  />
                  <span>{TOOLS.finishSketch.label}</span>
                </ToolTile>
              </Tooltip>
              <span className={LABEL}>Finish</span>
            </fieldset>
          </div>
        )}
      </div>
    </div>
  );
}

/** A group's label under its tiles; a button with a ▾ when the group has a menu. */
const LABEL =
  'mt-auto inline-flex items-center gap-0.5 whitespace-nowrap px-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-muted uppercase';

/** A tool's first key, as it reads on this platform. */
function shortcutFor(id: ToolId): string | undefined {
  const keys = keysFor(id)[0];
  return keys && shortcutLabel(keys);
}

function ToolButton({
  tool,
  label,
  ready,
  shortcut,
  pressed,
  onRun,
  compact = false,
}: {
  tool: Tool;
  /** The tile's label in this group, when it isn't the tool's own. */
  label?: string;
  ready: boolean;
  shortcut: string | undefined;
  pressed: boolean;
  onRun(): void;
  /** An icon-only 26 px button, labelled for assistive tech. */
  compact?: boolean;
}) {
  const unavailable = !ready;
  useEffect(() => () => releaseTool(tool.id), [tool.id]);
  const tooltip = {
    label: label ?? tool.label,
    shortcut,
    hint: unavailable ? `${tool.hint} Arrives with ${tool.comesWith}.` : tool.hint,
    demo: <ToolDemo tool={tool.id} />,
    footer: 'F1 for more',
  };
  if (compact) {
    return (
      <Tooltip {...tooltip}>
        <button
          type="button"
          data-tool={tool.id}
          data-label={tool.label}
          aria-label={tool.label}
          aria-disabled={unavailable || undefined}
          aria-pressed={pressed || undefined}
          onClick={unavailable ? undefined : onRun}
          {...trackTool(tool.id)}
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
        // The tool's full name, for finding a tile whose label is short ("Section").
        data-label={label ?? tool.label}
        aria-disabled={unavailable || undefined}
        aria-pressed={pressed || undefined}
        onClick={unavailable ? undefined : onRun}
        {...trackTool(tool.id)}
        className={unavailable ? 'opacity-55' : ''}
      >
        <ToolIcon name={tool.icon} category={tool.category} />
        <span>{label ?? tool.short ?? tool.label}</span>
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
