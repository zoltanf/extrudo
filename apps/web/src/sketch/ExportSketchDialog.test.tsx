// @vitest-environment jsdom
// The Export Sketch dialog on a sketch whose profiles can't be found
// (`ProfilesRefusedError`, ADR-0020): it gives the refusal's own reason, starts
// where something can be exported, and keeps All curves available.
import {
  addToSketch,
  applyCommand,
  createDocument,
  createDocumentStore,
  createSketch,
  type DocumentId,
  type FeatureId,
  originPlaneRef,
  type SketchData,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import {
  TOO_LARGE_COORDINATES,
  TOO_MANY_CROSSINGS,
  TOO_MANY_CURVES,
} from '@extrudo/sketch/profiles';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../design-system';
import type { FileAccess } from '../platform';
import { ExportSketchDialog } from './ExportSketchDialog';

afterEach(cleanup);

const ID = 'S' as FeatureId;
const CURVES_LEFT = 'All curves can still be exported.';

function crossing(): SketchData {
  const b = new SketchBuilder();
  // 330 chords of a circle, all crossing: 54,000 crossings.
  for (let i = 0; i < 330; i++) {
    const a = (Math.PI * i) / 330;
    b.line(
      100 * Math.cos(a),
      100 * Math.sin(a),
      -100 * Math.cos(a + 0.3),
      -100 * Math.sin(a + 0.3),
    );
  }
  return b.sketch;
}

function farOut(): SketchData {
  const b = new SketchBuilder();
  b.circle(0, 0, 5);
  b.line(0, 0, 2e9, 0);
  return b.sketch;
}

function tooMany(): SketchData {
  // A thousand circles of 1 m, apart: two million points.
  const b = new SketchBuilder();
  for (let i = 0; i < 1000; i++) b.circle((i % 40) * 2100, Math.floor(i / 40) * 2100, 1000);
  return b.sketch;
}

function closed(): SketchData {
  const b = new SketchBuilder();
  b.circle(0, 0, 5);
  return b.sketch;
}

function open(): SketchData {
  const b = new SketchBuilder();
  b.line(0, 0, 20, 0);
  return b.sketch;
}

function show(data: SketchData, selected: readonly string[] = []) {
  let doc = createDocument({ id: 'd' as DocumentId, name: 'P', now: '2026-11-18T00:00:00.000Z' });
  doc = applyCommand(doc, createSketch({ id: ID, plane: originPlaneRef('origin:xy') })).doc;
  doc = applyCommand(doc, addToSketch({ feature: ID, entities: data.entities })).doc;
  const files = { download: vi.fn() } as unknown as FileAccess;
  render(
    <TooltipProvider>
      <ExportSketchDialog
        store={createDocumentStore(doc)}
        request={{ sketch: ID, selected }}
        files={files}
        onClose={() => {}}
      />
    </TooltipProvider>,
  );
}

const radio = (name: RegExp) => screen.getByRole<HTMLInputElement>('radio', { name });
const allCurves = () => radio(/^All curves/);
const allProfiles = () => radio(/^All profiles/);
const selectedProfile = () => radio(/^Selected profile/);
const exportButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Export SVG' });
const line = () => document.querySelector('[data-export-summary]')?.textContent;

describe('ExportSketchDialog on a refused sketch', () => {
  it.each([
    ['too many crossings', crossing, TOO_MANY_CROSSINGS],
    ['coordinates too large', farOut, TOO_LARGE_COORDINATES],
    ['too many curves', tooMany, TOO_MANY_CURVES],
  ])('gives the reason for %s, and exports curves only', (_name, data, reason) => {
    show(data());
    expect(allCurves().checked).toBe(true);
    expect(exportButton().disabled).toBe(false);

    fireEvent.click(allProfiles());
    expect(line()).toBe(`${reason} ${CURVES_LEFT}`);
    expect(exportButton().disabled).toBe(true);

    fireEvent.click(allCurves());
    expect(line()).not.toContain(reason);
    expect(exportButton().disabled).toBe(false);
  });

  it('starts on All curves even with profiles selected, and still offers them', () => {
    show(farOut(), ['gone']);
    expect(allCurves().checked).toBe(true);
    expect(exportButton().disabled).toBe(false);

    fireEvent.click(selectedProfile());
    expect(line()).toBe(`${TOO_LARGE_COORDINATES} ${CURVES_LEFT}`);
    expect(exportButton().disabled).toBe(true);
  });
});

describe('ExportSketchDialog on other sketches', () => {
  it('starts on the selected profiles when there are some', () => {
    show(closed(), ['gone']);
    expect(selectedProfile().checked).toBe(true);
  });

  it('starts on All curves with nothing selected', () => {
    show(closed());
    expect(allCurves().checked).toBe(true);
  });

  it('still says to close a shape when a sketch simply has no closed profile', () => {
    show(open());
    fireEvent.click(allProfiles());
    expect(line()).toBe('This sketch has no closed profiles. Close a shape to make one.');
    expect(exportButton().disabled).toBe(true);
  });
});
