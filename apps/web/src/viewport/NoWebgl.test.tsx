import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoWebgl, ViewStopped } from './NoWebgl';

describe('NoWebgl', () => {
  it('is the region "3D view unavailable" with the advice', () => {
    const html = renderToStaticMarkup(<NoWebgl onRetry={() => {}} />);
    expect(html).toContain('aria-label="3D view unavailable"');
    expect(html).toContain('data-webgl="none"');
    expect(html).toContain('Extrudo can&#x27;t draw the 3D view in this browser');
    expect(html).toContain('Use graphics acceleration when available');
    expect(html).toContain('Try again');
    expect(html).toContain('Your design is safe');
  });

  it('leads with the launch command in a Chromium browser', () => {
    const html = renderToStaticMarkup(
      <NoWebgl
        onRetry={() => {}}
        launch={{ command: 'google-chrome --enable-unsafe-swiftshader --app=https://x.test/' }}
        gpu="edge://gpu"
      />,
    );
    expect(html).toContain('data-swiftshader-command');
    expect(html).toContain('--enable-unsafe-swiftshader');
    expect(html).toContain('this one window only');
    expect(html).toContain('Export .extrudo');
    expect(html).toContain('edge://gpu');
  });

  it('shows only the flags for another Chromium browser', () => {
    const html = renderToStaticMarkup(
      <NoWebgl
        onRetry={() => {}}
        launch={{ flags: '--enable-unsafe-swiftshader --use-angle=swiftshader' }}
      />,
    );
    expect(html).toContain('data-swiftshader-flags');
    expect(html).not.toContain('data-swiftshader-command');
    expect(html).toContain('--user-data-dir');
  });

  it('has no command without one', () => {
    expect(renderToStaticMarkup(<NoWebgl onRetry={() => {}} launch={undefined} />)).not.toContain(
      'data-swiftshader-command',
    );
  });

  it('ViewStopped shows the message', () => {
    const html = renderToStaticMarkup(<ViewStopped message="oops" onRetry={() => {}} />);
    expect(html).toContain('The 3D view stopped working');
    expect(html).toContain('oops');
  });
});
