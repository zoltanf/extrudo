import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '../design-system';
import { SoftwareRendering } from './SoftwareRendering';

const html = (kind: 'hardware' | 'software') =>
  renderToStaticMarkup(
    <TooltipProvider>
      <SoftwareRendering support={kind === 'software' ? { kind, reason: 'x' } : { kind }} />
    </TooltipProvider>,
  );

describe('SoftwareRendering', () => {
  it('shows for software only', () => {
    expect(html('software')).toContain('data-renderer="software"');
    expect(html('software')).toContain('Software rendering');
    expect(html('hardware')).not.toContain('data-renderer');
  });
});
