// The Clearance section (P6-05 J3): its lines, the progress, Show only where a pose can be set.
import type { JointId } from '@extrudo/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../design-system';
import { ClearanceSection } from './ClearanceSection';
import type { JointCheckController, JointCheckTool } from './useJointCheck';

const SETTINGS = { units: 'mm', precision: 2 } as never;

function tool(over: Partial<JointCheckTool> = {}): JointCheckTool {
  return {
    controller: {
      evaluate: () => ({ ok: true, value: 0.3, dim: { length: 1, angle: 0 } }),
      setMin: vi.fn(),
      start: vi.fn(),
      cancel: vi.fn(),
    } as unknown as JointCheckController,
    state: { joint: 'j' as JointId, min: '0.3 mm', on: true },
    joint: undefined,
    status: 'ready',
    result: undefined,
    progress: undefined,
    error: undefined,
    lines: [
      { kind: 'tightest', text: 'Tightest gap 0.18 mm at 72°', show: 72 },
      { kind: 'collision', text: 'Collides from 140.1° to 180.0° (3.2 mm³ at 150°)', show: 150 },
    ],
    summary: undefined,
    ...over,
  };
}

const render = (t: JointCheckTool, onShow?: (v: number) => void, joint = 'j') =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ClearanceSection
        tool={t}
        joint={joint as JointId}
        defaultMin="tolerance"
        settings={SETTINGS}
        {...(onShow && { onShow })}
      />
    </TooltipProvider>,
  );

describe('the Clearance section', () => {
  it('lists the result, with Show where the joint can be posed', () => {
    const html = render(tool(), () => {});
    expect(html).toContain('aria-label="Clearance"');
    expect(html).toContain('data-clearance-state="ready"');
    expect(html).toContain('data-joint-result-line="tightest"');
    expect(html).toContain('Tightest gap 0.18 mm at 72°');
    expect(html).toContain('aria-label="Show: Collides from 140.1° to 180.0° (3.2 mm³ at 150°)"');
    expect(html).toContain('Check clearance');
  });

  it('has no Show without a pose to set', () => {
    expect(render(tool())).not.toContain('Show:');
  });

  it('says how far a running check is, and that a result is stale', () => {
    const running = render(tool({ status: 'pending', progress: { done: 12, of: 36 }, lines: [] }));
    expect(running).toContain('Checking 12 of 36…');
    expect(running).toContain('aria-label="Cancel check"');
    expect(running).not.toContain('Check clearance');
    expect(render(tool({ status: 'stale' }))).toContain('The design changed: check again.');
  });

  it("doesn't show another joint's check: a new one starts at the default minimum", () => {
    const html = render(tool(), () => {}, 'other');
    expect(html).toContain('data-clearance-state="idle"');
    expect(html).not.toContain('data-joint-result');
    expect(html).toContain('value="tolerance"');
  });
});
