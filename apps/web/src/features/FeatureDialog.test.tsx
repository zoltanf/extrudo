import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '../design-system';
import type { OpenDialog } from './dialog';
import { DIALOG_COLUMN, FeatureDialogPanel, stopExpression, stopIndex } from './FeatureDialog';
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

  it("shows under Simplify for Print's limits once the preview found two sizes or more", async () => {
    const t = setupDialogs([simplifyForPrintDialog]);
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('simplifyForPrint');
    expect(render(t.open() as OpenDialog, t)).not.toContain('data-stops');
    t.kernel.previews.at(-1)?.resolve({
      features: {},
      bodies: {},
      tools: [],
      simplify: { groups: [], sizes: { round: [0.5, 1, 4], chamfer: [2], hole: [] } },
    });
    await settle();
    const html = render(t.open() as OpenDialog, t);
    expect(html).toContain('data-stops="maxRoundRadius"');
    expect(html).not.toContain('data-stops="maxChamferSize"');
    // The 1 mm default sits at the middle stop; the ends read in the document's unit.
    expect(html).toMatch(
      /type="range" aria-label="Round radius" aria-valuetext="1.00 mm"[^>]*max="2"/,
    );
    expect(html).toContain('<span>0.50 mm</span><span>4.00 mm</span>');
    expect(html.match(/>Remove up to</g)).toHaveLength(3);
  });
});
