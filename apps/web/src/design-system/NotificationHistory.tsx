import { Bell } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { Button } from './Button';
import {
  actionsOf,
  applies,
  grouped,
  type Notification,
  type NotificationStore,
  type ToastAction,
  type ToastTone,
  unread,
} from './notifications';
import { Popover } from './Popover';
import { Tooltip } from './Tooltip';

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
 * The bell at the status bar's right edge and the panel it opens (P3-16,
 * ADR-0041; moved there 2026-10-10): the session's earlier notifications,
 * newest first, with errors in a group of their own on top. Always drawn, so
 * the row doesn't jump when the first notice arrives; empty, it is a quiet
 * bell and the panel says so. Actions stay clickable while they still apply
 * (`ToastAction.available`) and show disabled once they don't.
 */
export function NotificationHistory({ store }: { store: NotificationStore }) {
  const history = useStore(store, (s) => s.history);
  const open = useStore(store, (s) => s.open);
  const seen = useStore(store, (s) => s.seen);
  const fresh = useMemo(() => unread({ history, seen }), [history, seen]);
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
        <Tooltip label="Notification history">
          <button
            type="button"
            aria-label={summary}
            aria-pressed={open}
            data-unread={fresh.count}
            data-unread-errors={fresh.errors}
            className={`relative inline-grid size-6 shrink-0 place-items-center rounded-control transition-colors duration-(--x-fast) ease-ui hover:bg-accent-soft hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-ink ${fresh.count > 0 ? 'text-ink' : 'text-muted'}`}
          >
            <Bell size={14} strokeWidth={1.75} />
            {fresh.count > 0 && (
              <span
                aria-hidden="true"
                className={`-top-1 -right-1 absolute grid h-3.5 min-w-3.5 place-items-center rounded-full px-0.5 font-semibold text-[9px] text-on-accent leading-none ${fresh.errors > 0 ? 'bg-error' : 'bg-accent'}`}
              >
                {fresh.count}
              </span>
            )}
          </button>
        </Tooltip>
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
  // Whether an action applies is read when this draws; running one draws again, and so does
  // a document change while the panel is open (`recheck`, P3-17).
  const [, redraw] = useState(0);
  useStore(store, (s) => s.checks);
  const { errors, others } = grouped(history);
  const run = (action: ToastAction) => {
    action.run();
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
        <p className="py-3 text-muted">
          No notifications yet. Messages from this session show up here.
        </p>
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
  onRun(action: ToastAction): void;
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
        {items.map((n) => (
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
            {actionsOf(n).map((action) => {
              const ok = applies(action);
              return (
                <button
                  key={action.label}
                  type="button"
                  disabled={!ok}
                  title={ok ? undefined : 'No longer applies'}
                  onClick={() => onRun(action)}
                  className="h-7 shrink-0 rounded-control px-2 font-medium text-accent hover:bg-accent-soft disabled:pointer-events-none disabled:text-muted disabled:opacity-60"
                >
                  {action.label}
                  {!ok && <span className="sr-only"> (no longer applies)</span>}
                </button>
              );
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
