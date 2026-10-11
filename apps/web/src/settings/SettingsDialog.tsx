import { createDocument, type EvaluateResult, evaluateParameters } from '@extrudo/core';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { ThemeChoice } from '../design-system';
import { Button, Dialog, DialogClose, IconButton, Select, TextInput } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import type { Platform, Preferences } from '../platform';
import { SLICERS, type SlicerId } from '../platform/slicer';
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
import { NAV_PRESETS } from '../viewport/navigation';
import { VISUAL_STYLES, type ViewportSettings } from '../viewport/store';
import { type DisplayAccess, useDisplaySettings } from './displaySettings';
import { type SectionId, type SectionInfo, visibleSections } from './inventory';

const SECTION_KEY = 'settings.section';
const EXPORT_KEY = 'export.model';
const SLICER_PATHS_KEY = 'slicers.paths';

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
  /** Absent where there is no marking menu to customize (the home screen). */
  onCustomizeMarking?: () => void;
  /** The desktop build: shows the Desktop section. */
  desktop: boolean;
  installedSlicers?: Platform['installedSlicers'];
}

/**
 * The Settings dialog (ADR-0082): the person's preferences in one place. Sections in a list on
 * the left (a select when narrow), the selected page on the right. It reads and writes the same
 * state as the gear menu, the sketch palette, Print Info and the Export dialog, so an edit in
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
          <Page id={current.id} {...props} onClose={() => onOpenChange(false)} />
        </section>
      </div>
    </Dialog>
  );
}

function Page({
  id,
  ...props
}: SettingsDialogProps & { id: SectionId; onClose(): void }): ReactNode {
  switch (id) {
    case 'general':
      return <General {...props} />;
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

function General({
  theme,
  onThemeChange,
  markingRadial,
  onMarkingRadial,
  onCustomizeMarking,
  onClose,
}: SettingsDialogProps & { onClose(): void }) {
  return (
    <>
      <Heading>Appearance</Heading>
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
      <Heading>Right-click menu</Heading>
      <Check
        label="Radial right-click menu"
        checked={markingRadial}
        onChange={() => onMarkingRadial()}
        hint="A ring of eight commands around the pointer. Off draws one plain list."
      />
      {onCustomizeMarking && (
        <div className="py-1.5">
          <Button
            onClick={() => {
              onClose();
              onCustomizeMarking();
            }}
          >
            Customize Marking Menu…
          </Button>
        </div>
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
    </>
  );
}

function SlicerPath({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit(path: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <TextInput
      aria-label={label}
      placeholder="Detected automatically"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft);
      }}
    />
  );
}
