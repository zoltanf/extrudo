/**
 * The Settings screen's inventory (ADR-0082): every preference key the app reads, in the one
 * section that edits it, or in `NOT_IN_SETTINGS` with the reason. `inventory.test.ts` scans the
 * source for keys and fails on one that is in neither, so a new preference has to be placed.
 *
 * The `viewport` preference is one object of display settings; its fields are listed as
 * `viewport.<field>`.
 */
export type SectionId = 'general' | 'view' | 'sketch' | 'printing' | 'export' | 'desktop';

export interface SectionInfo {
  id: SectionId;
  label: string;
  /** What the page is about, one line under its heading. */
  summary: string;
  /** The preference keys the page edits. */
  keys: readonly string[];
  /** Shown only where the app is the desktop build. */
  desktopOnly?: boolean;
}

export const SECTIONS: readonly SectionInfo[] = [
  {
    id: 'general',
    label: 'General',
    summary: 'Appearance and the right-click menu.',
    keys: ['theme', 'marking.radial', 'marking.slots'],
  },
  {
    id: 'view',
    label: 'View and navigation',
    summary: 'How the mouse moves the camera, and how the model is drawn.',
    keys: ['viewport.preset', 'viewport.projection', 'viewport.visualStyle', 'viewport.grid'],
  },
  {
    id: 'sketch',
    label: 'Sketch',
    summary: 'What a sketch shows and what its tools snap to.',
    keys: [
      'viewport.snap',
      'viewport.sketchPoints',
      'viewport.sketchConstraints',
      'viewport.sketchDimensions',
      'viewport.sketchProfiles',
      'viewport.autoProject',
      'viewport.autoProjectFace',
      'viewport.sketchSlice',
    ],
  },
  {
    id: 'printing',
    label: '3D printing',
    summary: 'The material and print settings behind Print Info.',
    keys: ['print.material'],
  },
  {
    id: 'export',
    label: 'Export',
    summary: 'What the Export dialog starts with.',
    keys: ['export.model'],
  },
  {
    id: 'desktop',
    label: 'Desktop',
    summary: 'Slicers on this computer.',
    keys: ['slicers.paths'],
    desktopOnly: true,
  },
];

/** Preferences with no control in Settings, and why. */
export const NOT_IN_SETTINGS: readonly { key: string; reason: string }[] = [
  { key: 'settings.section', reason: "The dialog's own memory of the last section." },
  { key: 'toolbox.pins', reason: 'Edited in place: the pin on a command in the Toolbox.' },
  { key: 'panel.*', reason: 'Layout state: panel sizes and collapsed state, set by dragging.' },
  { key: 'onboarding.tour', reason: 'Progress, not a choice: the tutorial restarts from Help.' },
  {
    key: 'render.softwareNotice',
    reason: 'A dismissal: the notice about software rendering was seen.',
  },
  {
    key: 'viewport.origin',
    reason: "Per item, in the browser's Origin folder, where the planes and axes are listed.",
  },
];

export function sectionOf(key: string): SectionInfo | undefined {
  return SECTIONS.find((s) => s.keys.includes(key));
}

export function isExcluded(key: string): boolean {
  return NOT_IN_SETTINGS.some((e) => e.key === key);
}

/** The sections a platform shows. */
export function visibleSections(desktop: boolean): readonly SectionInfo[] {
  return SECTIONS.filter((s) => desktop || !s.desktopOnly);
}
