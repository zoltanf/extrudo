import { createDocument, createDocumentStore, type ViewId, type ViewSection } from '@extrudo/core';
import { describe, expect, it, vi } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import type { SectionBoxState, SectionState } from '../section/clip';
import { sectionForView } from '../section/viewSection';
import { createViewportStore } from '../viewport/store';
import { createViewActions } from './namedViews';

const row = (offset: string, on = true): SectionState => ({
  plane: { kind: 'plane', id: 'origin:xy' },
  offset,
  flip: false,
  on,
});
const box = (on = true): SectionBoxState => ({
  center: ['0', '0', '5 mm'],
  half: ['10', '10', 'wall'],
  on,
});

function setup() {
  const store = createDocumentStore(createDocument());
  const viewport = createViewportStore({
    preferences: memoryPreferences(),
    reducedMotion: () => true,
  });
  const notify = vi.fn();
  const actions = createViewActions(store, viewport, notify);
  const views = () => store.getState().doc.views;
  const first = () => views()[0];
  return { store, viewport, actions, views, first };
}

describe('named views keep the section', () => {
  it('saves one shown plane', () => {
    const { viewport, actions, first } = setup();
    viewport.getState().setSection([row('10 mm')]);
    expect(actions.save('A')).toBe(true);
    expect(first()?.section).toEqual({ kind: 'planes', planes: [row('10 mm')] });
  });

  it('saves every row with its own `on` while one is shown', () => {
    const { viewport, actions, first } = setup();
    viewport.getState().setSection([row('1 mm', false), row('2 mm', true)]);
    actions.save('A');
    const section = first()?.section;
    expect(section?.kind === 'planes' && section.planes.map((p) => p.on)).toEqual([false, true]);
  });

  it('saves no section when nothing is shown', () => {
    const { viewport, actions, views } = setup();
    actions.save('none');
    viewport.getState().setSection([row('1 mm', false)]);
    actions.save('hidden');
    expect(views()).toHaveLength(2);
    expect(views().some((v) => 'section' in v)).toBe(false);
  });

  it('saves a shown box, not a hidden one', () => {
    const { viewport, actions, views } = setup();
    viewport.getState().setSectionBox(box());
    actions.save('Box');
    expect(views()[0]?.section).toEqual({ kind: 'box', ...box() });
    viewport.getState().setSectionBox(box(false));
    actions.save('Hidden box');
    expect(views()[1] && 'section' in views()[1]!).toBe(false);
  });

  it('update replaces the section, or removes it when nothing is shown', () => {
    const { viewport, actions, views } = setup();
    viewport.getState().setSection([row('1 mm')]);
    actions.save('A');
    const id = views()[0]?.id as ViewId;
    viewport.getState().setSection([row('7 mm')]);
    actions.update(id);
    expect(views()[0]?.section).toEqual({ kind: 'planes', planes: [row('7 mm')] });
    viewport.getState().setSection(undefined);
    actions.update(id);
    expect('section' in views()[0]!).toBe(false);
  });

  it('rename keeps the section', () => {
    const { viewport, actions, views } = setup();
    viewport.getState().setSection([row('1 mm')]);
    actions.save('A');
    actions.rename(views()[0]?.id as ViewId, 'B');
    expect(views()[0]?.name).toBe('B');
    expect(views()[0]?.section).toBeDefined();
  });

  it('restores planes and a box through the store, on copies', () => {
    const { viewport, actions, views } = setup();
    viewport.getState().setSection([row('1 mm'), row('2 mm', false)]);
    actions.save('Planes');
    viewport.getState().setSectionBox(box());
    actions.save('Box');
    const [planesView, boxView] = views();

    actions.restore(planesView?.id as ViewId);
    const { section, sectionBox } = viewport.getState();
    expect(section).toEqual(
      planesView?.section && 'planes' in planesView.section ? planesView.section.planes : [],
    );
    expect(sectionBox).toBeUndefined();
    const saved = planesView?.section as Extract<ViewSection, { kind: 'planes' }>;
    expect(section[0]).not.toBe(saved.planes[0]);
    expect(section[0]?.plane).not.toBe(saved.planes[0]?.plane);

    actions.restore(boxView?.id as ViewId);
    expect(viewport.getState().section).toEqual([]);
    expect(viewport.getState().sectionBox).toEqual(box());
    const savedBox = boxView?.section as Extract<ViewSection, { kind: 'box' }>;
    expect(viewport.getState().sectionBox?.center).not.toBe(savedBox.center);
  });

  it('restoring a view without a section leaves the one on screen', () => {
    const { viewport, actions, views } = setup();
    actions.save('Plain');
    viewport.getState().setSection([row('3 mm')]);
    const before = viewport.getState().section;
    actions.restore(views()[0]?.id as ViewId);
    expect(viewport.getState().section).toBe(before);
  });
});

describe('sectionForView', () => {
  it('prefers a shown box, and gives nothing for no shown plane', () => {
    expect(sectionForView([row('1')], box())?.kind).toBe('box');
    expect(sectionForView([row('1')], box(false))?.kind).toBe('planes');
    expect(sectionForView([], undefined)).toBeUndefined();
    expect(sectionForView([row('1', false)], undefined)).toBeUndefined();
  });
});
