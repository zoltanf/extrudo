import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '../design-system';
import type { OpenDialog } from './dialog';
import {
  DIALOG_COLUMN,
  FeatureDialogPanel,
  stopExpression,
  stopIndex,
  stopSlider,
} from './FeatureDialog';
import { simplifyForPrintDialog } from './simplify-for-print';
import { BOX, faceItem, settle, setupDialogs } from './testing';

const settings = { units: 'mm', precision: 2 } as const;

function render(open: OpenDialog, t: ReturnType<typeof setupDialogs>) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <FeatureDialogPanel
        open={open}
        controller={t.controller}
        settings={settings}
        offset={{ x: 0, y: 0 }}
        onMove={() => {}}
      />
    </TooltipProvider>,
  );
}

describe('the dialog panel', () => {
  it('covers the panel and its margins in the column other floating UI keeps clear', () => {
    // The heads-up box and the toast stack are placed against `DIALOG_COLUMN`,
    // so the strip has to cover the panel (w-64) and its 12 px margin each side.
    const t = setupDialogs();
    t.controller.start('fake-press');
    expect(render(t.open() as OpenDialog, t)).toContain('w-64');
    expect(DIALOG_COLUMN).toBe(256 + 2 * 12);
  });

  it('shows each shown field, the pick prompt and a disabled OK while a face is missing', () => {
    const t = setupDialogs();
    t.controller.start('fake-press');
    const html = render(t.open() as OpenDialog, t);
    expect(html).toContain('aria-label="Press dialog"');
    expect(html).toContain('data-feature-dialog="fake-press"');
    expect(html).toContain('data-dialog-mode="create"');
    expect(html).not.toContain('data-dialog-valid');
    expect(html).toContain('aria-pressed="true"');
    // The field asks for its pick itself; OK's tooltip has the sentence.
    expect(html).toContain('>Pick a face<');
    expect(html).not.toContain('Pick a face.');
    expect(html).toMatch(/aria-disabled="true"[^>]*>OK/);
    expect(html).toContain('aria-label="Distance"');
    expect(html).toContain('aria-label="Operation"');
    expect(html).toContain('aria-label="Tilt"');
    expect(html).not.toContain('aria-label="Angle"');
  });

  it('counts picks, offers to clear them, and enables OK; a failing draft says why', () => {
    const t = setupDialogs();
    t.session.getState().select([faceItem(1), faceItem(2)]);
    t.controller.start('fake-press');
    const open = t.open() as OpenDialog;
    let html = render(open, t);
    expect(html).toContain('data-count="2"');
    expect(html).toContain('2 faces');
    expect(html).toContain('aria-label="Clear Faces"');
    expect(html).toContain('data-dialog-valid="true"');
    expect(html).toContain('data-preview-status="pending"');
    html = render(
      {
        ...open,
        preview: {
          drawing: undefined,
          status: { status: 'error', message: 'Too thin.' },
          pending: false,
        },
      },
      t,
    );
    expect(html).toContain('data-preview-status="error"');
    expect(html).toContain('Too thin.');
  });
});

describe("a slider at an expression field's stops", () => {
  it('sits at the last stop at or under the value; a stop is an expression', () => {
    expect(stopIndex([0.5, 1, 3], 1)).toBe(1);
    expect(stopIndex([0.5, 1, 3], 2)).toBe(1);
    expect(stopIndex([0.5, 1, 3], 0.1)).toBe(0);
    expect(stopIndex([0.5, 1, 3], 9)).toBe(2);
    expect(stopIndex([0.5, 1, 3], undefined)).toBe(0);
    expect(stopExpression('length', 1.2350000001)).toBe('1.235 mm');
    expect(stopExpression('angle', 45)).toBe('45 deg');
    expect(stopExpression('unitless', 2)).toBe('2');
  });

  it('starts at the empty stop where empty means something, so one size is enough', () => {
    const keep = { empty: 'Keep' };
    expect(stopSlider(keep, [5], '', undefined)).toEqual({ stops: [undefined, 5], index: 0 });
    expect(stopSlider(keep, [5], '5 mm', 5)).toEqual({ stops: [undefined, 5], index: 1 });
    // Under every size takes nothing either: the empty stop.
    expect(stopSlider(keep, [1.2, 3.6], '1 mm', 1)?.index).toBe(0);
    expect(stopSlider(keep, [1.2, 3.6], '2 mm', 2)?.index).toBe(1);
    expect(stopSlider(keep, [], '', undefined)).toBeUndefined();
    expect(stopSlider(keep, undefined, '', undefined)).toBeUndefined();
    // Without an empty stop, two sizes at least.
    expect(stopSlider({}, [5], '5 mm', 5)).toBeUndefined();
    expect(stopSlider({}, [1, 5], '5 mm', 5)).toEqual({ stops: [1, 5], index: 1 });
  });

  it("draws Simplify for Print's kinds as cards once the preview found their sizes", async () => {
    const t = setupDialogs([simplifyForPrintDialog]);
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('simplifyForPrint');
    let html = render(t.open() as OpenDialog, t);
    expect(html).not.toContain('data-stops');
    expect(html).toContain('aria-label="Rounds" data-field="maxRoundRadius" data-card="open"');
    expect(html).not.toContain('type="checkbox"');
    t.kernel.previews.at(-1)?.resolve({
      features: {},
      bodies: {},
      tools: [],
      simplify: { groups: [], sizes: { round: [0.5, 1, 4], chamfer: [2], hole: [] } },
    });
    await settle();
    html = render(t.open() as OpenDialog, t);
    // Keep, then each size: the 1 mm default sits at the third stop.
    expect(html).toMatch(
      /type="range" aria-label="Round radius" aria-valuetext="1.00 mm"[^>]*max="3"/,
    );
    expect(html).toContain('<span>Keep</span><span>4.00 mm</span>');
    // One chamfer size: Keep and it.
    expect(html).toMatch(/type="range" aria-label="Chamfer size"[^>]*max="1"/);
    expect(html).toContain('data-badge="muted"');
    expect(html).toContain('R0.5, R1 mm go · R4 mm stays');
    // No holes found: the card says so, with no slider or field.
    expect(html).toContain('data-field="maxHoleDiameter" data-card="none"');
    expect(html).toContain('None on these bodies');
    expect(html).not.toContain('data-stops="maxHoleDiameter"');
  });

  it('a field without stops evaluates only its own draft: no slider work per render', () => {
    const t = setupDialogs();
    t.controller.start('fake-press');
    const evaluate = t.controller.evaluate.bind(t.controller);
    const asked: string[] = [];
    t.controller.evaluate = (field, expr) => {
      asked.push(field);
      return evaluate(field, expr);
    };
    render(t.open() as OpenDialog, t);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBe(new Set(asked).size);
  });
});
