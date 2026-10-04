/**
 * The one undo step that replaces a whole document — a restored version
 * (ADR-0036) or a linked folder's file ("Load from disk", P4-09) — must not
 * join a transaction: whatever the user has open ends first. The Versions
 * dialog does that itself, but a toast button in the notification history is
 * called from far outside the shell's tree, so the shell's step is registered
 * here.
 */
let endOpen: () => void = () => {};

/** The shell's step, registered while a project is open. */
export function setRestoreGuard(step: () => void): void {
  endOpen = step;
}

/** Ends a sketch, a dialog or another transaction before a document is replaced. */
export function endBeforeRestore(): void {
  endOpen();
}
