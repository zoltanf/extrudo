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
});
