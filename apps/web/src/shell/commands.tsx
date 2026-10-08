/**
 * The shell's commands (P1-14, ADR-0023): every tool on the tabs shown in
 * the current mode plus edit, view, panel, file and theme commands, each
 * with its keys from the keymap. The same list drives the shortcuts, the
 * Ctrl+K palette and the S toolbox, so a command found in search runs the
 * same way as its key.
 */
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
  Puzzle,
  Redo2,
  Repeat2,
  ScanEye,
  Shapes,
  Sun,
  SunMoon,
  Trash2,
  Undo2,
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
  /** Macro recording (P5-05): whether one runs; Record and Stop show accordingly. */
  macro?: { recording: boolean };
  /** The right-click menu's style (P3-11): the ring, or one plain list. */
  markingMenu?: { radial: boolean; toggle(): void; customize?: () => void };
  theme: { choice: ThemeChoice; set(choice: ThemeChoice): void };
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
  const unavailable = !isToolReady(tool, ctx.ready) && `Arrives with ${tool.comesWith}.`;
  return {
    id,
    label: tool.label,
    ...(tool.short && { short: tool.short }),
    group,
    keywords: `${group} ${tool.hint}`,
    icon: <ToolIcon name={tool.icon} category={tool.category} size={16} />,
    keys: keysFor(id),
    ...(unavailable && { unavailable }),
    run: unavailable
      ? () => ctx.notify('info', `${tool.label} arrives with ${tool.comesWith}.`)
      : () => ctx.runTool(id),
  };
}

/** Words search also finds a file command by (ADR-0079), beyond its group and hint. */
const FILE_KEYWORDS: Record<FileCommandId, string> = {
  newDesign: 'file create blank',
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
    keys: keysFor(id),
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
  for (const v of VIEWS) {
    const face = FACES.find((f) => f.name === v.face);
    plain(v.id, v.label, 'View', face ? () => view().lookFrom(face.normal) : () => view().home(), {
      icon: icon(face ? Box : House),
      keywords: 'View standard orientation camera',
    });
  }
  plain(
    'toggleBrowser',
    ctx.browser.collapsed ? 'Show Browser' : 'Hide Browser',
    'Panels',
    ctx.browser.toggle,
    { icon: icon(PanelLeft), keywords: 'Panels browser tree' },
  );
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

/** Whether a tool runs: built, or made ready by a registered feature dialog (P2-05). */
export function isToolReady(tool: Pick<Tool, 'id' | 'comesWith'>, ready?: ReadonlySet<string>) {
  return tool.comesWith === undefined || (ready?.has(tool.id) ?? false);
}

/** One shortcut per key of every command that has keys. */
export function commandShortcuts(commands: readonly AppCommand[]): Shortcut[] {
  return commands.flatMap((command) => command.keys.map((keys) => ({ keys, run: command.run })));
}
