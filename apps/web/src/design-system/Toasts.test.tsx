import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CLAMP_GUESS, mightOverflow } from './ClampedText';
import { HistoryPanel } from './NotificationHistory';
import { createNotifications } from './notifications';
import { TOAST_MAX_WIDTH, Toasts } from './Toasts';

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

  it('draws every button of a message with two answers (P4-09)', () => {
    const html = renderToStaticMarkup(
      <Toasts
        toasts={[
          {
            id: 1,
            tone: 'error',
            text: 'Bracket.extrudo changed on disk.',
            actions: [
              { label: 'Load from disk', run: () => {} },
              { label: 'Overwrite', run: () => {} },
            ],
          },
        ]}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain('>Load from disk</button>');
    expect(html).toContain('>Overwrite</button>');
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

  // R3-17 (the owner's UI review 3): an import's report filled the whole view with five lines
  // of numbers. A toast is at most 420 px wide and shows three lines, with Show more.
  const long = Array.from({ length: 400 }, (_, i) => `{${1000 + i}|${2000 + i}}`).join('');

  it('clamps a 2,000-character message to three lines in a toast at most 420 px wide', () => {
    expect(long.length).toBeGreaterThanOrEqual(2000);
    expect(TOAST_MAX_WIDTH).toBe(420);
    const html = renderToStaticMarkup(
      <Toasts toasts={[{ id: 1, tone: 'info', text: long }]} onDismiss={() => {}} place="view" />,
    );
    // The stack and the toast itself are held to the width.
    expect(html).toContain('max-w-[420px]');
    expect(html).toContain('max-w-[min(420px,100%)]');
    // Three lines until expanded; a run without spaces breaks anywhere instead of widening it.
    expect(html).toContain('line-clamp-3');
    expect(html).toContain('data-clamped="true"');
    expect(html).toContain('[overflow-wrap:anywhere]');
    // The whole text is in the page (a screen reader reads it), and a button shows it all.
    expect(html).toContain(long);
    const button = html.match(
      /<button type="button" aria-expanded="false" aria-controls="([^"]+)"[^>]*>Show more<\/button>/,
    );
    expect(button).not.toBeNull();
    expect(html).toContain(`id="${button?.[1]}"`);
  });

  it('leaves a short message whole, with no Show more', () => {
    expect(mightOverflow('Exported bracket.extrudo.')).toBe(false);
    expect(mightOverflow('x'.repeat(CLAMP_GUESS + 1))).toBe(true);
    expect(mightOverflow('one\ntwo\nthree\nfour')).toBe(true);
    const html = renderToStaticMarkup(
      <Toasts
        toasts={[{ id: 1, tone: 'success', text: 'Exported bracket.extrudo.' }]}
        onDismiss={() => {}}
      />,
    );
    expect(html).not.toContain('line-clamp-3');
    expect(html).not.toContain('Show more');
  });

  it('clamps the same message in the notification history, the full text one click away', () => {
    const store = createNotifications();
    store.getState().push('error', long);
    store.getState().push('success', 'Saved V1.');
    const html = renderToStaticMarkup(
      <HistoryPanel store={store} history={store.getState().history} />,
    );
    expect(html).toContain(long);
    expect(html.match(/line-clamp-3/g)).toHaveLength(1);
    expect(html.match(/>Show more</g)).toHaveLength(1);
    expect(html).toContain('<span class="sr-only">Error: </span>');
  });
});
