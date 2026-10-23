import { createDocument, type EvaluateResult, evaluateParameters } from '@extrudo/core';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { type AgentSetupId, agentSetups } from '../agent/clientSetup';
import { useAgentStatus } from '../agent/useAgentBridge';
import type { ThemeChoice } from '../design-system';
import { Button, Dialog, DialogClose, IconButton, Select, TextInput } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import type {
  AgentBridge,
  AgentConfig,
  AgentSkillTarget,
  AgentStatus,
  Platform,
  Preferences,
} from '../platform';
import { SLICERS, type SlicerId } from '../platform/slicer';
import { PluginsSection, type PluginsSectionProps } from '../plugins/PluginsList';
import {
  checkPrintField,
  DEFAULT_MATERIAL,
  densityExpression,
  FILAMENT_DIAMETERS,
  isDensityOverridden,
  MATERIALS,
  type MaterialChoice,
  type PrintField,
  withDensity,
  withoutDensity,
} from '../print/material';
import { materialStore, useMaterialChoice } from '../print/materialStore';
import { MarkingMenuEditor, type MarkingMenuEditorProps } from '../shell/MarkingMenuEditor';
import { NAV_PRESETS } from '../viewport/navigation';
import { VISUAL_STYLES, type ViewportSettings } from '../viewport/store';
import { type DisplayAccess, useDisplaySettings } from './displaySettings';
import { type SectionId, type SectionInfo, visibleSections } from './inventory';
import { KeyboardPage } from './KeyboardPage';

const SECTION_KEY = 'settings.section';
const EXPORT_KEY = 'export.model';
const SLICER_PATHS_KEY = 'slicers.paths';
// Where Blender is, for Render Picture (P6-13); empty: main searches.
const BLENDER_PATH_KEY = 'blender.path';
// The desktop MCP server (P6-08, ADR-0087 §3): main reads both itself.
const MCP_ENABLED_KEY = 'mcp.enabled';
const MCP_PORT_KEY = 'mcp.port';
const DEFAULT_MCP_PORT = 7474;

let emptyDocument: ReturnType<typeof createDocument> | undefined;
const empty = () => {
  emptyDocument ??= createDocument();
  return emptyDocument;
};

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  preferences: Preferences;
  /** The display settings: the project's viewport store, or the preference on the home screen. */
  display: DisplayAccess;
  /** The open design, whose parameters the number fields may use. */
  doc?: Parameters<typeof evaluateParameters>[0];
  theme: ThemeChoice;
  onThemeChange(choice: ThemeChoice): void;
  markingRadial: boolean;
  onMarkingRadial(): void;
  /** The ring editor's state; absent where there are no commands to put on it (the home screen). */
  marking?: MarkingMenuEditorProps | undefined;
  /** The desktop build: shows the Desktop section. */
  desktop: boolean;
  installedSlicers?: Platform['installedSlicers'];
  /** The desktop MCP server (P6-08): its switch, port, status and client config. */
  agent?: AgentBridge | undefined;
  /** The Plugins section's stores and handlers (ADR-0090 §2). */
  plugins: PluginsSectionProps;
  /** A section to show each time the dialog opens (Ctrl+K "Plugins…"); else the last one. */
  section?: SectionId | undefined;
  /** A command whose key the Keyboard section records at once ("Change shortcut…"). */
  recordKey?: string | undefined;
}

/**
 * The Settings dialog (ADR-0082): the person's preferences in one place. Sections in a list on
 * the left (a select when narrow), the selected page on the right. It reads and writes the same
 * state as the app menu, the sketch palette, Print Info and the Export dialog, so an edit in
 * either place shows in the other at once.
 *
 * Test hooks: `dialog` "Settings", the navigation `[data-settings-nav]` with a button per
 * section (`data-settings-section`), the page `[data-settings-page="<id>"]`.
 */
export function SettingsDialog(props: SettingsDialogProps) {
  const { open, onOpenChange, preferences, desktop } = props;
  const sections = visibleSections(desktop);
  const [section, setSection] = useState<SectionId>(() => {
    const stored = preferences.get<string>(SECTION_KEY, '');
    return sections.find((s) => s.id === stored)?.id ?? (sections[0]?.id as SectionId);
  });
  const choose = (id: SectionId) => {
    setSection(id);
    preferences.set(SECTION_KEY, id);
  };
  const requested = props.section;
  useEffect(() => {
    if (open && requested) setSection(requested);
  }, [open, requested]);
  const current = sections.find((s) => s.id === section) ?? (sections[0] as SectionInfo);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="large"
      title="Settings"
      description="Your preferences, kept on this device and not in any design."
      className="h-[min(640px,calc(100vh-48px))]"
      actions={
        <DialogClose asChild>
          <IconButton label="Close">
            <X size={18} strokeWidth={1.75} />
          </IconButton>
        </DialogClose>
      }
    >
      <div className="flex min-h-[420px] gap-6 max-sm:flex-col max-sm:gap-3">
        <nav
          aria-label="Settings sections"
          data-settings-nav=""
          className="flex w-48 shrink-0 flex-col gap-0.5 max-sm:hidden"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              data-settings-section={s.id}
              aria-current={s.id === current.id ? 'page' : undefined}
              onClick={() => choose(s.id)}
              className={`rounded-control px-3 py-1.5 text-left text-base ${
                s.id === current.id ? 'bg-accent-soft font-semibold' : 'hover:bg-accent-soft'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <Select
          aria-label="Section"
          className="sm:hidden"
          value={current.id}
          onChange={(event) => choose(event.target.value as SectionId)}
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
        <section
          aria-label={current.label}
          data-settings-page={current.id}
          className="min-w-0 flex-1"
        >
          <h3 className="text-base font-semibold">{current.label}</h3>
          <p className="mb-4 text-sm text-muted">{current.summary}</p>
          <Page id={current.id} {...props} />
        </section>
      </div>
    </Dialog>
  );
}

function Page({ id, ...props }: SettingsDialogProps & { id: SectionId }): ReactNode {
  switch (id) {
    case 'general':
      return <Appearance {...props} />;
    case 'plugins':
      return <PluginsSection {...props.plugins} />;
    case 'marking':
      return <MarkingPage {...props} />;
    case 'keyboard':
      return (
        <KeyboardPage
          preferences={props.preferences}
          commands={props.marking?.commands}
          record={props.recordKey}
        />
      );
    case 'view':
      return <View display={props.display} />;
    case 'sketch':
      return <SketchPage display={props.display} />;
    case 'printing':
      return <Printing preferences={props.preferences} doc={props.doc} />;
    case 'export':
      return <ExportPage preferences={props.preferences} />;
    case 'desktop':
      return <DesktopPage preferences={props.preferences} installed={props.installedSlicers} />;
    case 'agents':
      return <AgentsPage preferences={props.preferences} agent={props.agent} />;
  }
}

// ------------------------------------------------------------------ pieces

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] items-start gap-x-4 gap-y-1 py-1.5 max-sm:grid-cols-1">
      <span className="pt-1 text-sm text-muted">{label}</span>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  hint?: string;
}) {
  return (
    <div className="py-1">
      <label className="flex cursor-pointer items-center gap-2 text-base">
        <input
          type="checkbox"
          className="accent-(--x-accent)"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
      {hint && <p className="ml-6 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h4 className="mt-5 mb-1 border-b border-line pb-1 text-xs font-semibold tracking-wide text-muted uppercase first:mt-0">
      {children}
    </h4>
  );
}

// ------------------------------------------------------------------ pages

function Appearance({ theme, onThemeChange }: SettingsDialogProps) {
  return (
    <>
      <Row label="Theme">
        <fieldset className="m-0 flex gap-4 border-0 p-0">
          <legend className="sr-only">Theme</legend>
          {(
            [
              ['system', 'System'],
              ['dark', 'Dark'],
              ['light', 'Light'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-1.5 text-base">
              <input
                type="radio"
                name="settings-theme"
                className="accent-(--x-accent)"
                checked={theme === value}
                onChange={() => onThemeChange(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      </Row>
    </>
  );
}

/** The switch, then the ring editor inline (ADR-0090 §2: it was a dialog of its own). */
function MarkingPage({ markingRadial, onMarkingRadial, marking }: SettingsDialogProps) {
  return (
    <>
      <Check
        label="Radial right-click menu"
        checked={markingRadial}
        onChange={() => onMarkingRadial()}
        hint="A ring of eight commands around the pointer. Off draws one plain list."
      />
      <Heading>Commands on the ring</Heading>
      {marking ? (
        <div className="flex h-[440px] flex-col rounded-control border border-line">
          <MarkingMenuEditor {...marking} />
        </div>
      ) : (
        <p className="text-sm text-muted">Open a design to choose the command on each wedge.</p>
      )}
    </>
  );
}

function View({ display }: { display: DisplayAccess }) {
  const s = useDisplaySettings(display);
  const preset = NAV_PRESETS.find((p) => p.value === s.preset);
  return (
    <>
      <Heading>Navigation</Heading>
      <Row label="Mouse buttons" hint={preset?.summary}>
        <Select
          aria-label="Mouse buttons"
          value={s.preset}
          onChange={(e) => display.set({ preset: e.target.value as ViewportSettings['preset'] })}
        >
          {NAV_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Projection">
        <Select
          aria-label="Projection"
          value={s.projection}
          onChange={(e) =>
            display.set({ projection: e.target.value as ViewportSettings['projection'] })
          }
        >
          <option value="perspective">Perspective</option>
          <option value="orthographic">Orthographic</option>
        </Select>
      </Row>
      <Heading>Display</Heading>
      <Row label="Visual style">
        <Select
          aria-label="Visual style"
          value={s.visualStyle}
          onChange={(e) =>
            display.set({ visualStyle: e.target.value as ViewportSettings['visualStyle'] })
          }
        >
          {VISUAL_STYLES.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </Select>
      </Row>
      <Check label="Show grid" checked={s.grid} onChange={(grid) => display.set({ grid })} />
    </>
  );
}

function SketchPage({ display }: { display: DisplayAccess }) {
  const s = useDisplaySettings(display);
  const flag = (key: keyof ViewportSettings, label: string, hint?: string) => (
    <Check
      label={label}
      hint={hint}
      checked={s[key] as boolean}
      onChange={(value) => display.set({ [key]: value })}
    />
  );
  return (
    <>
      <Heading>Drawing</Heading>
      {flag('snap', 'Snap to grid')}
      {flag(
        'autoProject',
        'Auto-project body edges',
        'A body edge or vertex a tool snaps to is projected into the sketch.',
      )}
      {flag('autoProjectFace', 'Auto-project face outline', 'When a sketch starts on a flat face.')}
      <Heading>Shown in a sketch</Heading>
      {flag('sketchPoints', 'Show points')}
      {flag('sketchConstraints', 'Show constraints')}
      {flag('sketchDimensions', 'Show dimensions')}
      {flag('sketchProfiles', 'Show profiles')}
      {flag(
        'sketchSlice',
        'Slice',
        'Cut the bodies away on the camera side of the sketch plane while it is open.',
      )}
    </>
  );
}

function Printing({
  preferences,
  doc,
}: {
  preferences: Preferences;
  doc?: SettingsDialogProps['doc'];
}) {
  const choice = useMaterialChoice(preferences);
  const store = materialStore(preferences);
  const evaluation = useMemo(() => evaluateParameters(doc ?? empty()), [doc]);
  // Plain numbers of the field's own unit, like Print Info (a density is g/cm³ whatever the
  // document's units); the open design's parameters are there to use.
  const check =
    (field: PrintField) =>
    (expression: string): EvaluateResult =>
      checkPrintField(field, expression, evaluation.evaluate(expression, 'unitless'));
  const set = (change: Partial<MaterialChoice>) => store.set(change);
  const numeric = (
    field: Exclude<PrintField, 'density'>,
    label: string,
    unit: string,
    value: string,
    write: (expression: string) => void,
    defaults: string,
  ) => (
    <Row label={label}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ExpressionInput
            label={label}
            value={value}
            evaluate={check(field)}
            format={(r) => `${r.value} ${unit}`}
            onCommit={write}
            onDraftChange={(expression, valid) => {
              if (valid) write(expression);
            }}
          />
        </div>
        {value !== defaults && (
          <ResetButton label={`Reset ${label}`} onClick={() => write(defaults)} />
        )}
      </div>
    </Row>
  );
  const wall = (expression: string) => {
    const result = check('walls')(expression);
    if (result.ok) set({ walls: Math.round(result.value) });
  };
  return (
    <>
      <Heading>Materials</Heading>
      <p className="mb-2 text-xs text-muted">
        Density in g/cm³. A material you haven't changed follows Extrudo's value.
      </p>
      <div className="flex flex-col divide-y divide-line">
        {MATERIALS.map((m) => (
          <div
            key={m.id}
            className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-start gap-3 py-1.5"
          >
            <span className="pt-1 text-base" data-material={m.id}>
              {m.label}
            </span>
            <ExpressionInput
              label={`${m.label} density`}
              value={densityExpression(choice, m.id)}
              evaluate={check('density')}
              format={(r) => `${r.value} g/cm³`}
              onCommit={(expression) =>
                set({ densities: withDensity(choice, m.id, expression).densities })
              }
              onDraftChange={(expression, valid) => {
                if (valid) set({ densities: withDensity(choice, m.id, expression).densities });
              }}
            />
            {isDensityOverridden(choice, m.id) ? (
              <ResetButton
                label={`Reset ${m.label} density`}
                onClick={() => set({ densities: withoutDensity(choice, m.id).densities })}
              />
            ) : (
              <span className="w-14" />
            )}
          </div>
        ))}
        <div className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-start gap-3 py-1.5">
          <span className="pt-1 text-base">Custom</span>
          <ExpressionInput
            label="Custom density"
            value={choice.density}
            evaluate={check('density')}
            format={(r) => `${r.value} g/cm³`}
            onCommit={(density) => set({ density })}
            onDraftChange={(density, valid) => {
              if (valid) set({ density });
            }}
          />
          {choice.density !== DEFAULT_MATERIAL.density ? (
            <ResetButton
              label="Reset Custom density"
              onClick={() => set({ density: DEFAULT_MATERIAL.density })}
            />
          ) : (
            <span className="w-14" />
          )}
        </div>
      </div>
      <Heading>Print</Heading>
      <Row label="Material for estimates">
        <Select
          aria-label="Material for estimates"
          value={choice.material}
          onChange={(e) => set({ material: e.target.value as MaterialChoice['material'] })}
        >
          {MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value="custom">Custom density</option>
        </Select>
      </Row>
      <Row label="Filament diameter">
        <fieldset className="m-0 flex gap-4 border-0 p-0">
          <legend className="sr-only">Filament diameter</legend>
          {FILAMENT_DIAMETERS.map((d) => (
            <label key={d} className="flex cursor-pointer items-center gap-1.5 text-base">
              <input
                type="radio"
                name="settings-filament-diameter"
                aria-label={`Filament ${d} mm`}
                className="accent-(--x-accent)"
                checked={choice.diameter === d}
                onChange={() => set({ diameter: d })}
              />
              {d} mm
            </label>
          ))}
        </fieldset>
      </Row>
      {numeric('walls', 'Walls', '', String(choice.walls), wall, String(DEFAULT_MATERIAL.walls))}
      {numeric(
        'lineWidth',
        'Line width',
        'mm',
        choice.lineWidth,
        (lineWidth) => set({ lineWidth }),
        DEFAULT_MATERIAL.lineWidth,
      )}
      {numeric(
        'infill',
        'Infill',
        '%',
        choice.infill,
        (infill) => set({ infill }),
        DEFAULT_MATERIAL.infill,
      )}
      {numeric(
        'price',
        'Price per kg',
        '/ kg',
        choice.price,
        (price) => set({ price }),
        DEFAULT_MATERIAL.price,
      )}
      <div className="mt-4 border-t border-line pt-3">
        <Button onClick={() => store.replace({ ...DEFAULT_MATERIAL })}>
          Reset 3D printing to defaults
        </Button>
      </div>
    </>
  );
}

function ResetButton({ onClick, label = 'Reset' }: { onClick(): void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 rounded-control px-2 py-1 text-xs text-muted underline hover:bg-accent-soft hover:text-ink"
    >
      Reset
    </button>
  );
}

interface RememberedExport {
  format: string;
  resolution: string;
}

function ExportPage({ preferences }: { preferences: Preferences }) {
  const read = () => preferences.get<Partial<RememberedExport>>(EXPORT_KEY, {});
  const [stored, setStored] = useState(read);
  const write = (change: Partial<RememberedExport>) => {
    // The Export dialog keeps more here (custom deviation, the slicer): keep it.
    const next = { ...preferences.get<Record<string, unknown>>(EXPORT_KEY, {}), ...change };
    preferences.set(EXPORT_KEY, next);
    setStored(next as Partial<RememberedExport>);
  };
  return (
    <>
      <Heading>Model export</Heading>
      <Row label="Format">
        <Select
          aria-label="Default format"
          value={stored.format ?? '3mf'}
          onChange={(e) => write({ format: e.target.value })}
        >
          <option value="3mf">3MF</option>
          <option value="stl">STL</option>
          <option value="step">STEP</option>
        </Select>
      </Row>
      <Row
        label="Resolution"
        hint="A mesh's deviation from the exact surface. Custom values are set in the Export dialog."
      >
        <Select
          aria-label="Default resolution"
          value={stored.resolution ?? 'medium'}
          onChange={(e) => write({ resolution: e.target.value })}
        >
          <option value="coarse">Coarse</option>
          <option value="medium">Medium</option>
          <option value="fine">Fine</option>
          {stored.resolution === 'custom' && <option value="custom">Custom</option>}
        </Select>
      </Row>
    </>
  );
}

function DesktopPage({
  preferences,
  installed,
}: {
  preferences: Preferences;
  installed?: Platform['installedSlicers'];
}) {
  const [paths, setPaths] = useState(() =>
    preferences.get<Partial<Record<SlicerId, string>>>(SLICER_PATHS_KEY, {}),
  );
  const [blenderPath, setBlenderPath] = useState(() =>
    preferences.get<string>(BLENDER_PATH_KEY, ''),
  );
  const [found, setFound] = useState<readonly SlicerId[]>();
  useEffect(() => {
    let current = true;
    installed?.().then(
      (ids) => current && setFound(ids),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [installed]);
  const commit = (id: SlicerId, path: string) => {
    const next = { ...paths };
    if (path.trim() === '') delete next[id];
    else next[id] = path.trim();
    preferences.set(SLICER_PATHS_KEY, next);
    setPaths(next);
  };
  return (
    <>
      <Heading>Slicers</Heading>
      <p className="mb-2 text-xs text-muted">
        Extrudo looks for slicers in the usual places. Give a program's path to use that one
        instead; leave it empty to search.
      </p>
      {SLICERS.map((s) => (
        <Row
          key={s.id}
          label={s.label}
          hint={found ? (found.includes(s.id) ? 'Found.' : 'Not found.') : undefined}
        >
          <SlicerPath
            label={`${s.label} path`}
            value={paths[s.id] ?? ''}
            onCommit={(path) => commit(s.id, path)}
          />
        </Row>
      ))}
      <Heading>Blender</Heading>
      <Row
        label="Blender"
        hint="The program's path, the .app on macOS, or org.blender.Blender for the Flatpak."
      >
        <SlicerPath
          label="Blender path"
          placeholder="Found automatically"
          value={blenderPath}
          onCommit={(path) => {
            const next = path.trim();
            preferences.set(BLENDER_PATH_KEY, next);
            setBlenderPath(next);
          }}
        />
      </Row>
    </>
  );
}

/** What the server is doing, in one line (ADR-0087 §6). */
export function agentStateText(status: AgentStatus | undefined, enabled: boolean): string {
  if (!enabled) return 'Off.';
  if (!status) return 'Starting…';
  if (status.error) {
    // Something else holds the port: if it answered a client, it has seen the token.
    return /in use/.test(status.error)
      ? `${status.error} If another program answered on this port, regenerate the token.`
      : status.error;
  }
  if (!status.listening) return 'Starting…';
  return `Listening on ${status.url}`;
}

/** A port a person may pick: 1024 to 65535 (below needs root). */
export const validPort = (text: string): number | undefined => {
  const port = Number(text.trim());
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined;
};

/** The skill's state in the agent's folder, in one line (undefined while unknown). */
export function skillStateText(skill: AgentSkillTarget | undefined, known: boolean): string {
  if (!known)
    return "The skill teaches the agent how to model here: save it into the agent's skills folder.";
  if (!skill) return 'Looking…';
  if (skill.state === 'missing') return `Not installed. Install skill puts it in ${skill.dir}.`;
  if (skill.state === 'stale')
    return `Installed in ${skill.dir}: an older version. Update skill replaces it.`;
  return `Installed in ${skill.dir}, up to date.`;
}

/**
 * Settings › Agents (MCP) (P6-08, ADR-0087 §6 and its amendment of 2026-10-18):
 * the server's switch, its port (a plain number: a setting of the app, not a
 * model value, so no expression) and state, then the setup for each popular
 * agent as a text to copy, every one holding the URL and the token, and the
 * skill's state in the agent's folder with Install skill / Update skill (or
 * Save skill to… for an agent with no known folder).
 *
 * Test hooks: the page `[data-settings-page="agents"]`, combobox "Agent", the
 * textbox "Setup for <agent>" (`[data-agent-setup="<id>"]`, read-only), the `status`
 * "Skill state", buttons "Copy", "Install skill" / "Update skill" / "Save skill to…" and
 * "Regenerate token", and the `status` with the note.
 */
function AgentsPage({
  preferences,
  agent,
}: {
  preferences: Preferences;
  agent?: AgentBridge | undefined;
}) {
  if (!agent) return <p className="text-sm text-muted">Agents connect to the desktop app only.</p>;
  return <AgentSettings preferences={preferences} agent={agent} />;
}

function AgentSettings({ preferences, agent }: { preferences: Preferences; agent: AgentBridge }) {
  const status = useAgentStatus(agent);
  const [enabled, setEnabled] = useState(() => preferences.get<boolean>(MCP_ENABLED_KEY, true));
  const [port, setPort] = useState(() =>
    String(preferences.get<number>(MCP_PORT_KEY, DEFAULT_MCP_PORT)),
  );
  const [note, setNote] = useState<string>();
  const [config, setConfig] = useState<AgentConfig>();
  const [setupId, setSetupId] = useState<AgentSetupId>('claude-code');
  // The URL follows the port: the config is read once, then again when the status's URL moves.
  const url = status?.url;
  useEffect(() => {
    if (config && (url === undefined || config.url === url)) return;
    let current = true;
    agent.config().then(
      (next) => current && setConfig(next),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [agent, url, config]);
  const portValue = validPort(port);
  const commitPort = () => {
    if (portValue === undefined) return;
    if (portValue === preferences.get<number>(MCP_PORT_KEY, DEFAULT_MCP_PORT)) return;
    preferences.set(MCP_PORT_KEY, portValue);
  };
  const setups = config ? agentSetups(config) : [];
  const setup = setups.find((s) => s.id === setupId) ?? setups[0];
  // The skill in the picked agent's folder (ADR-0087 amendment 2026-10-18, skills).
  const [skill, setSkill] = useState<AgentSkillTarget>();
  const [installing, setInstalling] = useState(false);
  const target = setup?.skillTarget ? setup.id : undefined;
  useEffect(() => {
    setSkill(undefined);
    if (!target || !agent.skillState) return;
    let current = true;
    agent.skillState(target).then(
      (next) => current && setSkill(next),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [agent, target]);
  const install = () => {
    if (!agent.installSkill || !setup) return;
    setInstalling(true);
    agent.installSkill(target).then(
      (next) => {
        setInstalling(false);
        if (!next) return;
        if (target) setSkill(next);
        setNote(`Skill installed in ${next.dir}.${setup.skillNote ? ` ${setup.skillNote}` : ''}`);
      },
      () => {
        setInstalling(false);
        setNote("Couldn't install the skill.");
      },
    );
  };
  const copy = () => {
    if (!setup) return;
    navigator.clipboard.writeText(setup.text).then(
      () => setNote(`Copied. ${setup.how}`),
      () => setNote("Couldn't copy: select the text and copy it by hand."),
    );
  };
  const regenerate = () => {
    agent.regenerateToken().then(
      (next) => {
        setConfig(next);
        setNote('New token made: agents with the old one are refused. Copy the setup again.');
      },
      () => setNote("Couldn't make a new token."),
    );
  };
  return (
    <>
      <Heading>Server</Heading>
      <p className="mb-2 text-xs text-muted">
        AI agents such as Claude Code read and change the open design through a server on this
        computer. Only programs here that have the token can connect; every change they make is one
        undo step, and the top bar says "Agent connected" while one is.
      </p>
      <Check
        label="Let agents connect"
        checked={enabled}
        onChange={(on) => {
          setEnabled(on);
          preferences.set(MCP_ENABLED_KEY, on);
        }}
        hint="Off closes the server at once."
      />
      <Row label="Port" hint={portValue === undefined ? 'A port from 1024 to 65535.' : undefined}>
        <TextInput
          aria-label="MCP server port"
          inputMode="numeric"
          className="w-28"
          value={port}
          onChange={(event) => setPort(event.target.value)}
          onBlur={commitPort}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitPort();
          }}
        />
      </Row>
      <Row label="State">
        <p role="status" aria-label="MCP server state" className="pt-1 text-sm">
          {agentStateText(status, enabled)}
        </p>
      </Row>
      <Heading>Add it to your agent</Heading>
      <p className="mb-2 text-xs text-muted">
        Pick your agent and copy the text. Each one holds the token: anyone who can read it can
        change your designs while Extrudo runs. Regenerate token locks every agent out until it gets
        the new text.
      </p>
      <Row label="Agent">
        <Select
          aria-label="Agent"
          value={setup?.id ?? setupId}
          onChange={(event) => setSetupId(event.target.value as AgentSetupId)}
        >
          {setups.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
        {setup && <p className="mt-1 text-xs text-muted">{setup.how}</p>}
      </Row>
      {setup && (
        <textarea
          readOnly
          aria-label={`Setup for ${setup.label}`}
          data-agent-setup={setup.id}
          rows={Math.min(8, setup.text.split('\n').length + 1)}
          onFocus={(event) => event.target.select()}
          className="my-1.5 w-full resize-y rounded-input border border-line bg-transparent p-2 font-mono text-xs text-ink focus-visible:border-accent focus-visible:outline-none"
          value={setup.text}
        />
      )}
      {setup && (
        <Row label="Skill" hint={target ? setup.skillNote : undefined}>
          <p role="status" aria-label="Skill state" className="pt-1 text-sm">
            {skillStateText(target ? skill : undefined, target !== undefined)}
          </p>
        </Row>
      )}
      <div className="flex flex-wrap gap-2 py-1.5">
        <Button variant="primary" onClick={copy} disabled={!setup}>
          Copy
        </Button>
        {agent.installSkill && (
          <Button onClick={install} disabled={!setup || installing}>
            {target
              ? skill?.state === 'stale'
                ? 'Update skill'
                : 'Install skill'
              : 'Save skill to…'}
          </Button>
        )}
        <Button onClick={regenerate}>Regenerate token</Button>
      </div>
      {note && (
        <p role="status" className="text-xs text-muted">
          {note}
        </p>
      )}
    </>
  );
}

function SlicerPath({
  label,
  value,
  placeholder = 'Detected automatically',
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit(path: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <TextInput
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft);
      }}
    />
  );
}
