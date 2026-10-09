import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotificationHistory } from './NotificationHistory';
import { createNotifications } from './notifications';
import { TooltipProvider } from './Tooltip';

// Unread counts are covered by e2e/notifications.spec.ts: static markup sees only a store's
// initial state.
describe('NotificationHistory', () => {
  it('draws a quiet bell before anything was notified (the status bar row must not jump)', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <NotificationHistory store={createNotifications()} />
      </TooltipProvider>,
    );
    expect(html).toContain('aria-label="Notification history"');
    expect(html).toContain('data-unread="0"');
    expect(html).toContain('data-unread-errors="0"');
    expect(html).toContain('text-muted');
  });
});
