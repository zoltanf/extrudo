/**
 * The right column with nothing selected (P6-24, plan §4.3): the open sheet's setup and
 * Finish Drawing. Every change is one command and one undo step (`changeSheet`); every
 * number field is an `ExpressionInput` and stores the evaluated number (plan §5.3), so a
 * later parameter rename can't break a sheet.
 *
 * "Drawn by" is never written by itself (plan §5.3): it stays empty until typed, and the
 * last name typed there (the `sheet.drawnBy` preference) is offered as a button.
 *
 * Test hooks: the region "Sheet setup"; the fields by their labels ("Sheet name", "Paper",
 * "Width", "Height", "Scale: model", "Scale: sheet", "Decimals", one per title-block field:
 * "Title", "Drawn by", …), the radio groups "Orientation" and "Projection", the switches
 * "Border" and "Zones", the button "Finish Drawing".
 */
import {
  type EvaluateResult,
  ExprError,
  type ExtrudoDocument,
  evaluateParameters,
  formatQuantity,
  SHEET_DECIMALS_MAX,
  SHEET_SIDE_MAX,
  SHEET_SIDE_MIN,
  type Sheet,
  type SheetChanges,
  sheetPaperSize,
} from '@extrudo/core';
import { sheetTitleFields } from '@extrudo/sheets';
import { type RefObject, useMemo } from 'react';
import { Button, Select, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import type { Preferences } from '../platform/preferences';
import { CommitField, Row, Segmented, Switch } from './controls';
import { isoDate, PAPER_CHOICES, type SheetTitleChoice, sheetNameProblem } from './defaults';

/** The preference that remembers the last "Drawn by" typed, to offer it (never to write it). */
export const DRAWN_BY_KEY = 'sheet.drawnBy';

export interface SheetSetupProps {
  doc: Pick<ExtrudoDocument, 'name' | 'settings' | 'parameters' | 'sheets'> & ExtrudoDocument;
  sheet: Sheet;
  /** Applies one change as one undo step; returns a refusal's message. */
  change(changes: SheetChanges, label: string): string | undefined;
  rename(name: string): string | undefined;
  preferences: Preferences;
  notify(tone: 'info' | 'error', text: string): void;
  onFinish(): void;
  /** Sheet Setup (the tool) puts the focus here. */
  nameField?: RefObject<HTMLInputElement | null>;
}

const TITLE_CHOICES: { value: SheetTitleChoice; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'full', label: 'Full' },
  { value: 'none', label: 'None' },
];

const fail = (expression: string, message: string): EvaluateResult => ({
  ok: false,
  error: new ExprError(message, { start: 0, end: expression.length }),
});

export function SheetSetup({
  doc,
  sheet,
  change,
  rename,
  preferences,
  notify,
  onFinish,
  nameField,
}: SheetSetupProps) {
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const sheets = doc.sheets ?? [];
  const index = sheets.findIndex((s) => s.id === sheet.id);
  const paper = sheetPaperSize(sheet);
  const settings = doc.settings;
  const apply = (changes: SheetChanges, label: string) => {
    const problem = change(changes, label);
    if (problem) notify('error', problem);
  };

  const positive = (expression: string): EvaluateResult => {
    const r = evaluation.evaluate(expression, 'unitless');
    if (!r.ok) return r;
    return r.value > 0 ? r : fail(expression, 'A scale needs numbers above 0.');
  };
  const side = (expression: string): EvaluateResult => {
    const r = evaluation.evaluate(expression, 'length');
    if (!r.ok) return r;
    return r.value >= SHEET_SIDE_MIN && r.value <= SHEET_SIDE_MAX
      ? r
      : fail(expression, `A side is ${SHEET_SIDE_MIN} to ${SHEET_SIDE_MAX} mm.`);
  };
  const decimals = (expression: string): EvaluateResult => {
    const r = evaluation.evaluate(expression, 'unitless');
    if (!r.ok) return r;
    return Number.isInteger(r.value) && r.value >= 0 && r.value <= SHEET_DECIMALS_MAX
      ? r
      : fail(expression, `Decimals are a whole number from 0 to ${SHEET_DECIMALS_MAX}.`);
  };
  // A plain number without trailing zeros ("= 2", "= 0.5"); a length in the design's unit.
  const plain = (r: Extract<EvaluateResult, { ok: true }>) =>
    r.dim.length === 0 && r.dim.angle === 0
      ? String(Math.round(r.value * 1000) / 1000)
      : formatQuantity(r.value, r.dim, { ...settings, precision: 2 });
  const value = (expression: string, check: (e: string) => EvaluateResult) => {
    const r = check(expression);
    return r.ok ? r.value : undefined;
  };

  const custom = typeof sheet.size !== 'string';
  const sides = typeof sheet.size === 'string' ? [paper.width, paper.height] : sheet.size;
  const template = sheet.titleBlock?.template;
  const fields = sheet.titleBlock?.fields ?? {};
  const remembered = preferences.get<string>(DRAWN_BY_KEY, '');
  const setField = (field: string, label: string, text: string) => {
    if (!sheet.titleBlock) return;
    const next = { ...sheet.titleBlock.fields };
    if (text === '') delete next[field];
    else next[field] = text;
    apply({ titleBlock: { ...sheet.titleBlock, fields: next } }, `Title block: ${label}`);
    if (field === 'drawnBy' && text.trim() !== '') preferences.set(DRAWN_BY_KEY, text);
  };

  return (
    <section
      aria-label="Sheet setup"
      className="pointer-events-auto flex shrink-0 flex-col gap-3 rounded-dialog border border-line p-3 shadow-raised backdrop-blur-[6px]"
      style={{ background: 'color-mix(in srgb, var(--x-raised) 92%, transparent)' }}
    >
      <div className="flex items-center gap-2">
        <ToolIcon name="sheet-setup" category="file" size={18} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Sheet setup</h2>
        <span className="text-sm whitespace-nowrap text-muted">
          sheet {index + 1} of {sheets.length}
        </span>
      </div>
      <div className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5">
        <Row label="Name">
          <CommitField
            key={`${sheet.id}:name`}
            label="Sheet name"
            value={sheet.name}
            inputRef={nameField}
            maxLength={100}
            onCommit={(name) => sheetNameProblem(sheets, sheet.id, name) ?? rename(name)}
          />
        </Row>
        <Row label="Paper">
          <Select
            aria-label="Paper"
            className="h-7"
            value={custom ? 'custom' : (sheet.size as string)}
            onChange={(event) => {
              const next = event.target.value;
              if (next === 'custom') {
                apply({ size: [round(paper.width), round(paper.height)] }, 'Sheet size');
              } else apply({ size: next as Sheet['size'] }, 'Sheet size');
            }}
          >
            {PAPER_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
            <option value="custom">Custom size</option>
          </Select>
        </Row>
        {custom && (
          <>
            <Row label="Width">
              <ExpressionInput
                key={`${sheet.id}:w:${sides[0]}`}
                label="Width"
                value={`${round(sides[0] ?? 0)} mm`}
                evaluate={side}
                format={plain}
                onCommit={(e) => {
                  const w = value(e, side);
                  if (w !== undefined) apply({ size: [w, sides[1] ?? w] }, 'Sheet size');
                }}
              />
            </Row>
            <Row label="Height">
              <ExpressionInput
                key={`${sheet.id}:h:${sides[1]}`}
                label="Height"
                value={`${round(sides[1] ?? 0)} mm`}
                evaluate={side}
                format={plain}
                onCommit={(e) => {
                  const h = value(e, side);
                  if (h !== undefined) apply({ size: [sides[0] ?? h, h] }, 'Sheet size');
                }}
              />
            </Row>
          </>
        )}
        <Row label="Orientation">
          <Segmented<Sheet['orientation']>
            label="Orientation"
            value={sheet.orientation}
            options={[
              { value: 'landscape', label: 'Landscape' },
              { value: 'portrait', label: 'Portrait' },
            ]}
            onChange={(orientation) => apply({ orientation }, 'Sheet orientation')}
          />
        </Row>
        <Row label="Border">
          <div className="flex flex-col">
            <Switch
              checked={sheet.border !== undefined}
              onChange={(on) => apply({ border: on ? {} : null }, 'Sheet border')}
            >
              Border
            </Switch>
            <Switch
              checked={sheet.border?.zones === true}
              disabled={sheet.border === undefined}
              onChange={(on) =>
                apply({ border: on ? { zones: true } : {} }, on ? 'Zone border' : 'Sheet border')
              }
            >
              Zones
            </Switch>
          </div>
        </Row>
        <Row label="Scale">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
            <ExpressionInput
              key={`${sheet.id}:sa:${sheet.scale[0]}`}
              label="Scale: model"
              value={String(sheet.scale[0])}
              evaluate={positive}
              format={plain}
              onCommit={(e) => {
                const a = value(e, positive);
                if (a !== undefined) apply({ scale: [a, sheet.scale[1]] }, 'Sheet scale');
              }}
            />
            <span className="text-muted">:</span>
            <ExpressionInput
              key={`${sheet.id}:sb:${sheet.scale[1]}`}
              label="Scale: sheet"
              value={String(sheet.scale[1])}
              evaluate={positive}
              format={plain}
              onCommit={(e) => {
                const b = value(e, positive);
                if (b !== undefined) apply({ scale: [sheet.scale[0], b] }, 'Sheet scale');
              }}
            />
          </div>
        </Row>
        <Row label="Decimals">
          <ExpressionInput
            key={`${sheet.id}:d:${sheet.decimals}`}
            label="Decimals"
            value={String(sheet.decimals)}
            evaluate={decimals}
            format={(r) => String(r.value)}
            onCommit={(e) => {
              const d = value(e, decimals);
              if (d !== undefined) apply({ decimals: d }, 'Sheet decimals');
            }}
          />
        </Row>
        <Row label="Projection">
          <Segmented<Sheet['projection']>
            label="Projection"
            value={sheet.projection}
            options={[
              { value: 'first', label: 'First angle' },
              { value: 'third', label: 'Third angle' },
            ]}
            onChange={(projection) => apply({ projection }, 'Sheet projection')}
          />
        </Row>
        <Row label="Title block">
          <Select
            aria-label="Title block"
            className="h-7"
            value={template ?? 'none'}
            onChange={(event) => {
              const next = event.target.value as SheetTitleChoice;
              if (next === 'none') apply({ titleBlock: null }, 'Title block');
              else
                apply(
                  {
                    titleBlock: {
                      template: next,
                      fields: sheet.titleBlock?.fields ?? {
                        title: doc.name.slice(0, 2000),
                        date: isoDate(new Date()),
                        units: doc.settings.units,
                      },
                    },
                  },
                  'Title block',
                );
            }}
          >
            {TITLE_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        </Row>
      </div>
      {template && (
        // The typed fields, label above: Title first and across, the others two by two.
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5" data-sheet-title-fields="">
          {titleFields(template).map(({ field, label }) => (
            <div
              key={field}
              className={`flex min-w-0 flex-col gap-0.5 ${field === 'title' ? 'col-span-2' : ''}`}
            >
              <span className="truncate text-xs text-muted">{label}</span>
              <CommitField
                key={`${sheet.id}:${field}:${fields[field] ?? ''}`}
                label={label}
                value={fields[field] ?? ''}
                maxLength={2000}
                onCommit={(text) => {
                  setField(field, label, text);
                  return undefined;
                }}
              />
              {field === 'drawnBy' && !fields.drawnBy && remembered && (
                <button
                  type="button"
                  className="max-w-full truncate rounded-input px-1 text-left text-sm text-accent hover:bg-accent-soft"
                  onClick={() => setField(field, label, remembered)}
                >
                  Use “{remembered}”
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <Button
        className="border-success/60 font-semibold text-ink hover:bg-success/10"
        onClick={onFinish}
      >
        <ToolIcon name="finish-sketch" category="file" size={18} color="var(--x-success)" />
        Finish Drawing
      </Button>
    </section>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The template's typed fields, the title first. */
function titleFields(template: 'simple' | 'full') {
  const fields = sheetTitleFields(template);
  return [
    ...fields.filter((f) => f.field === 'title'),
    ...fields.filter((f) => f.field !== 'title'),
  ];
}
