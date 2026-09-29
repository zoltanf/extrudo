# ADR-0041: Notification history

- **Status:** Accepted, 2026-09-29
- **Task:** P3-16. Code: `apps/web/src/design-system/notifications.ts`
  (store, tested in `notifications.test.ts`),
  `design-system/NotificationHistory.tsx`, `design-system/Toasts.tsx`
  (`useToasts`), `shell/commands.tsx` (`notificationHistory`),
  `features/dialog.ts` (the one action that has a predicate),
  `e2e/notifications.spec.ts`.
- **Builds on:** ADR-0007 (design system, toasts) and its 2026-09-28
  amendment that moved the toasts into the view's bottom-right corner;
  ADR-0023 (commands).

## Context

Toasts vanish after 6 s (12 s for "Sketch1 is hidden"); errors stay until
dismissed, but only until the user dismisses them. A message read too late,
or an action ("Show") whose toast timed out, was gone for good. The owner
asked (2026-09-28) for a way to see earlier notifications, errors first-class,
with their actions where they still apply.

## Decisions

1. **One store per page** (`createNotifications`, vanilla Zustand, no React):
   the live `toasts` and the `history`, plus `open`, `seen` and `seq` for the
   unread count. `useToasts()` creates it and still returns
   `{ toasts, push, dismiss }`, so the home screen and the debug pages are
   unchanged; it also returns the store as `notifications`. `ProjectPage`
   hands the store to the shell in `toasts.history`. The store takes `now`
   and `later` (timers) so tests run without a clock.
2. **Every `push` is recorded**: tone, text, time, action. **Repeats are
   merged**: the same tone and text again raises `count`, moves the entry to
   the top, takes the new time and the new action, and keeps the entry's ID.
   Merging is by the whole history, not only the newest entry, because
   messages such as "Saved V1." or a refused delete come back between
   others. The toast stack itself is unchanged (a repeat still shows a new
   toast). At most 100 entries; the oldest go first.
3. **Where**: a 32 px bell button at the bottom of the toast stack, so it sits
   in the view's bottom-right corner, at the foot of the sketch palette's
   column while a sketch is open. The home screen's toasts have no history
   (`history` is optional). It shows a badge
   with the number of entries since the history was last looked at, red when
   one of them is an error; its accessible name says the same ("Notification
   history, 2 new, 1 error"). **It is drawn only once something has been
   notified** (a bell over an empty list is clutter, and this keeps every
   existing screenshot baseline as it was); Ctrl+K "Notification History"
   opens the panel from the start.
4. **The panel** is the design system's `Popover` (Radix, non-modal, side top,
   aligned to the button's right edge), a `dialog` labelled "Notification
   history": Radix moves focus in, Esc closes it and returns focus to the
   button, outside clicks close it. The list is newest first; **errors are
   a group of their own on top** ("Errors (n)", tinted rows with the error
   colour), then "Earlier". Chronology inside each group, not across them:
   what needs attention comes first however old, and toasts for errors
   already stay until dismissed, so the same rule holds after the toast is
   gone. Rows have a hidden "Error:/Done:/Info:" prefix for screen readers
   (colour is not the only cue), the message, `×n` for repeats, and the
   time (`<time>`). "Clear all" forgets the history (not the toasts on
   screen). Opening counts as seeing everything, and arrivals while it is
   open are seen at once.
5. **Actions still apply, or don't.** `ToastAction` gets an optional
   `available(): boolean`. The history calls it whenever it draws (when it
   opens, and after an action ran) and disables the button when it returns
   false, with the title "No longer applies" and a screen-reader suffix. No
   predicate means always available; a predicate that throws means not.
   Clicking an action in the history runs it and leaves the panel open (a
   toast's own button still closes its toast). The only action today, "Show"
   for sketches hidden by a feature, is available while any of its sketches
   is still there and hidden, so it is consumed by clicking it, by the eye in
   the browser, and by deleting the sketch, and applies again if the sketch
   is hidden again. Actions must therefore be idempotent and cheap to test:
   the predicate reads the live document, never a copy taken when the toast
   was made.
6. **Session state only.** The history is not stored with the document or in
   preferences, and it ends with the page. The document is the source of truth
   (hard rule); notifications describe what happened to it in this tab, and
   an action closure over old state is meaningless after a reload.
7. **Keys.** The command `notificationHistory` ("Notification History",
   group Panels, keywords "notifications messages toasts errors log") is
   offered wherever the shell has a history. **No default key**: the
   obvious candidates (N, Mod+Shift+N) are close to other tools' and to the
   browser's own, and the button and the palette suffice. Add one to
   `commands/keymap.ts` when the settings page exists.

## Rejected

- **A Toast-style stack that never dismisses** (keep everything on screen):
  covers the view and duplicates what the toasts already do.
- **A filter or tabs (All, Errors)** in place of grouping: one more control,
  and errors would still be hidden until you chose it. Grouping puts them
  first without a click. A filter is easy to add on top if the list grows.
- **Sorting purely by time:** an old unresolved error would sink under
  successes such as "Saved V3." over a long session.
- **Persisting the history** in IndexedDB or the document: see decision 6.
- **A visible bell at all times:** see decision 3; revisit if discoverability
  proves a problem (the empty state already reads "Nothing yet").
- **Storing an "applies" flag on the notification** when it is made: it
  would go stale the moment the user acts elsewhere. The predicate is read
  live.
- **Rendering the panel through a separate portal system:** the existing
  `Popover` wrapper (with a new `align` prop) does what is needed.

## Consequences and open items

- The panel reads `available()` when it draws, not on every document change.
  Any pointer click outside closes it, so a stale button can only show if the
  document changes by keyboard while it is open (Ctrl+Z); the next action
  or reopening redraws.
- Other places that show a message on their own (inline field messages,
  the status bar) are not part of the history.
- Recompute errors are shown on timeline chips and the status bar, not as
  toasts, so they are not listed. A later task could notify the first
  error of a recompute.
- Unit tests read the store directly; the panel is covered end to end
  (`e2e/notifications.spec.ts`), because `renderToStaticMarkup` draws
  Zustand hooks from the initial state and cannot see later pushes.
