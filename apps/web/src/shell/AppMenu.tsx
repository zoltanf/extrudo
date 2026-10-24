import {
  BookOpen,
  Box,
  Bug,
  CircleHelp,
  GraduationCap,
  Info,
  LayoutGrid,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Search,
  Settings,
  Shapes,
  SquareDashed,
  Sun,
  Wrench,
  X,
} from 'lucide-react';
import { Popover as Radix } from 'radix-ui';
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useKeysFor } from '../commands/keymapStore';
import { shortcutLabel } from '../commands/shortcuts';
import { IconButton, type ThemeChoice, Tooltip } from '../design-system';
import type { PlatformUpdates, UpdateState } from '../platform/updates';
import { type DisplayAccess, useDisplaySettings } from '../settings/displaySettings';
import { NAV_PRESETS, type NavPreset } from '../viewport/navigation';
import type { DocsPage } from './docsLinks';
import {
  BlenderIcon,
  CrankIcon,
  GlideIcon,
  RingIcon,
  SlicerIcon,
  SpindleIcon,
  TrackpadIcon,
} from './mouseIcons';

/** The Learn column's first item: the docs page of the tool last hovered or focused. */
export interface HelpTool {
  /** The tool's command label ("Extrude"). */
  label: string;
  onHelp(): void;
}

export interface AppMenuProps {
  /** The display settings: the project's viewport, or the preference on the home screen. */
  display: DisplayAccess;
  theme: ThemeChoice;
  onThemeChange(theme: ThemeChoice): void;
  /** The same state as the command "Right-Click Menu: Use a List / Use the Ring". */
  markingRadial: boolean;
  onMarkingRadial(radial: boolean): void;
  /** Opens the Settings dialog (ADR-0082). */
  onSettings(): void;
  /** Opens the search, centred; absent where there are no commands (the home screen). */
  onSearch?: (() => void) | undefined;
  /** About Extrudo (ADR-0085). */
  onAbout(): void;
  /** Report a bug (ADR-0092). */
  onReportBug?: (() => void) | undefined;
  /** Starts the tutorial (P3-12). */
  onTutorial(): void;
  /** Opens a docs page (P6-06 S9): User Guide, Online Tutorials, Examples, Tool Reference. */
  onDocs(page: DocsPage): void;
  /**
   * Asked each time the panel opens: "Help for <tool>" for the tile hovered or focused last,
   * or nothing (the item is left out). Absent on the home screen.
   */
  helpTool?: (() => HelpTool | undefined) | undefined;
  /** The build's version, in the strip. */
  version: string;
  /** The update state the strip shows (`Platform.updates`). */
  updates?: PlatformUpdates | undefined;
  /** The strip's "Check now" (desktop only, ADR-0075's 2026-10-09 amendment). */
  onCheckUpdates?: (() => void) | undefined;
  /** The strip's "GitHub" (Source on GitHub). */
  onSource(): void;
  /** Desktop only: saves everything, then quits. */
  onQuit?: (() => void) | undefined;
  /** The web's stand-in for Quit inside a design (a page can't close its tab): back to Home. */
  onCloseDesign?: (() => void) | undefined;
}

/** A command's first key as it reads here ("Ctrl+K"); `keys` from `useKeysFor` (live). */
const keyLabel = (keys: readonly string[]) => keys[0] && shortcutLabel(keys[0]);

/**
 * The rail's presets in their own order (ADR-0090 §1). Slicer isn't a `NavPreset` yet: its
 * radio is disabled and its tooltip says what it will do.
 */
interface RailPreset {
  value: NavPreset | 'slicer';
  label: string;
  summary: string;
  icon: () => ReactNode;
}

const navPreset = (value: NavPreset, icon: () => ReactNode): RailPreset => {
  const p = NAV_PRESETS.find((n) => n.value === value) as (typeof NAV_PRESETS)[number];
  return { value, label: p.label, summary: p.summary, icon };
};

const RAIL_PRESETS: readonly RailPreset[] = [
  navPreset('crank', CrankIcon),
  navPreset('spindle', SpindleIcon),
  navPreset('glide', GlideIcon),
  navPreset('blender', BlenderIcon),
  {
    value: 'slicer',
    label: 'Slicer',
    summary: 'Left-drag orbits, right-drag pans; Shift+left-drag selects. Coming soon.',
    icon: SlicerIcon,
  },
  navPreset('trackpad', TrackpadIcon),
];

const THEMES: readonly { value: ThemeChoice; label: string; hint?: string; icon: ReactNode }[] = [
  {
    value: 'system',
    label: 'System',
    hint: 'Follows the operating system.',
    icon: <Monitor size={14} strokeWidth={1.75} />,
  },
  { value: 'light', label: 'Light', icon: <Sun size={14} strokeWidth={1.75} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={14} strokeWidth={1.75} /> },
];

/** The strip's dot and word for an update state (never colour alone). */
export function updateWord(state: UpdateState | undefined): { word?: string; dot: string } {
  if (state?.waiting) {
    return {
      word: state.version ? `Update ready: ${state.version}` : 'Update ready',
      dot: 'bg-warning',
    };
  }
  if (state?.check === 'checking') return { word: 'Checking…', dot: 'bg-accent animate-pulse' };
  if (state?.check === 'current') return { word: 'Up to date', dot: 'bg-success' };
  return { dot: 'bg-muted' };
}

/**
 * Arrow keys within a group (a rail control, a column, the strip), Home and End: the focused
 * item moves and becomes the group's one Tab stop. Tab moves between groups.
 */
function rove(axis: 'x' | 'y') {
  const [back, forth] = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  return (event: KeyboardEvent<HTMLElement>) => {
    if (![back, forth, 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-rove]')];
    const at = items.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    const last = items.length - 1;
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : (at + (event.key === forth ? 1 : -1) + items.length) % items.length;
    items.forEach((item, i) => {
      item.tabIndex = i === to ? 0 : -1;
    });
    items[to]?.focus();
  };
}

const segment = 'inline-flex gap-0.5 rounded-control border border-line bg-panel p-0.5';
const segmentRadio =
  'inline-grid h-6 place-items-center rounded-input px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent aria-checked:bg-raised aria-checked:text-ink aria-checked:shadow-sm aria-[checked=false]:text-muted aria-disabled:opacity-45 aria-disabled:cursor-not-allowed';
const toggle =
  'inline-grid h-7 w-[30px] place-items-center rounded-input border border-transparent text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink';
const itemClass =
  'flex h-8 w-full cursor-default select-none items-center gap-2 rounded-input px-2 text-left outline-none hover:bg-accent-soft focus-visible:bg-accent-soft';
const link =
  'rounded-input text-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent';

/**
 * The app menu (ADR-0090): the four-squares button opens one panel, the same on the home
 * screen and in a design. Three bands: the rail (mouse controls, the three toggles, theme),
 * two columns of items (App and Learn) and the version strip. Rail controls change a
 * preference and leave the panel open; an item runs and closes it.
 *
 * Test hooks: `dialog` "Menu"; the rail's `radiogroup`s "Mouse controls" and "Theme" and its
 * toggle buttons (`aria-pressed`); the `menu`s "App" and "Learn"; the strip
 * `[data-update-strip]` with `data-update-word`.
 */
export function AppMenu(props: AppMenuProps) {
  const { display, theme, onThemeChange, markingRadial, onMarkingRadial } = props;
  const { autoProject, autoProjectFace, preset } = useDisplaySettings(display);
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState<HelpTool>();
  const onOpenChange = (next: boolean) => {
    if (next) setHelp(props.helpTool?.());
    setOpen(next);
  };
  // An item closes the panel and runs; what it opens (Search, a dialog) keeps the focus.
  const handedOff = useRef(false);
  const choose = (run: () => void) => () => {
    handedOff.current = true;
    setOpen(false);
    run();
  };
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange} modal>
      <Radix.Trigger asChild>
        <IconButton label="Menu" hint="Settings, help and quick preferences.">
          <LayoutGrid size={18} strokeWidth={1.75} />
        </IconButton>
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          aria-label="Menu"
          // The panel itself takes the focus, so no rail tooltip opens with it (and the first
          // Escape closes the panel, not a tooltip); Tab then enters the rail.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          // Escape gives the focus back to the Menu button; an item leaves it where it went.
          onCloseAutoFocus={(event) => {
            if (handedOff.current) event.preventDefault();
            handedOff.current = false;
          }}
          className="z-50 w-max outline-none max-w-[calc(100vw-16px)] rounded-control border border-line bg-raised text-base text-ink shadow-raised"
        >
          <MenuPanel
            {...props}
            autoProject={autoProject}
            autoProjectFace={autoProjectFace}
            preset={preset}
            theme={theme}
            onThemeChange={onThemeChange}
            markingRadial={markingRadial}
            onMarkingRadial={onMarkingRadial}
            help={help}
            choose={choose}
          />
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

export interface MenuPanelProps extends AppMenuProps {
  autoProject: boolean;
  autoProjectFace: boolean;
  preset: NavPreset;
  help: HelpTool | undefined;
  /** Wraps an item's handler: closes the panel, then runs it. */
  choose(run: () => void): () => void;
}

/** The panel's three bands, apart from the popover (rendered on its own in tests). */
export function MenuPanel({
  display,
  theme,
  onThemeChange,
  markingRadial,
  onMarkingRadial,
  autoProject,
  autoProjectFace,
  preset,
  help,
  choose,
  onSettings,
  onSearch,
  onAbout,
  onReportBug,
  onTutorial,
  onDocs,
  version,
  updates,
  onCheckUpdates,
  onSource,
  onQuit,
  onCloseDesign,
}: MenuPanelProps) {
  const keysFor = useKeysFor();
  const toggles = [
    {
      label: 'Auto-project body edges',
      on: autoProject,
      hint: 'A body edge or vertex a tool snaps to is projected into the sketch.',
      icon: <Box size={16} strokeWidth={1.75} />,
      set: (v: boolean) => display.set({ autoProject: v }),
    },
    {
      label: 'Auto-project face outline',
      on: autoProjectFace,
      hint: 'When a sketch starts on a flat face.',
      icon: <SquareDashed size={16} strokeWidth={1.75} />,
      set: (v: boolean) => display.set({ autoProjectFace: v }),
    },
    {
      label: 'Radial right-click menu',
      on: markingRadial,
      hint: 'A ring of eight commands around the pointer. Off draws one plain list.',
      icon: <RingIcon />,
      set: onMarkingRadial,
    },
  ];
  return (
    <>
      <div className="inline-flex min-w-full items-center gap-3 border-b border-line px-3 py-2">
        <div
          role="radiogroup"
          aria-label="Mouse controls"
          className={segment}
          onKeyDown={rove('x')}
        >
          {RAIL_PRESETS.map((p) => {
            const disabled = p.value === 'slicer';
            const checked = p.value === preset;
            const Icon = p.icon;
            return (
              <Tooltip key={p.value} label={`Mouse controls: ${p.label}`} hint={p.summary}>
                {/* biome-ignore lint/a11y/useSemanticElements: a segmented control of icon buttons, each with a tooltip */}
                <button
                  type="button"
                  role="radio"
                  data-rove=""
                  aria-label={p.label}
                  aria-checked={checked}
                  aria-disabled={disabled || undefined}
                  tabIndex={checked ? 0 : -1}
                  className={segmentRadio}
                  onClick={() => {
                    if (!disabled) display.set({ preset: p.value as NavPreset });
                  }}
                >
                  <Icon />
                </button>
              </Tooltip>
            );
          })}
        </div>
        <div className="h-5 w-px bg-line" aria-hidden="true" />
        {/* biome-ignore lint/a11y/useSemanticElements: a toolbar's group of toggles, not a form fieldset */}
        <div role="group" aria-label="Toggles" className="flex gap-0.5" onKeyDown={rove('x')}>
          {toggles.map((t, i) => (
            <Tooltip key={t.label} label={t.label} hint={`${t.on ? 'On' : 'Off'}. ${t.hint}`}>
              <button
                type="button"
                data-rove=""
                aria-label={t.label}
                aria-pressed={t.on}
                tabIndex={i === 0 ? 0 : -1}
                className={toggle}
                onClick={() => t.set(!t.on)}
              >
                {t.icon}
              </button>
            </Tooltip>
          ))}
        </div>
        <div className="h-5 w-px bg-line" aria-hidden="true" />
        <div role="radiogroup" aria-label="Theme" className={segment} onKeyDown={rove('x')}>
          {THEMES.map((t) => (
            <Tooltip key={t.value} label={`Theme: ${t.label}`} hint={t.hint}>
              {/* biome-ignore lint/a11y/useSemanticElements: a segmented control of icon buttons, each with a tooltip */}
              <button
                type="button"
                role="radio"
                data-rove=""
                aria-label={t.label}
                aria-checked={t.value === theme}
                tabIndex={t.value === theme ? 0 : -1}
                className={segmentRadio}
                onClick={() => onThemeChange(t.value)}
              >
                {t.icon}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Width 0, at least the panel's: the rail alone sets the width (ADR-0090 §1). */}
      <div className="grid w-0 min-w-full grid-cols-2 p-1">
        <Column label="App">
          {onSearch && (
            <Item
              icon={<Search />}
              shortcut={keyLabel(keysFor('search'))}
              onClick={choose(onSearch)}
            >
              Search…
            </Item>
          )}
          <Item
            icon={<Settings />}
            shortcut={keyLabel(keysFor('openSettings'))}
            onClick={choose(onSettings)}
          >
            Settings…
          </Item>
          {onReportBug && (
            <Item icon={<Bug />} onClick={choose(onReportBug)}>
              Report a bug
            </Item>
          )}
          <Item icon={<Info />} onClick={choose(onAbout)}>
            About Extrudo
          </Item>
          {(onCloseDesign || onQuit) && <hr className="mx-0 my-1 h-px border-0 bg-line" />}
          {onCloseDesign && (
            <Item icon={<X />} onClick={choose(onCloseDesign)}>
              Close design
            </Item>
          )}
          {onQuit && (
            <Item icon={<LogOut />} shortcut={keyLabel(keysFor('quit'))} onClick={choose(onQuit)}>
              Quit
            </Item>
          )}
        </Column>
        <Column label="Learn" className="border-l border-line">
          {help && (
            <Item
              icon={<CircleHelp />}
              shortcut={keyLabel(keysFor('help'))}
              onClick={choose(help.onHelp)}
            >
              {`Help for ${help.label}`}
            </Item>
          )}
          <Item icon={<BookOpen />} onClick={choose(() => onDocs('guide'))}>
            User Guide
          </Item>
          {/* Five steps that build a box (P3-12). */}
          <Item icon={<GraduationCap />} onClick={choose(onTutorial)}>
            Tutorial
          </Item>
          <Item icon={<ListChecks />} onClick={choose(() => onDocs('tutorials'))}>
            Online Tutorials
          </Item>
          <Item icon={<Shapes />} onClick={choose(() => onDocs('examples'))}>
            Examples
          </Item>
          <Item icon={<Wrench />} onClick={choose(() => onDocs('tools'))}>
            Tool Reference
          </Item>
        </Column>
      </div>

      <UpdateStrip
        version={version}
        updates={updates}
        onCheckUpdates={onCheckUpdates}
        onSource={choose(onSource)}
      />
    </>
  );
}

function Column({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 p-0.5 ${className}`}>
      <div
        aria-hidden="true"
        className="px-2 pt-1.5 pb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted"
      >
        {label}
      </div>
      <div
        ref={firstTabStop}
        role="menu"
        aria-label={label}
        aria-orientation="vertical"
        onKeyDown={rove('y')}
      >
        {children}
      </div>
    </div>
  );
}

/** The column's first item is its Tab stop (the panel mounts afresh each time it opens). */
function firstTabStop(menu: HTMLDivElement | null) {
  const first = menu?.querySelector<HTMLElement>('[data-rove]');
  if (first) first.tabIndex = 0;
}

/** One column item. */
function Item({
  icon,
  shortcut,
  onClick,
  children,
}: {
  icon: ReactNode;
  shortcut?: string | undefined;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-rove=""
      tabIndex={-1}
      className={itemClass}
      onClick={onClick}
    >
      <span className="grid w-4 shrink-0 place-items-center text-muted [&>svg]:size-3.5">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <kbd className="font-mono text-xs text-muted">{shortcut}</kbd>}
    </button>
  );
}

function UpdateStrip({
  version,
  updates,
  onCheckUpdates,
  onSource,
}: {
  version: string;
  updates: PlatformUpdates | undefined;
  onCheckUpdates: (() => void) | undefined;
  onSource(): void;
}) {
  const state = useUpdateState(updates);
  const { word, dot } = updateWord(state);
  return (
    <div
      data-update-strip=""
      data-update-word={word ?? ''}
      className="m-1 flex w-0 min-w-[calc(100%-8px)] items-center gap-2 rounded-input bg-panel px-2.5 py-2 text-xs text-muted"
    >
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {word && <span role="status">{word}</span>}
      <span className="font-mono text-ink">
        <span className="sr-only">Version </span>
        {version}
      </span>
      <div className="flex-1" />
      {/* biome-ignore lint/a11y/useSemanticElements: two links, not a form fieldset */}
      <div role="group" aria-label="Links" className="flex gap-2" onKeyDown={rove('x')}>
        {onCheckUpdates && (
          <button type="button" data-rove="" className={link} onClick={onCheckUpdates}>
            Check now
          </button>
        )}
        <button
          type="button"
          data-rove=""
          tabIndex={onCheckUpdates ? -1 : 0}
          className={link}
          onClick={onSource}
        >
          GitHub
        </button>
      </div>
    </div>
  );
}

const NO_UPDATES: UpdateState = { waiting: false };
const noStore = {
  getState: () => NO_UPDATES,
  getInitialState: () => NO_UPDATES,
  subscribe: () => () => {},
  setState: () => {},
} as unknown as PlatformUpdates['store'];

function useUpdateState(updates: PlatformUpdates | undefined): UpdateState {
  return useStore(updates?.store ?? noStore);
}
