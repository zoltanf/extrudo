/**
 * The shell's commands (P1-14, ADR-0023): every tool on the tabs shown in
 * the current mode plus edit, view, panel, file and theme commands, each
 * with its keys from the keymap. The same list drives the shortcuts, the
 * Ctrl+K palette and the S toolbox, so a command found in search runs the
 * same way as its key.
 */

import type { ViewId } from '@extrudo/core';
import {
  Bell,
  BookOpen,
  Box,
  Circle,
  GraduationCap,
  House,
  ListChecks,
  Magnet,
  Maximize,
  Moon,
  PanelLeft,
  Power,
  Puzzle,
  Redo2,
  RefreshCw,
  Repeat2,
  ScanEye,
  Settings,
  Shapes,
  Sun,
  SunMoon,
  Trash2,
  Undo2,
  Video,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { keysFor } from '../commands/keymap';
import type { Searchable } from '../commands/search';
import type { Shortcut } from '../commands/shortcuts';
import { type ThemeChoice, ToolIcon } from '../design-system';
import type { ViewportStore } from '../viewport/store';
import { FACES, type FaceName } from '../viewport/viewcube';
import type { FileActions } from './AppBar';
import type { DocsPage } from './docsLinks';
import { toolUnderPointer } from './Toolbar';
import {
  FILE_COMMANDS,
  type FileCommandId,
  isFileCommand,
  TOOLS,
  type Tool,
  type ToolId,
  visibleTabs,
} from './tools';

export interface AppCommand extends Searchable {
  /** A tool ID, or a keymap ID such as `undo` or `viewTop`. */
  id: string;
  label: string;
  /** A tile's label when `label` is too long (the toolbox's pins). */
  short?: string;
  /** Where it lives, shown beside it in search results: "Sketch › Create". */
  group: string;
  icon?: ReactNode;
  keys: readonly string[];
  /** Its keys also fire while typing in a field (only for a key that types nothing, like F1). */
  inFields?: boolean;
  /** Says why it can't run yet ("Arrives with P2-06."); running it says so too. */
  unavailable?: string;
  run(): void;
}

export interface CommandContext {
  mode: 'model' | 'sketch';
  /** Starts a tool (a sketch tool restarts if it's running; the toolbar toggles instead). */
  runTool(id: ToolId): void;
  notify(tone: 'info' | 'error', text: string): void;
  undo(): void;
  redo(): void;
  /** Deletes the selection; absent while nothing can be deleted (no sketch, a tool runs). */
  remove?: () => void;
  /** The construction toggle (UI spec §4); absent outside a sketch. */
  construction?: { on: boolean; toggle(): void };
  lookAtSketch?: () => void;
  /** Turns and fits the camera to what is selected (UI spec §3.1); absent with no selection. */
  lookAtSelection?: () => void;
  viewport: ViewportStore;
  browser: { collapsed: boolean; toggle(): void };
  file: FileActions;
  /** The notification history (P3-16): absent where there are no toasts to open it from. */
  notifications?: { open(): void };
  /** The first-run tutorial (P3-12). */
  tutorial?: { start(): void };
  /**
   * Opens a docs page (P6-06 S9, ADR-0080 §5) through the platform. The Help
   * menu's items and the F1 command go through it; absent in tests that don't
   * build a whole platform.
   */
  docs?: { open(page: DocsPage): void };
  /**
   * The last tool run through the commands (P3-11, see `isRepeatable`): "Repeat last" runs
   * it again. Absent until one has run, or when it isn't offered in this mode.
   */
  repeat?: { id: string };
  /** How many components the design has (P6-05): a joint needs two. */
  componentCount?: number;
  /** Macro recording (P5-05): whether one runs; Record and Stop show accordingly. */
  macro?: { recording: boolean };
  /**
   * Components (P6-05 S4, ADR-0081 §6): the component the selected bodies all share (absent
   * when they share none), and whether one is active or isolated. Model mode only.
   */
  components?: {
    selected?: { name: string };
    active: boolean;
    isolated: boolean;
    activate(): void;
    deactivate(): void;
    isolate(): void;
    exitIsolation(): void;
  };
  /** The right-click menu's style (P3-11): the ring, or one plain list. */
  markingMenu?: { radial: boolean; toggle(): void; customize?: () => void };
  theme: { choice: ThemeChoice; set(choice: ThemeChoice): void };
  /** Opens the Settings dialog (ADR-0082). */
  settings?: { open(): void };
  /**
   * Tools that work because a feature dialog is registered for them
   * (P2-05), even while `shell/tools.ts` still names the task that brings them.
   */
  ready?: ReadonlySet<string>;
  /** Commands of feature dialogs without a toolbar tool (a debug page's), in model mode. */
  dialogCommands?: readonly AppCommand[];
  /**
   * The enabled plugins' commands (P6-03 slice 2, ADR-0077 §5): `plugin:<plugin>:<command>`
   * in the group "Plugins › <plugin name>", model mode only; a disabled plugin's are absent.
   * A plugin never binds a key.
   */
  plugins?: readonly PluginCommandEntry[];
  /**
   * The desktop app's own commands (ADR-0075, 2026-10-09); absent on the web. Quit, Check for
   * Updates… and Clear Recent live here (Open File… and Save As… are Home tab file commands).
   * `nativeMenu` is true on macOS, whose menu keeps the accelerators: no key is bound twice.
   */
  desktop?: {
    nativeMenu: boolean;
    quit(): void;
    checkForUpdates?(): void;
    clearRecent?(): void;
  };
  /**
   * The document's named views (ADR-0008's amendment, 2026-10-10): "Save
   * Current View…" opens the nav bar's save prompt, and one command per view
   * restores it. Saving and restoring camera views is never a key.
   */
  views?: {
    list: readonly { id: ViewId; name: string }[];
    save(): void;
    restore(id: ViewId): void;
  };
}

/** A plugin command as the shell offers it (`plugins/runCommand.ts` builds them). */
export interface PluginCommandEntry {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run(): void;
}

const icon = (Icon: typeof Box) => <Icon size={16} strokeWidth={1.75} />;

/**
 * Why the Home tab's drawing import can't run outside a sketch (P4-06): a
 * drawing becomes the open sketch's curves, so there is nothing for it to
 * join. The tile is there either way and says this.
 */
export const DRAWING_IMPORT_UNAVAILABLE = 'Open a sketch to import a drawing into it.';

const VIEWS: { id: string; face?: FaceName; label: string }[] = [
  { id: 'viewHome', label: 'Home View' },
  { id: 'viewTop', face: 'Top', label: 'Top View' },
  { id: 'viewBottom', face: 'Bottom', label: 'Bottom View' },
  { id: 'viewFront', face: 'Front', label: 'Front View' },
  { id: 'viewBack', face: 'Back', label: 'Back View' },
  { id: 'viewLeft', face: 'Left', label: 'Left View' },
  { id: 'viewRight', face: 'Right', label: 'Right View' },
];

function toolCommand(id: ToolId, group: string, ctx: CommandContext): AppCommand {
  const tool: Tool = TOOLS[id];
  const reason = tool.unavailable ?? `Arrives with ${tool.comesWith}.`;
  const unavailable = !isToolReady(tool, ctx.ready) && reason;
  return {
    id,
    label: tool.label,
    ...(tool.short && { short: tool.short }),
    group,
    keywords: `${group} ${tool.hint}`,
    icon: <ToolIcon name={tool.icon} category={tool.category} size={16} />,
    keys: keysFor(id),
    ...(unavailable && { unavailable }),
    run: unavailable ? () => ctx.notify('info', reason) : () => ctx.runTool(id),
  };
}

/** Words search also finds a file command by (ADR-0079), beyond its group and hint. */
const FILE_KEYWORDS: Record<FileCommandId, string> = {
  newDesign: 'file create blank',
  openFile: 'file open disk extrudo desktop native dialog',
  saveAs: 'file save as disk extrudo desktop native dialog link',
  allDesigns: 'file home projects open',
  saveVersion: 'file save version snapshot history checkpoint',
  versionHistory: 'file versions restore revert history',
  exportProject: 'file download save project backup extrudo',
  exportScript: 'file download code typescript macro api program',
  importProject: 'file open upload project extrudo',
  saveToLinkedFolder: 'file folder disk sync save project extrudo linked external',
  plugins: 'file plugins extensions add-ons install enable remove extrudo-plugin',
};

/**
 * A Home tab file command (ADR-0079): runs the page's `FileActions` method, the
 * one the File menu's item ran. Absent where the page leaves the method out, and
 * Export as Script in a sketch (a sketch isn't a design of its own).
 */
function fileCommand(
  id: FileCommandId,
  group: string,
  ctx: CommandContext,
): AppCommand | undefined {
  const action = ctx.file[FILE_COMMANDS[id]];
  if (!action || (id === 'exportScript' && ctx.mode !== 'model')) return undefined;
  const tool: Tool = TOOLS[id];
  return {
    id,
    label: tool.label,
    ...(tool.short && { short: tool.short }),
    group,
    keywords: `${group} ${FILE_KEYWORDS[id]} ${tool.hint}`,
    icon: <ToolIcon name={tool.icon} category={tool.category} size={16} />,
    // On macOS the native menu's accelerators run Open… and Save As…: no second binding.
    keys: ctx.desktop?.nativeMenu && (id === 'openFile' || id === 'saveAs') ? [] : keysFor(id),
    run: () => action(),
  };
}

/** The commands offered in this context, in the order an empty search lists them. */
export function buildCommands(ctx: CommandContext): AppCommand[] {
  const out: AppCommand[] = [];
  const seen = new Set<string>();
  const add = (command: AppCommand) => {
    if (seen.has(command.id)) return;
    seen.add(command.id);
    out.push(command);
  };
  const plain = (
    id: string,
    label: string,
    group: string,
    run: () => void,
    extra: Partial<AppCommand> = {},
  ) => add({ id, label, group, keys: keysFor(id), run, keywords: group, ...extra });

  for (const tab of visibleTabs(ctx.mode)) {
    for (const group of tab.groups) {
      for (const id of [...group.tools, ...(group.more ?? [])]) {
        if (id === 'recordMacro' && ctx.macro?.recording) continue;
        if (id === 'stopMacro' && !ctx.macro?.recording) continue;
        const where = `${tab.label} › ${group.label}`;
        if (isFileCommand(id)) {
          const command = fileCommand(id, where, ctx);
          if (command) add(command);
          continue;
        }
        const command = toolCommand(id, where, ctx);
        if (id === 'importDrawing' && ctx.mode !== 'sketch') add(noDrawing(ctx, command));
        else if (id === 'joint' && (ctx.componentCount ?? 0) < 2) add(noJoint(ctx, command));
        else if (MODEL_ONLY.has(id) && ctx.mode === 'sketch') add(modelOnly(ctx, command));
        else add(command);
      }
    }
    if (tab.id === 'sketch') {
      add(toolCommand('finishSketch', 'Sketch › Finish', ctx));
      if (ctx.construction) {
        const { on, toggle } = ctx.construction;
        plain('construction', 'Construction', 'Sketch', toggle, {
          icon: <ToolIcon name="line" category="sketch" size={16} />,
          keywords: `Sketch construction geometry dashed ${on ? 'on' : 'off'}`,
        });
      }
      if (ctx.lookAtSketch) {
        plain('lookAtSketch', 'Look At Sketch', 'Sketch', ctx.lookAtSketch, {
          icon: icon(ScanEye),
          keywords: 'Sketch view plane normal',
        });
      }
      const autoProject = ctx.viewport.getState().autoProject;
      plain(
        'toggleAutoProject',
        autoProject ? 'Auto-project: Off' : 'Auto-project: On',
        'Sketch',
        () => ctx.viewport.getState().setAutoProject(!autoProject),
        {
          icon: icon(Magnet),
          keywords: 'Sketch auto project edges reference body snap projection on off',
        },
      );
    }
  }
  if (ctx.mode === 'model') for (const command of ctx.dialogCommands ?? []) add(command);
  if (ctx.mode === 'model') {
    for (const command of ctx.plugins ?? []) {
      add({
        id: command.id,
        label: command.label,
        group: command.group,
        keys: [],
        keywords: `${command.group} plugin ${command.hint ?? ''}`,
        icon: icon(Puzzle),
        run: command.run,
      });
    }
  }
  if (ctx.mode === 'model' && ctx.components) {
    const c = ctx.components;
    const group = 'Solid › Component';
    const needs = c.selected ? undefined : 'Select the bodies of one component first.';
    plain('activateComponent', 'Activate Component', group, c.activate, {
      keywords: 'component active new features go into',
      ...(needs && { unavailable: needs }),
    });
    if (c.active) plain('deactivateComponent', 'Deactivate Component', group, c.deactivate);
    plain('isolateComponent', 'Isolate Component', group, c.isolate, {
      keywords: 'component show only',
      ...(needs && { unavailable: needs }),
    });
    if (c.isolated) plain('exitIsolation', 'Exit Isolation', group, c.exitIsolation);
  }
  plain('undo', 'Undo', 'Edit', ctx.undo, { icon: icon(Undo2) });
  plain('redo', 'Redo', 'Edit', ctx.redo, { icon: icon(Redo2) });
  // Repeat last (P3-11): the last tool again, when this mode offers it and it can run.
  const last = ctx.repeat && out.find((c) => c.id === ctx.repeat?.id && !c.unavailable);
  if (last) {
    plain('repeatLast', `Repeat ${last.short ?? last.label}`, 'Edit', last.run, {
      icon: icon(Repeat2),
      keywords: 'Edit repeat again last command',
    });
  }
  if (ctx.remove) plain('delete', 'Delete', 'Edit', ctx.remove, { icon: icon(Trash2) });

  const view = () => ctx.viewport.getState();
  plain('fit', 'Fit', 'View', () => view().fit(), {
    icon: icon(Maximize),
    keywords: 'View zoom all extents',
  });
  if (ctx.lookAtSelection) {
    plain('lookAtSelection', 'Look at Selection', 'View', ctx.lookAtSelection, {
      icon: icon(ScanEye),
      keywords: 'View camera zoom selected selection focus face edge body',
    });
  }
  for (const v of VIEWS) {
    const face = FACES.find((f) => f.name === v.face);
    plain(v.id, v.label, 'View', face ? () => view().lookFrom(face.normal) : () => view().home(), {
      icon: icon(face ? Box : House),
      keywords: 'View standard orientation camera',
    });
  }
  // Named views (ADR-0008's amendment): save the camera now, or restore one.
  if (ctx.views) {
    plain('saveNamedView', 'Save Current View…', 'View', ctx.views.save, {
      icon: icon(Video),
      keywords: 'View named save camera recall orientation store',
    });
    for (const v of ctx.views.list) {
      plain(`namedView:${v.id}`, `View: ${v.name}`, 'View', () => ctx.views?.restore(v.id), {
        icon: icon(Video),
        keywords: `View named restore camera ${v.name}`,
      });
    }
  }
  plain(
    'toggleBrowser',
    ctx.browser.collapsed ? 'Show Browser' : 'Hide Browser',
    'Panels',
    ctx.browser.toggle,
    { icon: icon(PanelLeft), keywords: 'Panels browser tree' },
  );
  if (ctx.settings) {
    plain('openSettings', 'Settings…', 'Panels', ctx.settings.open, {
      icon: icon(Settings),
      inFields: true,
      keywords: 'Panels settings preferences options theme density material units mouse navigation',
    });
  }
  if (ctx.markingMenu) {
    plain(
      'markingMenuStyle',
      ctx.markingMenu.radial ? 'Right-Click Menu: Use a List' : 'Right-Click Menu: Use the Ring',
      'Panels',
      ctx.markingMenu.toggle,
      { icon: icon(Circle), keywords: 'Panels marking menu radial right click context list' },
    );
  }
  if (ctx.markingMenu?.customize) {
    plain('customizeMarkingMenu', 'Customize Marking Menu…', 'Panels', ctx.markingMenu.customize, {
      icon: icon(Circle),
      keywords: 'Panels marking menu radial right click wedges remap assign commands settings',
    });
  }
  if (ctx.notifications) {
    plain('notificationHistory', 'Notification History', 'Panels', ctx.notifications.open, {
      icon: icon(Bell),
      keywords: 'Panels notifications messages toasts errors log earlier',
    });
  }

  if (ctx.desktop) {
    const { desktop } = ctx;
    // On macOS the native menu's Quit (Cmd+Q) already runs it.
    plain('quit', 'Quit', 'Home › Design', desktop.quit, {
      keys: desktop.nativeMenu ? [] : keysFor('quit'),
      icon: icon(Power),
      keywords: 'Home file quit exit close extrudo desktop',
    });
    if (desktop.clearRecent) {
      plain('clearRecent', 'Clear Recent Files', 'Home › Design', desktop.clearRecent, {
        icon: icon(Trash2),
        keywords: 'Home file open recent clear forget list desktop',
      });
    }
    if (desktop.checkForUpdates) {
      plain('checkForUpdates', 'Check for Updates…', 'Help', desktop.checkForUpdates, {
        icon: icon(RefreshCw),
        keywords: 'Help update version new release upgrade desktop',
      });
    }
  }
  if (ctx.tutorial) {
    plain('tutorial', 'Tutorial', 'Help', ctx.tutorial.start, {
      icon: icon(GraduationCap),
      keywords: 'Help tutorial tour guide learn first box getting started onboarding',
    });
  }
  if (ctx.docs) {
    const open = (page: DocsPage) => ctx.docs?.open(page);
    // F1 (P6-06 S9): the docs page of the tool whose tile was hovered or
    // focused last, or the user guide when none was.
    plain(
      'help',
      'Help for this tool',
      'Help',
      () => {
        const tool = toolUnderPointer();
        open(tool ? { tool } : 'guide');
      },
      {
        icon: icon(BookOpen),
        inFields: true,
        keywords: 'Help F1 docs tool reference guide learn documentation',
      },
    );
    // The Help menu's four docs items (P6-06 S9); the same commands in Ctrl+K
    // and the desktop's Help menu. F1 is the `help` command's key alone, so
    // the desktop Help menu doesn't list it twice.
    plain('docsGuide', 'User Guide', 'Help', () => open('guide'), {
      icon: icon(BookOpen),
      keywords: 'Help docs user guide manual learn documentation',
    });
    plain('docsTutorials', 'Tutorials', 'Help', () => open('tutorials'), {
      icon: icon(ListChecks),
      keywords: 'Help docs tutorials walkthroughs lessons learn',
    });
    plain('docsExamples', 'Examples', 'Help', () => open('examples'), {
      icon: icon(Shapes),
      keywords: 'Help docs examples gallery sample models learn',
    });
    plain('docsTools', 'Tool Reference', 'Help', () => open('tools'), {
      icon: icon(Wrench),
      keywords: 'Help docs tool reference every tool learn',
    });
  }

  const themes: [ThemeChoice, string, typeof Box][] = [
    ['dark', 'Dark Theme', Moon],
    ['light', 'Light Theme', Sun],
    ['system', 'Match System Theme', SunMoon],
  ];
  for (const [choice, label, Icon] of themes) {
    if (choice !== ctx.theme.choice) {
      plain(`theme-${choice}`, label, 'Theme', () => ctx.theme.set(choice), {
        icon: icon(Icon),
        keywords: 'Theme colours appearance',
      });
    }
  }
  return out;
}

/**
 * The Home tab's tools that work on the model (ADR-0079): the tab stays in a sketch,
 * so they are there, saying why they can't run, like the drawing import outside one.
 */
const MODEL_ONLY: ReadonlySet<string> = new Set(['importBody', 'canvas', 'customizer']);

/** A model-only tool in a sketch: the command with the reason it can't run. */
function modelOnly(ctx: CommandContext, command: AppCommand): AppCommand {
  const reason = `Finish the sketch to use ${command.label}.`;
  return { ...command, unavailable: reason, run: () => ctx.notify('info', reason) };
}

/** The drawing import outside a sketch: the command with the reason it can't run. */
function noDrawing(ctx: CommandContext, command: AppCommand): AppCommand {
  return {
    ...command,
    unavailable: DRAWING_IMPORT_UNAVAILABLE,
    run: () => ctx.notify('info', DRAWING_IMPORT_UNAVAILABLE),
  };
}

/** A joint with fewer than two components (ADR-0081 §4): the command with the reason. */
function noJoint(ctx: CommandContext, command: AppCommand): AppCommand {
  const reason = 'Make two components first.';
  return { ...command, unavailable: reason, run: () => ctx.notify('info', reason) };
}

/** Whether a tool runs: built, or made ready by a registered feature dialog (P2-05). */
export function isToolReady(tool: Pick<Tool, 'id' | 'comesWith'>, ready?: ReadonlySet<string>) {
  return tool.comesWith === undefined || (ready?.has(tool.id) ?? false);
}

/** One shortcut per key of every command that has keys. */
export function commandShortcuts(commands: readonly AppCommand[]): Shortcut[] {
  return commands.flatMap((command) =>
    command.keys.map((keys) => ({ keys, run: command.run, inFields: command.inFields })),
  );
}
