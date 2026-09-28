import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '../design-system';
import type { OpenDialog } from './dialog';
import { FeatureDialogPanel } from './FeatureDialog';
import { faceItem, setupDialogs } from './testing';

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
