import { FORMAT_NAME, FORMAT_VERSION } from './format';
import { type DocumentId, newId } from './ids';
import type { ExtrudoDocument, LengthUnit } from './schema';

export interface NewDocumentOptions {
  name?: string;
  units?: LengthUnit;
  /** Show inch lengths as fractions (`1 1/2 in`); only meaningful with `units: 'in'`. */
  fractions?: boolean;
  id?: DocumentId;
  /** ISO timestamp for `meta.created` and `meta.modified`; defaults to now. */
  now?: string;
  appVersion?: string;
}

/** An empty document: no parameters, no features. */
export function createDocument(options: NewDocumentOptions = {}): ExtrudoDocument {
  const now = options.now ?? new Date().toISOString();
  return {
    format: FORMAT_NAME,
    formatVersion: FORMAT_VERSION,
    id: options.id ?? newId<DocumentId>(),
    name: options.name ?? 'Untitled',
    settings: {
      units: options.units ?? 'mm',
      precision: 2,
      ...(options.fractions ? { fractions: true } : {}),
    },
    parameters: [],
    features: [],
    timelineMarker: 0,
    bodies: {},
    views: [],
    meta: { created: now, modified: now, appVersion: options.appVersion ?? '0.0.0' },
  };
}
