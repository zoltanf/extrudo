import {
  createDocument,
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type Feature,
  type FeatureId,
  originPlaneRef,
} from '@extrudo/core';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { memoryPreferences } from '../platform';
import { createSketchOn, finishSketch } from '../sketch/mode';
import { createViewportStore } from '../viewport/store';
import type { FeatureActions } from './featureActions';
import { VISIBILITY_FEATURE_TYPES, visibilityApplies } from './featureVisibility';

// The menu items render under static markup as plain elements: the point is
// which entries the menu offers, not Radix's behaviour.
vi.mock('../design-system', () => ({
  MenuItem: ({
    children,
    disabled,
    shortcut,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    shortcut?: string;
  }) => (
    // biome-ignore lint/a11y/useFocusableInteractive: a static-render stub
    <div role="menuitem" aria-disabled={disabled || undefined} data-shortcut={shortcut}>
      {children}
    </div>
  ),
  MenuSeparator: () => <hr />,
  TextInput: (props: Record<string, unknown>) => <input {...props} />,
}));

const { FeatureMenuItems } = await import('./FeatureMenu');

const actions: FeatureActions = {
  edit: () => false,
  canEdit: () => false,
  rename: () => false,
  setVisible: () => {},
  toggleSuppressed: () => {},
  remove: () => {},
  hover: () => {},
  locked: () => undefined,
  exportSketch: () => {},
  rollTo: () => {},
  move: () => false,
  moveProblem: () => undefined,
  issues: () => [],
  fix: () => {},
  keepClosest: () => {},
  redefinePlane: () => {},
};

const html = (feature: Feature) =>
  renderToStaticMarkup(
    <FeatureMenuItems feature={feature} editable={false} actions={actions} onRename={() => {}} />,
  );

describe('feature visibility', () => {
  it('covers exactly the types whose drawn geometry `visible` changes', () => {
    expect(VISIBILITY_FEATURE_TYPES).toContain('sketch');
    expect(VISIBILITY_FEATURE_TYPES).toContain('offsetPlane');
    expect(VISIBILITY_FEATURE_TYPES).toContain('constructionPoint');
    expect(VISIBILITY_FEATURE_TYPES).toContain('canvas');
    expect(VISIBILITY_FEATURE_TYPES).not.toContain('fillet');
    expect(VISIBILITY_FEATURE_TYPES).not.toContain('chamfer');
    expect(VISIBILITY_FEATURE_TYPES).not.toContain('shell');
    expect(VISIBILITY_FEATURE_TYPES).not.toContain('extrude');
  });

  it("offers Hide on a sketch's menu but not on a fillet's", () => {
    const stores = {
      store: createDocumentStore(createDocument()),
      session: createSessionStore(),
      viewport: createViewportStore({
        preferences: memoryPreferences(),
        reducedMotion: () => true,
      }),
      model: createModelStore<unknown>(),
    };
    createSketchOn(stores, originPlaneRef('origin:xy'));
    finishSketch(stores);
    const sketch = stores.store.getState().doc.features[0];
    if (!sketch) throw new Error('the sketch feature is missing');
    expect(visibilityApplies(sketch)).toBe(true);
    expect(html(sketch)).toMatch(/role="menuitem"[^>]*>(Hide|Show)</);

    const fillet: Feature = {
      id: 'f2' as FeatureId,
      type: 'fillet',
      name: 'Fillet1',
      suppressed: false,
      inputs: {},
    };
    expect(visibilityApplies(fillet)).toBe(false);
    const out = html(fillet);
    expect(out).not.toContain('Hide');
    expect(out).not.toContain('Show');
    // The rest of the menu is still there.
    expect(out).toContain('Rename');
    expect(out).toContain('Suppress');
    expect(out).toContain('Delete');
  });
});
