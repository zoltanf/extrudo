import { describe, expect, it, vi } from 'vitest';
import {
  actionsOf,
  applies,
  createNotifications,
  grouped,
  HISTORY_LIMIT,
  TOAST_LIFETIME_MS,
  unread,
} from './notifications';

function setup() {
  const timers: { fn(): void; ms: number }[] = [];
  let clock = 1000;
  const store = createNotifications({
    now: () => clock,
    later: (fn, ms) => void timers.push({ fn, ms }),
  });
  return {
    store,
    timers,
    tick: (ms: number) => {
      clock += ms;
    },
    state: () => store.getState(),
  };
}

describe('notifications', () => {
  it('records every notification, newest first, and keeps them after the toast leaves', () => {
    const t = setup();
    t.state().push('info', 'One.');
    t.tick(50);
    t.state().push('error', 'Two.');
    expect(t.state().history.map((n) => n.text)).toEqual(['Two.', 'One.']);
    expect(t.state().history[0]).toMatchObject({ tone: 'error', at: 1050, count: 1 });
    t.state().dismiss(t.state().toasts[0]?.id ?? -1);
    expect(t.state().toasts.map((x) => x.text)).toEqual(['Two.']);
    expect(t.state().history).toHaveLength(2);
  });

  it('times info and success toasts out, errors never', () => {
    const t = setup();
    t.state().push('info', 'Gone soon.', { lifetime: 12_000 });
    t.state().push('success', 'Also.');
    t.state().push('error', 'Stays.');
    expect(t.timers.map((x) => x.ms)).toEqual([12_000, TOAST_LIFETIME_MS]);
    for (const timer of t.timers) timer.fn();
    expect(t.state().toasts.map((x) => x.text)).toEqual(['Stays.']);
    expect(t.state().history).toHaveLength(3);
  });

  it('records a quiet notification in the history only (P3-13)', () => {
    const t = setup();
    t.state().push('error', 'Extrude2: no profile.', { quiet: true });
    t.state().push('info', 'Heads up.', { quiet: true });
    expect(t.state().toasts).toEqual([]);
    expect(t.timers).toEqual([]);
    expect(t.state().history.map((n) => n.text)).toEqual(['Heads up.', 'Extrude2: no profile.']);
    expect(unread(t.state())).toEqual({ count: 2, errors: 1 });
  });

  it('keeps three toasts on screen but every notification in the history', () => {
    const t = setup();
    for (const n of [1, 2, 3, 4]) t.state().push('error', `E${n}`);
    expect(t.state().toasts.map((x) => x.text)).toEqual(['E2', 'E3', 'E4']);
    expect(t.state().history).toHaveLength(4);
  });

  it('counts a repeat on one entry that moves to the top with the new time', () => {
    const t = setup();
    t.state().push('success', 'Saved V1.');
    t.tick(10);
    t.state().push('info', 'Other.');
    t.tick(10);
    t.state().push('success', 'Saved V1.');
    const [first, second] = t.state().history;
    expect(first).toMatchObject({ text: 'Saved V1.', count: 2, at: 1020 });
    expect(second?.text).toBe('Other.');
    expect(t.state().history).toHaveLength(2);
    // The same words in another tone are another message.
    t.state().push('error', 'Saved V1.');
    expect(t.state().history).toHaveLength(3);
    // Every one of them showed as a toast.
    expect(t.state().toasts.filter((x) => x.text === 'Saved V1.')).toHaveLength(2);
  });

  it('keeps the entry ID across a repeat and takes the latest action', () => {
    const t = setup();
    const first = vi.fn();
    const second = vi.fn();
    t.state().push('info', 'Hidden.', { action: { label: 'Show', run: first } });
    const id = t.state().history[0]?.id;
    t.state().push('info', 'Hidden.', { action: { label: 'Show', run: second } });
    expect(t.state().history[0]?.id).toBe(id);
    t.state().history[0]?.action?.run();
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    t.state().push('info', 'Hidden.');
    expect(t.state().history[0]?.action).toBeUndefined();
  });

  it('caps the history and drops the oldest', () => {
    const t = setup();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) t.state().push('info', `M${i}`);
    expect(t.state().history).toHaveLength(HISTORY_LIMIT);
    expect(t.state().history[0]?.text).toBe(`M${HISTORY_LIMIT + 4}`);
    expect(t.state().history.at(-1)?.text).toBe('M5');
  });

  it('counts what is unread until the history opens, errors apart', () => {
    const t = setup();
    t.state().push('info', 'A');
    t.state().push('error', 'B');
    expect(unread(t.state())).toEqual({ count: 2, errors: 1 });
    t.state().setOpen(true);
    expect(unread(t.state())).toEqual({ count: 0, errors: 0 });
    // Arrivals while it's open are seen at once.
    t.state().push('error', 'C');
    expect(unread(t.state())).toEqual({ count: 0, errors: 0 });
    t.state().setOpen(false);
    t.state().push('info', 'D');
    expect(unread(t.state())).toEqual({ count: 1, errors: 0 });
    // A repeat of a read message is unread again.
    t.state().push('error', 'B');
    expect(unread(t.state())).toEqual({ count: 2, errors: 1 });
  });

  it('clears the history, not the toasts', () => {
    const t = setup();
    t.state().push('error', 'Stays on screen.');
    t.state().clear();
    expect(t.state().history).toEqual([]);
    expect(unread(t.state()).count).toBe(0);
    expect(t.state().toasts).toHaveLength(1);
    t.state().push('info', 'New.');
    expect(t.state().history.map((n) => n.text)).toEqual(['New.']);
  });

  it('groups errors first, each newest first', () => {
    const t = setup();
    t.state().push('error', 'E1');
    t.state().push('info', 'I1');
    t.state().push('error', 'E2');
    t.state().push('success', 'S1');
    const { errors, others } = grouped(t.state().history);
    expect(errors.map((n) => n.text)).toEqual(['E2', 'E1']);
    expect(others.map((n) => n.text)).toEqual(['S1', 'I1']);
  });

  it('asks the action whether it still applies; no predicate means yes; a throw means no', () => {
    expect(applies({ label: 'A', run() {} })).toBe(true);
    let live = true;
    const action = { label: 'A', run() {}, available: () => live };
    expect(applies(action)).toBe(true);
    live = false;
    expect(applies(action)).toBe(false);
    expect(
      applies({
        label: 'A',
        run() {},
        available: () => {
          throw new Error('gone');
        },
      }),
    ).toBe(false);
  });

  it('asks an open panel to re-read available() when the app says something changed (P3-17)', () => {
    const t = setup();
    t.state().recheck();
    expect(t.state().checks).toBe(0);
    let hidden = true;
    t.state().push('info', 'Sketch1 is hidden.', {
      action: { label: 'Show', run: () => {}, available: () => hidden },
    });
    // Closed: nothing to redraw (opening reads it anyway).
    t.state().recheck();
    expect(t.state().checks).toBe(0);
    t.state().setOpen(true);
    hidden = false;
    t.state().recheck();
    expect(t.state().checks).toBe(1);
    expect(applies(t.state().history[0]?.action ?? { label: '', run: () => {} })).toBe(false);
  });

  it('carries several buttons on one message (P4-09, ADR-0065 §3)', () => {
    const t = setup();
    let resolves = false;
    const load = { label: 'Load from disk', run: vi.fn(), available: () => resolves };
    const overwrite = { label: 'Overwrite', run: vi.fn(), available: () => resolves };
    t.state().push('error', 'Bracket.extrudo changed on disk.', { actions: [load, overwrite] });
    const toast = t.state().toasts[0];
    // `action` is the first button, so everything that knows one still works.
    expect(toast?.action?.label).toBe('Load from disk');
    expect(actionsOf(toast ?? {}).map((a) => a.label)).toEqual(['Load from disk', 'Overwrite']);
    expect(actionsOf(t.state().history[0] ?? {}).map((a) => a.label)).toEqual([
      'Load from disk',
      'Overwrite',
    ]);
    // Both still apply, so an open history asks about them.
    t.state().setOpen(true);
    t.state().recheck();
    expect(t.state().checks).toBe(1);
    resolves = false;
    actionsOf(t.state().history[0] ?? {})[0]?.run();
    expect(load.run).toHaveBeenCalledOnce();
  });

  it('skips the recheck when no action has a predicate', () => {
    const t = setup();
    t.state().push('info', 'Saved.', { action: { label: 'Undo', run: () => {} } });
    t.state().setOpen(true);
    t.state().recheck();
    expect(t.state().checks).toBe(0);
  });
});
