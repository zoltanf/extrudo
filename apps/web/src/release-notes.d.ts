/** The build's release notes (`pwa/release-notes.ts`, ADR-0133). */
declare module 'virtual:release-notes' {
  const notes: import('../pwa/release-notes').ReleaseNotes | null;
  export default notes;
}
