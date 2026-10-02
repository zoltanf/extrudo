import { createDocument } from '@extrudo/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../design-system';
import { TutorialCard } from './TutorialCard';
import { TUTORIAL_STEPS } from './tutorial';
import type { Tutorial } from './useTutorial';

function tutorial(over: Partial<Tutorial> = {}): Tutorial {
  const facts = { doc: createDocument(), mode: 'model' as const, activeTool: undefined };
  return {
    open: true,
    index: 0,
    step: TUTORIAL_STEPS[0],
    finished: false,
    facts,
    start: vi.fn(),
    close: vi.fn(),
    skip: vi.fn(),
    ...over,
  };
}

const html = (t: Tutorial) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <TutorialCard tutorial={t} />
    </TooltipProvider>,
  );

describe('TutorialCard', () => {
  it('is a labelled region with the step, its words and the ways out', () => {
    const out = html(tutorial());
    expect(out).toContain('aria-label="Tutorial"');
    expect(out).toContain('data-tutorial-step="sketch"');
    expect(out).toContain('Step 1 of 5');
    expect(out).toContain('Start with a sketch');
    expect(out).toContain('<strong');
    expect(out).toContain('Create Sketch');
    expect(out).toContain('Skip step');
    expect(out).toContain('Close tutorial');
    // The step text is announced when it changes.
    expect(out).toContain('aria-live="polite"');
  });

  it('shows the last step as the fifth', () => {
    const out = html(tutorial({ index: 4, step: TUTORIAL_STEPS[4] }));
    expect(out).toContain('Step 5 of 5');
    expect(out).toContain('Make it yours');
  });

  it('says it is done when every step is, with a way to carry on', () => {
    const out = html(tutorial({ index: 5, step: undefined, finished: true }));
    expect(out).toContain('data-tutorial-step="finished"');
    expect(out).toContain('You made a box');
    expect(out).toContain('Keep designing');
    expect(out).not.toContain('Skip step');
  });

  it('draws nothing while closed', () => {
    expect(html(tutorial({ open: false }))).toBe('');
  });
});
