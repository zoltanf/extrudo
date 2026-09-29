import { Bell } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { Button, IconButton } from './Button';
import {
  applies,
  grouped,
  type Notification,
  type NotificationStore,
  type ToastTone,
  unread,
} from './notifications';
import { Popover } from './Popover';

const DOT: Record<ToastTone, string> = {
  info: 'bg-sketch',
  success: 'bg-success',
  error: 'bg-error',
};

const TONE_WORD: Record<ToastTone, string> = { info: 'Info', success: 'Done', error: 'Error' };

/** "14:03:22" in the user's locale. */
function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * The button below the toasts and the panel it opens (P3-16, ADR-0041): the
 * session's earlier notifications, newest first, with errors in a group of
 * their own on top. Shown once something has been notified (an empty history
 * has nothing to offer; the command palette opens it any time). Actions stay
 * clickable while they still apply (`ToastAction.available`) and show
 * disabled once they don't.
 */
export function NotificationHistory({ store }: { store: NotificationStore }) {
  const history = useStore(store, (s) => s.history);
  const open = useStore(store, (s) => s.open);
  const seen = useStore(store, (s) => s.seen);
  const fresh = useMemo(() => unread({ history, seen }), [history, seen]);
  if (history.length === 0 && !open) return null;
  const errorWord = fresh.errors === 1 ? 'error' : 'errors';
  const summary =
    fresh.count === 0
      ? 'Notification history'
      : `Notification history, ${fresh.count} new${fresh.errors > 0 ? `, ${fresh.errors} ${errorWord}` : ''}`;
  return (
    <Popover
      side="top"
      align="end"
      label="Notification history"
      open={open}
      onOpenChange={(next) => store.getState().setOpen(next)}
      trigger={
        <IconButton
          label="Notifications"
          aria-label={summary}
          pressed={open}
          data-unread={fresh.count}
          data-unread-errors={fresh.errors}
          className="pointer-events-auto relative border border-line bg-raised text-ink shadow-raised"
        >
          <Bell size={16} strokeWidth={1.75} />
          {fresh.count > 0 && (
            <span
              aria-hidden="true"
              className={`-top-1.5 -right-1.5 absolute grid h-4 min-w-4 place-items-center rounded-full px-1 font-semibold text-[10px] text-on-accent leading-none ${fresh.errors > 0 ? 'bg-error' : 'bg-accent'}`}
            >
              {fresh.count}
            </span>
          )}
        </IconButton>
      }
    >
      <HistoryPanel store={store} history={history} />
    </Popover>
  );
}

function HistoryPanel({
  store,
  history,
}: {
  store: NotificationStore;
  history: readonly Notification[];
}) {
  // Whether an action applies is read when this draws; running one draws again.
  const [, redraw] = useState(0);
  const { errors, others } = grouped(history);
  const run = (n: Notification) => {
    n.action?.run();
    redraw((v) => v + 1);
  };
  return (
    <div className="w-88" data-notification-history={history.length}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-base">Notifications</h2>
        <Button
          variant="ghost"
          className="h-7 px-2"
          disabled={history.length === 0}
          onClick={() => store.getState().clear()}
        >
          Clear all
        </Button>
      </div>
      {history.length === 0 ? (
        <p className="py-3 text-muted">Nothing yet. Messages from this session show up here.</p>
      ) : (
        <div className="-mr-1 max-h-80 overflow-y-auto pr-1">
          <Group title="Errors" items={errors} onRun={run} />
          <Group title={errors.length > 0 ? 'Earlier' : undefined} items={others} onRun={run} />
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  items,
  onRun,
}: {
  title: string | undefined;
  items: readonly Notification[];
  onRun(n: Notification): void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title ?? 'Notifications'} className="mb-2 last:mb-0">
      {title && (
        <h3 className="mb-1 font-medium text-muted text-xs uppercase tracking-wide">
          {title} <span className="tabular-nums">({items.length})</span>
        </h3>
      )}
      <ul className="flex flex-col gap-1">
        {items.map((n) => {
          const ok = n.action ? applies(n.action) : false;
          return (
            <li
              key={n.id}
              data-notification={n.tone}
              className={`flex items-start gap-2.5 rounded-control py-1.5 pr-1.5 pl-2 ${n.tone === 'error' ? 'border border-error/40 bg-error/10' : ''}`}
            >
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[n.tone]}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="break-words">
                  <span className="sr-only">{TONE_WORD[n.tone]}: </span>
                  {n.text}
                  {n.count > 1 && (
                    <span className="ml-1.5 text-muted tabular-nums" data-count={n.count}>
                      <span aria-hidden="true">×{n.count}</span>
                      <span className="sr-only">, {n.count} times</span>
                    </span>
                  )}
                </p>
                <time className="text-muted text-xs" dateTime={new Date(n.at).toISOString()}>
                  {timeOf(n.at)}
                </time>
              </div>
              {n.action && (
                <button
                  type="button"
                  disabled={!ok}
                  title={ok ? undefined : 'No longer applies'}
                  onClick={() => onRun(n)}
                  className="h-7 shrink-0 rounded-control px-2 font-medium text-accent hover:bg-accent-soft disabled:pointer-events-none disabled:text-muted disabled:opacity-60"
                >
                  {n.action.label}
                  {!ok && <span className="sr-only"> (no longer applies)</span>}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
