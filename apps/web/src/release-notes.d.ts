/** The build's release notes (`pwa/release-notes.ts`, ADR-0133). */
declare module 'virtual:release-notes' {
  const notes: import('../pwa/release-notes').ReleaseNotes | null;
  export default notes;
}

/** Every earlier CHANGELOG section (`pwa/release-notes.ts`, ADR-0133's amendment). */
declare module 'virtual:release-history' {
  const history: import('../pwa/release-notes').ReleaseHistoryEntry[];
  export default history;
}
