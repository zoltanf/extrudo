import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './design-system/ErrorBoundary';
import { CrashScreen, saveAndReload } from './RootBoundary';

describe('CrashScreen', () => {
  it('says what happened and offers Reload', () => {
    const html = renderToStaticMarkup(
      <CrashScreen error={new Error('kaput')} onReload={() => {}} />,
    );
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Your work is saved');
    expect(html).toContain('kaput');
    expect(html).toContain('Reload');
  });
});

describe('saveAndReload', () => {
  it('saves, then reloads', async () => {
    const order: string[] = [];
    await saveAndReload(
      async () => {
        order.push('save');
        return true;
      },
      () => order.push('reload'),
    );
    expect(order).toEqual(['save', 'reload']);
  });

  it('reloads even when saving throws', async () => {
    const reload = vi.fn();
    await saveAndReload(() => Promise.reject(new Error('no')), reload);
    expect(reload).toHaveBeenCalled();
  });
});

describe('ErrorBoundary', () => {
  it('derives its state from a thrown error', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('x')).error?.value).toBeInstanceOf(
      Error,
    );
  });
});
