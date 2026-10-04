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
import { type ExportModelDialogProps, ExportModelForm } from './ExportModelDialog';
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
    { id: 'E1:Bracket' as never, meta: { name: 'Bracket', visible: true }, stored: true },
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
