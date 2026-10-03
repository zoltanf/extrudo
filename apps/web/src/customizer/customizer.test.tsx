import {
  type Command,
  type ConfigurationId,
  type CustomizerRow,
  createDocument,
  createDocumentStore,
  type DocumentStore,
  type ExtrudoDocument,
  type Parameter,
  type ParameterId,
} from '@extrudo/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '../design-system';
import { CustomizerPanel } from './CustomizerPanel';
import { type CustomizerTool, useCustomizer } from './useCustomizer';

/**
 * P4-07, ADR-0059 §4: the Customizer panel. The web app's unit tests have no
 * DOM (the interactive flows are the e2e suite's), so the panel is rendered to
 * static markup and driven through the controller the hook hands out, with a
 * real document store behind it: what each control writes, and what it leaves to
 * undo. Re-rendering is how the test gets a controller that has seen its own
 * writes, as the app re-renders after every command.
 */
const pid = (id: string) => id as ParameterId;

/** The design under the panel; `changes` tweaks its parameters by name. */
function design(changes: Record<string, Partial<Parameter>> = {}): ExtrudoDocument {
  return {
    ...createDocument(),
    parameters: (
      [
        {
          id: pid('p1'),
          name: 'width',
          expression: '40 mm',
          unit: 'length',
          customizer: { min: 10, max: 80, step: 1, group: 'Size' },
        },
        {
          id: pid('p2'),
          name: 'wall',
          expression: '3 mm',
          unit: 'length',
          customizer: { min: 1, max: 5, step: 0.5 },
        },
        {
          id: pid('p3'),
          name: 'half',
          expression: 'width / 2',
          unit: 'length',
          customizer: { group: 'Size' },
        },
        { id: pid('p4'), name: 'quiet', expression: '1 mm', unit: 'length' },
        {
          id: pid('p5'),
          name: 'tilt',
          expression: '30 deg',
          unit: 'angle',
          customizer: { min: 0, max: 90, step: 5 },
        },
      ] satisfies Parameter[]
    ).map((p) => ({ ...p, ...changes[p.name] })),
  };
}

/** A panel over a document store, with the commands it wrote. */
function panel(doc: ExtrudoDocument = design()) {
  const store: DocumentStore = createDocumentStore(doc);
  const commands: Command<unknown>[] = [];
  // What the shell passes: the store's own dispatch until the tool host is in.
  const apply = (command: Command<unknown>) => {
    // A refused command throws and writes nothing, so it is not logged.
    store.getState().dispatch(command);
    commands.push(command);
  };
  let current: CustomizerTool | undefined;
  function Probe() {
    const tool = useCustomizer({ store, apply });
    current = tool;
    return <CustomizerPanel tool={tool} onOpenParameters={() => {}} onClose={() => {}} />;
  }
  const render = () =>
    renderToStaticMarkup(
      <TooltipProvider>
        <Probe />
      </TooltipProvider>,
    );
  const rendered = {
    store,
    commands,
    html: render(),
    /** The controller this render made, as the panel has it. */
    tool: () => current as CustomizerTool,
    /** Re-renders, as the app does after a command. */
    again: () => {
      rendered.html = render();
      return rendered;
    },
    /** A new panel over the document as it is now: a fresh command log. */
    next: () => panel(store.getState().doc),
    row(name: string): CustomizerRow {
      const found = (current as CustomizerTool).groups
        .flatMap((g) => g.rows)
        .find((r) => r.name === name);
      if (!found) throw new Error(`no row ${name}`);
      return found;
    },
    expression(name: string): string | undefined {
      return store.getState().doc.parameters.find((p) => p.name === name)?.expression;
    },
    types: () => commands.map((c) => c.type),
  };
  return rendered;
}

describe('the Customizer panel', () => {
  it('is a labelled region with every exposed parameter, under its heading', () => {
    const p = panel();
    expect(p.html).toContain('aria-label="Customizer"');
    expect(p.html).toContain('data-customizer-state="parameters"');
    // The ungrouped parameter first, then the group in order (ADR-0059 §1).
    expect(p.html.indexOf('data-customizer-row="wall"')).toBeLessThan(
      p.html.indexOf('data-customizer-row="width"'),
    );
    expect(p.html).toContain('>Size</h3>');
    expect(p.html).toContain('aria-label="Expression of width"');
    expect(p.html).toContain('aria-label="Expression of wall"');
    // A parameter that is not exposed has no row.
    expect(p.html).not.toContain('data-customizer-row="quiet"');
  });

  it("gives a plain value with a full range a slider, on the row's own step", () => {
    const p = panel();
    expect(p.html).toContain('data-customizer-slider="width"');
    expect(p.html).toContain('aria-label="width"');
    expect(p.html).toMatch(/type="range"[^>]*min="10"[^>]*max="80"[^>]*step="1"/);
    expect(p.html).toMatch(/type="range"[^>]*min="1"[^>]*max="5"[^>]*step="0.5"/);
    // An angle's range is in degrees.
    expect(p.html).toMatch(/type="range"[^>]*min="0"[^>]*max="90"[^>]*step="5"/);
    // A formula can't be dragged, and says what it is.
    expect(p.html).not.toContain('data-customizer-slider="half"');
    expect(p.html).toContain('aria-label="Value of half"');
    expect(p.html).toContain('title="width / 2"');
    expect(p.html).toContain('20.00 mm');
  });

  it("shows a comment as the row's hint", () => {
    expect(panel(design({ width: { comment: 'Outer width' } })).html).toContain('Outer width');
  });

  it('warns about a value outside the range without refusing it', () => {
    const p = panel(design({ wall: { expression: '9 mm' } }));
    expect(p.html).toContain('data-customizer-row="wall" data-out-of-range="true"');
    expect(p.html).toMatch(/Outside (<!-- -->)?1\.00 mm(<!-- -->)? to (<!-- -->)?5\.00 mm/);
    expect(p.html).toContain('text-warning');
    // The value stays where it is: the range is a slider range, not a limit.
    expect(p.expression('wall')).toBe('9 mm');
  });

  it('says what to do when no parameter is starred', () => {
    const p = panel(createDocument());
    expect(p.html).toContain('data-customizer-state="empty"');
    expect(p.html).toContain(
      'No parameters in the customizer yet. Star a parameter in the Parameters dialog to show it here.',
    );
    expect(p.html).toContain('Open Parameters');
    expect(p.html).not.toContain('data-customizer-row');
  });

  it('offers the configurations, and "Custom" while none of them is the document', () => {
    const empty = panel();
    expect(empty.html).toContain('aria-label="Configuration"');
    expect(empty.html).toContain('aria-label="Configuration actions"');
    expect(empty.html).toMatch(/<option value="" selected="">Custom<\/option>/);

    const saved = panel();
    saved.tool().save('Small');
    const after = saved.next();
    expect(after.html).toContain('Small</option>');
    // The document has the saved values, so it is the current configuration.
    expect(after.tool().current?.name).toBe('Small');
    expect(after.html).toMatch(/<option value="[^"]+" selected="">Small<\/option>/);
    // One step away from it, and Custom is current again.
    after.tool().setValue(after.row('width'), '70 mm');
    const moved = after.next();
    expect(moved.tool().current).toBeUndefined();
    expect(moved.html).toMatch(/<option value="" selected="">Custom<\/option>/);
  });

  it("lists what a configuration holds that the document doesn't any more", () => {
    const p = panel({
      ...design(),
      configurations: [
        {
          id: 'c1' as ConfigurationId,
          name: 'Old',
          values: { [pid('p1')]: '40 mm', [pid('p9')]: '9 mm' },
        },
      ],
    });
    expect(p.tool().missing).toEqual([pid('p9')]);
    expect(p.html).toContain('Missing: p9');
    // Applying it sets what still exists, and leaves the rest alone.
    const changed = panel({
      ...design(),
      configurations: [
        {
          id: 'c1' as ConfigurationId,
          name: 'Old',
          values: { [pid('p1')]: '55 mm', [pid('p9')]: '9 mm' },
        },
      ],
    });
    expect(changed.tool().choose('c1' as ConfigurationId)).toBe(true);
    expect(changed.types()).toEqual(['parameter.expressions']);
    expect(changed.expression('width')).toBe('55 mm');
    expect(changed.expression('tilt')).toBe('30 deg');
  });
});

describe('writing a value', () => {
  it('writes the expression through apply as one command', () => {
    const p = panel();
    p.tool().setValue(p.row('width'), '55 mm');
    expect(p.expression('width')).toBe('55 mm');
    expect(p.types()).toEqual(['parameter.update']);
    p.store.getState().undo();
    expect(p.expression('width')).toBe('40 mm');
  });

  it("snaps a slider value to the step and writes it in the document's unit", () => {
    const p = panel();
    // 0.5 mm steps: 3.4 lands on 3.5.
    p.tool().dragTo(p.row('wall'), 3.4);
    expect(p.expression('wall')).toBe('3.50 mm');
    // An angle says deg, which the expression language takes.
    p.tool().dragTo(p.row('tilt'), 45.2);
    expect(p.expression('tilt')).toBe('45 deg');
    // An inch document writes inches.
    const inch = panel({ ...design(), settings: { units: 'in', precision: 2 } });
    inch.tool().dragTo(inch.row('width'), 30);
    expect(inch.expression('width')).toBe('1.18 in');
  });

  it('keeps a slider inside its range', () => {
    const p = panel();
    p.tool().dragTo(p.row('wall'), 99);
    expect(p.expression('wall')).toBe('5.00 mm');
    p.tool().dragTo(p.row('wall'), -99);
    expect(p.expression('wall')).toBe('1.00 mm');
  });

  it('makes a whole drag one undo step, and a keyboard step its own', () => {
    const p = panel();
    const width = p.row('width');
    p.tool().beginDrag(width);
    expect(p.store.getState().transactionDepth).toBe(1);
    p.tool().dragTo(width, 50);
    p.tool().dragTo(width, 60);
    p.tool().dragTo(width, 65);
    p.tool().endDrag();
    // A slider writes a plain value in the document's unit (ADR-0059 §1).
    expect(p.expression('width')).toBe('65.00 mm');
    expect(p.store.getState().transactionDepth).toBe(0);
    // The three writes are one step: undo goes back to where the drag began.
    p.store.getState().undo();
    expect(p.expression('width')).toBe('40 mm');
    p.store.getState().redo();
    expect(p.expression('width')).toBe('65.00 mm');

    // A step with no pointer down (a key on the focused slider) is its own step.
    p.tool().dragTo(p.row('width'), 70);
    p.store.getState().undo();
    expect(p.expression('width')).toBe('65.00 mm');
  });

  it('leaves a transaction another tool opened alone', () => {
    const p = panel();
    p.store.getState().beginTransaction('Edit Sketch1');
    p.tool().beginDrag(p.row('width'));
    expect(p.store.getState().transactionDepth).toBe(1);
    p.tool().endDrag();
    expect(p.store.getState().transactionDepth).toBe(1);
    p.store.getState().commitTransaction();
  });
});

describe('configurations', () => {
  it('saves the exposed values under a name, and refuses a name that is taken', () => {
    const p = panel();
    expect(p.tool().save('Small')).toBe(true);
    expect(p.types()).toEqual(['configuration.add']);
    const saved = p.store.getState().doc.configurations ?? [];
    expect(saved.map((c) => c.name)).toEqual(['Small']);
    // Every exposed parameter, and only those.
    expect(Object.keys(saved[0]?.values ?? {}).sort()).toEqual(['p1', 'p2', 'p3', 'p5']);

    // A refused save writes nothing; its wording comes from the command (core).
    const twice = p.next();
    expect(twice.tool().save('Small')).toBe(false);
    expect(twice.store.getState().doc.configurations?.length).toBe(1);
    expect(twice.types()).toEqual([]);
    // The name is the same however it is written.
    expect(twice.tool().save('SMALL')).toBe(false);
    expect(twice.tool().save(' Small ')).toBe(false);
    expect(twice.tool().save('Tiny')).toBe(true);
    expect(twice.store.getState().doc.configurations?.length).toBe(2);
  });

  it('applies one with a single command', () => {
    const p = panel();
    p.tool().save('Small');
    const withConfig = p.next();
    withConfig.tool().setValue(withConfig.row('width'), '70 mm');
    const withBoth = withConfig.next();
    withBoth.tool().setValue(withBoth.row('wall'), '4 mm');
    const moved = withBoth.next();
    const id = moved.store.getState().doc.configurations?.[0]?.id as ConfigurationId;

    const applied = panel(moved.store.getState().doc);
    expect(applied.tool().choose(id)).toBe(true);
    expect(applied.types()).toEqual(['parameter.expressions']);
    expect(applied.expression('width')).toBe('40 mm');
    expect(applied.expression('wall')).toBe('3 mm');
    // Parameters it doesn't list keep their values.
    expect(applied.expression('tilt')).toBe('30 deg');
    // One undo step for the whole configuration.
    applied.store.getState().undo();
    expect(applied.expression('width')).toBe('70 mm');
    expect(applied.expression('wall')).toBe('4 mm');
  });

  it('writes nothing when the configuration is the one the document has', () => {
    const saved = panel();
    saved.tool().save('Small');
    const applied = saved.next();
    const id = applied.store.getState().doc.configurations?.[0]?.id as ConfigurationId;
    expect(applied.tool().current?.id).toBe(id);
    expect(applied.tool().choose(id)).toBe(true);
    expect(applied.types()).toEqual([]);
  });

  it('updates a configuration with the values as they are now, plus new parameters', () => {
    const p = panel();
    p.tool().save('Small');
    // A parameter is exposed after the configuration was saved, so it is in the
    // panel but not yet in the configuration. No value moved: it is current.
    const starred = {
      ...p.store.getState().doc,
      parameters: p.store
        .getState()
        .doc.parameters.map((q) => (q.id === pid('p4') ? { ...q, customizer: {} } : q)),
    };
    const updated = panel(starred);
    expect(updated.tool().current?.name).toBe('Small');
    expect(updated.tool().update()).toBe(true);
    expect(updated.types()).toEqual(['configuration.update']);
    const values = updated.store.getState().doc.configurations?.[0]?.values ?? {};
    expect(Object.keys(values).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    // One undo step: it is as it was, without the new parameter.
    updated.store.getState().undo();
    expect(
      Object.keys(updated.store.getState().doc.configurations?.[0]?.values ?? {}).sort(),
    ).toEqual(['p1', 'p2', 'p3', 'p5']);
    // A document that is no configuration's updates nothing.
    const moved = updated.next();
    moved.tool().setValue(moved.row('width'), '70 mm');
    const apart = moved.next();
    expect(apart.tool().current).toBeUndefined();
    expect(apart.tool().update()).toBe(false);
    expect(apart.types()).toEqual([]);
  });

  it('renames one and deletes it, each one undo step', () => {
    const p = panel();
    p.tool().save('Small');
    const renamed = p.next();
    expect(renamed.tool().rename('Tiny')).toBe(true);
    expect(renamed.store.getState().doc.configurations?.[0]?.name).toBe('Tiny');
    expect(renamed.types()).toEqual(['configuration.update']);
    renamed.store.getState().undo();
    expect(renamed.store.getState().doc.configurations?.[0]?.name).toBe('Small');

    const again = renamed.next();
    expect(again.tool().remove()).toBe(true);
    expect(again.store.getState().doc.configurations).toEqual([]);
    expect(again.types()).toEqual(['configuration.remove']);
    again.store.getState().undo();
    expect(again.store.getState().doc.configurations?.[0]?.name).toBe('Small');
  });

  it('does nothing for update, rename and delete with no configuration chosen', () => {
    const p = panel();
    expect(p.tool().update()).toBe(false);
    expect(p.tool().rename('Tiny')).toBe(false);
    expect(p.tool().remove()).toBe(false);
    expect(p.types()).toEqual([]);
  });
});
