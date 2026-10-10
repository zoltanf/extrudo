import {
  createDocument,
  createDocumentStore,
  createModelStore,
  createSessionStore,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import type { OpenInSlicer } from '../platform/slicer';
import { SLICERS } from '../platform/slicer';
import type { BodyEntry } from '../shell/bodies';
import {
  chooseSlicer,
  type ExportModelDialogProps,
  ExportModelForm,
  NO_SLICER_HINT,
  SlicerRow,
} from './ExportModelDialog';
import type { ModelExporter } from './modelExport';

/** One body, already computed and meshable: the dialog's ordinary state. */
function props(over: Partial<ExportModelDialogProps> = {}): ExportModelDialogProps {
  const model = createModelStore<BodyMesh>();
  model.getState().computed({ features: {}, bodies: {} });
  const kernel: ModelExporter = {
    async exportMeshes(ids) {
      return ids.map((id) => ({
        id,
        mesh: {
          positions: Float64Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
          indices: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
        },
      }));
    },
    async exportStep() {
      return 'ISO-10303-21;\n';
    },
  };
  const bodies: BodyEntry[] = [
    {
      id: 'E1:Bracket' as never,
      meta: { name: 'Bracket', visible: true },
      stored: true,
      display: 'shown',
    },
  ];
  return {
    store: createDocumentStore(createDocument()),
    session: createSessionStore(),
    model,
    bodies,
    kernel,
    request: {},
    files: { download: () => {}, pick: async () => undefined },
    preferences: memoryPreferences(),
    onClose: () => {},
    ...over,
  };
}

const html = (over: Partial<ExportModelDialogProps> = {}) =>
  renderToStaticMarkup(<ExportModelForm {...props(over)} />);

describe('the slicer hand-off in the Export dialog (P4-08, ADR-0062)', () => {
  it('shows no slicer control in the browser, where the platform has none', () => {
    const out = html();
    expect(out).toContain('Export 3MF');
    expect(out).not.toContain('Open in slicer');
    expect(out).not.toContain('aria-label="Slicer"');
  });

  it('offers the slicers and a button where the platform can launch one', () => {
    const openInSlicer: OpenInSlicer = async () => true;
    const out = html({ openInSlicer });
    expect(out).toContain('aria-label="Slicer"');
    expect(out).toContain('Open in slicer');
    for (const slicer of SLICERS) expect(out).toContain(slicer.label);
    // PrusaSlicer is what it offers first.
    expect(out).toMatch(/<option value="prusaslicer" selected="">PrusaSlicer/);
  });
});

describe('the installed slicers in the Export dialog (P6-02)', () => {
  const row = (
    installed: Parameters<typeof SlicerRow>[0]['installed'],
    selected = chooseSlicer(installed, undefined),
  ) =>
    renderToStaticMarkup(
      <SlicerRow
        installed={installed}
        selected={selected}
        onSelect={() => {}}
        disabled={false}
        primary={false}
        onLaunch={() => {}}
      />,
    );

  it('lists every slicer enabled while the list is unknown, as the browser-less dialog did', () => {
    const out = row(undefined);
    expect(out).not.toContain('(not found)');
    expect(out).not.toContain('disabled=""');
    expect(out).toMatch(/<option value="prusaslicer" selected="">PrusaSlicer/);
  });

  it('disables the missing ones, labels them and preselects the first installed', () => {
    const out = row(['orcaslicer', 'cura']);
    expect(out).toMatch(/<option value="prusaslicer" disabled="">PrusaSlicer \(not found\)/);
    expect(out).toMatch(/<option value="bambustudio" disabled="">Bambu Studio \(not found\)/);
    expect(out).toMatch(/<option value="orcaslicer" selected="">OrcaSlicer<\/option>/);
    expect(out).not.toContain('Orca Slicer (not found)');
    expect(out).not.toContain(NO_SLICER_HINT);
  });

  it('with none installed disables the button and says what to install', () => {
    const out = row([]);
    expect(out).toContain(NO_SLICER_HINT);
    expect(out).toContain(
      'No slicer found. Install PrusaSlicer, OrcaSlicer, Bambu Studio or Cura.',
    );
    expect(out).toMatch(/<button[^>]*title="No slicer found[^>]*>|<button[^>]*disabled[^>]*>/);
  });

  it('remembers the last slicer while it is installed', () => {
    expect(chooseSlicer(['orcaslicer', 'cura'], 'cura')).toBe('cura');
    expect(chooseSlicer(['orcaslicer'], 'cura')).toBe('orcaslicer');
    expect(chooseSlicer(undefined, 'cura')).toBe('cura');
    expect(chooseSlicer([], 'cura')).toBe('prusaslicer');
  });

  it('keeps the web rendering: no slicer row without openInSlicer, even with a list', () => {
    const out = html({ installedSlicers: async () => ['cura'] });
    expect(out).not.toContain('Open in slicer');
    expect(out).not.toContain('(not found)');
  });

  it('makes the slicer button primary for the Send to Slicer tile', () => {
    const openInSlicer: OpenInSlicer = async () => true;
    const normal = html({ openInSlicer, request: {} });
    const tile = html({ openInSlicer, request: { slicer: true } });
    expect(normal).toMatch(/type="submit"[^>]*>Export 3MF/);
    const primary = (out: string, label: string) =>
      new RegExp(`bg-accent text-on-accent[^>]*>${label}`).test(out);
    expect(primary(normal, 'Export 3MF')).toBe(true);
    expect(primary(normal, 'Open in slicer')).toBe(false);
    expect(primary(tile, 'Open in slicer')).toBe(true);
    expect(primary(tile, 'Export 3MF')).toBe(false);
  });
});

describe('a mesh body in the Export dialog (P4-06, ADR-0066 §3)', () => {
  const meshBody: BodyEntry = {
    id: 'Import1:0' as never,
    meta: { name: 'Bracket', visible: true },
    stored: true,
    display: 'shown',
    mesh: true,
  };

  it('leaves a mesh body out of a STEP file, with the reason', () => {
    const over = props({
      bodies: [meshBody],
      preferences: (() => {
        const p = memoryPreferences();
        p.set('export.model', { format: 'step', resolution: 'medium', deviation: '', angle: '' });
        return p;
      })(),
    });
    const out = renderToStaticMarkup(<ExportModelForm {...over} />);
    // The body's checkbox is off and disabled, and the row says why.
    expect(out).toMatch(/<input type="checkbox" disabled="" class="accent-\(--x-accent\)"/);
    expect(out).toContain('Meshes can&#x27;t go into a STEP file');
    expect(out).toContain('Mesh bodies go into STL and 3MF, not into a STEP file.');
    // Nothing to export, so Export is off: a STEP file of no bodies.
    expect(out).toContain('Choose a body to export.');
  });

  it('keeps a mesh body for STL and 3MF', () => {
    const out = html({ bodies: [meshBody] });
    expect(out).not.toContain('STEP file');
    // The checkbox is enabled, as any body is for a mesh format.
    expect(out).toContain('<input type="checkbox" class="accent-(--x-accent)"/>');
  });
});
