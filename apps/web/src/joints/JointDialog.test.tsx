import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '../design-system';
import { JointDialogPanel } from './JointDialog';
import { LOOSE_BODY_HINT } from './jointController';
import { setupJoints } from './testing';

function render(t: ReturnType<typeof setupJoints>) {
  const open = t.dialog.state.getState().open;
  if (!open) throw new Error('closed');
  return renderToStaticMarkup(
    <TooltipProvider>
      <JointDialogPanel open={open} controller={t.dialog} doc={t.store.getState().doc} />
    </TooltipProvider>,
  );
}

describe('the Joint dialog panel', () => {
  it('shows the limits of the type: angles, lengths, or none', () => {
    const t = setupJoints();
    t.dialog.start();
    let html = render(t);
    expect(html).toContain('aria-label="Joint dialog"');
    expect(html).toContain('aria-label="Moving part"');
    expect(html).toContain('aria-label="Fixed part"');
    expect(html).toContain('Minimum angle');
    expect(html).toContain('Maximum angle');
    expect(html).toContain('data-info="joint"');
    expect(html).not.toContain('data-dialog-valid');
    t.dialog.setType('slider');
    html = render(t);
    expect(html).toContain('Maximum travel');
    t.dialog.setType('rigid');
    expect(render(t)).not.toContain('Maximum');
  });

  it("says why a loose body can't be a frame", () => {
    const t = setupJoints();
    t.dialog.start();
    t.dialog.select.onClick({ kind: 'face', id: 'X:0:1' }, false);
    expect(render(t)).toContain(LOOSE_BODY_HINT);
  });

  it('is valid once both parts are picked, and edit names the joint', () => {
    const t = setupJoints();
    t.dialog.start();
    t.dialog.select.onClick({ kind: 'face', id: 'L:0:1' }, false);
    t.dialog.select.onClick({ kind: 'face', id: 'B:0:1' }, false);
    expect(render(t)).toContain('data-dialog-valid="true"');
    t.dialog.ok();
    const id = t.store.getState().doc.joints?.[0]?.id;
    if (!id) throw new Error('no joint');
    t.dialog.edit(id);
    expect(render(t)).toContain('aria-label="Edit Joint1 dialog"');
  });
});
