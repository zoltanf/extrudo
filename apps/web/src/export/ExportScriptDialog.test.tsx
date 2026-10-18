import {
  createDocument,
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type ExtrudoDocument,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import type { BodyEntry } from '../shell/bodies';
import { type ExportScriptDialogProps, ExportScriptForm } from './ExportScriptDialog';
import type { ModelExporter } from './modelExport';

const kernel: ModelExporter = {
  async exportMeshes() {
    return [];
  },
  async exportStep() {
    return '';
  },
  async exportScad() {
    return 'cube(1);\n';
  },
};
const body: BodyEntry = {
  id: 'E1:Bracket' as never,
  meta: { name: 'Bracket', visible: true },
  stored: true,
  display: 'shown',
};

function props(over: Partial<ExportScriptDialogProps> = {}, doc?: ExtrudoDocument) {
  const model = createModelStore<BodyMesh>();
  model.getState().computed({ features: {}, bodies: {} });
  return {
    store: createDocumentStore(doc ?? createDocument()),
    session: createSessionStore(),
    model,
    bodies: [body],
    kernel,
    open: true,
    files: { download: () => {}, pick: async () => undefined },
    preferences: memoryPreferences(),
    onClose: () => {},
    ...over,
  } satisfies ExportScriptDialogProps;
}

const html = (over: Partial<ExportScriptDialogProps> = {}, doc?: ExtrudoDocument) =>
  renderToStaticMarkup(<ExportScriptForm {...props(over, doc)} />);
const scad = { 'export.script': { language: 'scad' } };

describe('the Export as script dialog (ADR-0088 §9)', () => {
  it('starts with TypeScript, both languages described, and no OpenSCAD fields', () => {
    const out = html();
    expect(out).toContain('Rebuilds the whole design with Extrudo');
    expect(out).toContain('Editable OpenSCAD code with a Customizer.');
    expect(out).toContain('Export TypeScript');
    expect(out).toContain('Copy');
    expect(out).toContain('Preview');
    expect(out).not.toContain('Bodies');
    expect(out).not.toContain('Resolution');
  });

  it('shows the bodies and the resolution for a remembered OpenSCAD', () => {
    const out = html({ preferences: memoryPreferences(scad) });
    expect(out).toContain('Bodies');
    expect(out).toContain('Resolution');
    expect(out).toContain('Export OpenSCAD');
    for (const absent of ['Keep components together', 'Meshing', 'Open in slicer']) {
      expect(out).not.toContain(absent);
    }
  });

  it('falls back to TypeScript for an unknown stored language', () => {
    const out = html({ preferences: memoryPreferences({ 'export.script': { language: 'x' } }) });
    expect(out).toContain('Export TypeScript');
    expect(out).not.toContain('Resolution');
  });

  it('wants bodies for OpenSCAD, not for TypeScript', () => {
    const none = { bodies: [] };
    expect(html({ ...none, preferences: memoryPreferences(scad) })).toContain(
      'There are no bodies to export. Extrude a sketch first.',
    );
    expect(html(none)).not.toContain('There are no bodies');
  });

  it('counts the design for TypeScript', () => {
    const doc = (features: number, parameters: number) =>
      ({
        ...createDocument(),
        features: Array.from({ length: features }, (_, i) => ({ id: `F${i}`, inputs: {} })),
        parameters: Array.from({ length: parameters }, (_, i) => ({
          id: `P${i}`,
          name: `p${i}`,
          expression: '1',
        })),
      }) as never as ExtrudoDocument;
    expect(html({}, doc(2, 1))).toContain('The whole design: 2 features, 1 parameter');
    expect(html({}, doc(1, 3))).toContain('The whole design: 1 feature, 3 parameters');
    expect(html({}, doc(0, 2))).toContain('The whole design: 2 parameters');
  });
});
