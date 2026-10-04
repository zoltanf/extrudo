import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toasts } from './Toasts';

describe('Toasts', () => {
  it('draws an action button beside the text, and Dismiss', () => {
    const html = renderToStaticMarkup(
      <Toasts
        toasts={[
          {
            id: 1,
            tone: 'info',
            text: 'Sketch1 is hidden.',
            action: { label: 'Show', run: () => {} },
          },
          { id: 2, tone: 'error', text: 'Nope.' },
        ]}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('>Show</button>');
    expect(html).toContain('role="alert"');
    expect(html.match(/aria-label="Dismiss"/g)).toHaveLength(2);
    // Only the toast with an action has one.
    expect(html.match(/>Show</g)).toHaveLength(1);
  });

  it('keeps the requested strip of the corner clear, for a surface it must not cover', () => {
    const toasts = [{ id: 1, tone: 'info' as const, text: 'Sketch1 is hidden.' }];
    // The view's corner by default, so nothing overlaps the dialog until it opens.
    expect(
      renderToStaticMarkup(<Toasts toasts={toasts} onDismiss={() => {}} place="view" />),
    ).not.toContain('style=');
    // The open feature dialog's column: the stack moves left of it (its OK button).
    const html = renderToStaticMarkup(
      <Toasts toasts={toasts} onDismiss={() => {}} place="view" clearRight={280} />,
    );
    expect(html).toContain('style="right:280px"');
  });
});
