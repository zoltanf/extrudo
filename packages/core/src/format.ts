/** Identifies an Extrudo document in `manifest.json` and `document.json`. */
export const FORMAT_NAME = 'extrudo';

/** Bumped on every breaking change to the document schema; migrations key off it. */
export const FORMAT_VERSION = 1;

/** Extension of a whole-project file (a zip, see docs/02-architecture.md §6.2). */
export const FILE_EXTENSION = '.extrudo';
