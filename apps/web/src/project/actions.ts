/** Project actions shared by the home screen and the File menu. */
import {
  createDocument,
  DocumentLoadError,
  type ExtrudoDocument,
  FILE_EXTENSION,
  type LengthUnit,
  LengthUnitSchema,
  mediaTypeOf,
  modelKind,
  randomUuid,
} from '@extrudo/core';
import type { ImportReport, ImportResult } from '@extrudo/f3d';
import type { FcstdImportReport, HistoryStop, LeftOutReason } from '@extrudo/fcstd';
import {
  ArchiveError,
  type ProjectId,
  ProjectNotFoundError,
  type ProjectSummary,
  sha256Hex,
} from '@extrudo/storage';
import { appNotifications } from '../design-system/notifications';
import { importAccept, requestModelImport } from '../features/import';
import { type OpenedFile, type Platform, type Preferences, safeFileName } from '../platform';
import { isConvertibleCad } from '../platform/cad';
import { navigate, projectHref } from '../routes';
import { APP_VERSION } from '../version';
import type { BodyCheck, BodyCheckResult } from './f3dCheck';
import type { ImportRunner } from './f3dImport';
import type { FcstdImported, FcstdImportRunner } from './fcstdImport';

/**
 * Saves a new project (blank, or the given document, with a picture for its card
 * if there is one) and returns its ID.
 */
export async function createProject(
  platform: Platform,
  doc: ExtrudoDocument = createDocument({ appVersion: APP_VERSION }),
  thumbnail?: Blob,
): Promise<ProjectId> {
  await platform.projects.save(doc);
  if (thumbnail) await platform.projects.setThumbnail(doc.id, thumbnail).catch(() => {});
  // Ask for persistent storage once there is something worth keeping (FR-PRJ-05).
  void platform.storage.requestPersistence();
  return doc.id;
}

/** The preference that remembers the unit of the last new design (FR-PRJ-07, ADR-0113 §1). */
export const NEW_DESIGN_UNITS_KEY = 'newDesignUnits';

/** The unit a new design starts in: the one last picked on the home screen's New design card. */
export function newDesignUnits(preferences: Preferences): LengthUnit {
  return LengthUnitSchema.catch('mm').parse(preferences.get(NEW_DESIGN_UNITS_KEY, 'mm'));
}

/** A new empty design in the remembered unit: the Home tab's New Design in a design. */
export function createBlankProject(platform: Platform): Promise<ProjectId> {
  return createProject(
    platform,
    createDocument({ units: newDesignUnits(platform.preferences), appVersion: APP_VERSION }),
  );
}

/** A new empty design for the tutorial (P3-12), named for what it builds. */
export function createTutorialProject(platform: Platform): Promise<ProjectId> {
  return createProject(platform, createDocument({ name: 'My first box', appVersion: APP_VERSION }));
}

/**
 * Messages for a project that is about to open (P3-13): what reading its
 * file needed to leave out. Opening a project navigates, so they wait here
 * until the project's page shows them (`takeOpenNotices`).
 */
const openNotices = new Map<string, string[]>();

export function noteOnOpen(id: ProjectId, message: string): void {
  openNotices.set(id, [...(openNotices.get(id) ?? []), message]);
}

/** The messages waiting for a project, once. */
export function takeOpenNotices(id: ProjectId): string[] {
  const notices = openNotices.get(id) ?? [];
  openNotices.delete(id);
  return notices;
}

/** Loads a project, keeping what reading it had to leave out for its page. */
export function loadProject(platform: Platform, id: ProjectId): Promise<ExtrudoDocument> {
  return platform.projects.load(id, { onNotice: (m) => noteOnOpen(id, m) });
}

/**
 * What an Extrudo design file is picked as: an `.extrudo`, or one gzipped
 * (`.extrudo.gz`, how a design comes from a GitHub issue), which
 * `readArchive` unpacks.
 */
export const DESIGN_ACCEPT = `${FILE_EXTENSION},.gz,application/zip,application/gzip`;

/**
 * Lets the user pick an `.extrudo` file (or takes `picked`) and imports it;
 * `undefined` if they cancel. An `.f3d` or FreeCAD file picked here is
 * imported as one too.
 */
export async function importProject(
  platform: Platform,
  picked?: File,
): Promise<Pick<ProjectSummary, 'id'> | undefined> {
  const file =
    picked ?? (await platform.files.pick(`${DESIGN_ACCEPT},${F3D_ACCEPT},${FCSTD_ACCEPT}`));
  if (!file) return undefined;
  if (/\.f3d$/i.test(file.name)) {
    const id = await importF3dFile(platform, file);
    return id ? { id } : undefined;
  }
  if (isFcstd(file.name)) {
    const id = await importFcstdFile(platform, file);
    return id ? { id } : undefined;
  }
  const notices: string[] = [];
  const summary = await platform.projects.importFile(file, { onNotice: (m) => notices.push(m) });
  for (const notice of notices) noteOnOpen(summary.id, notice);
  return summary;
}

/**
 * The home screen's Import… (ADR-0083 §4): a design file (`.extrudo`, `.f3d`)
 * comes in as `importProject` brings it; a model file (STEP, mesh, OpenSCAD)
 * makes a new design named for it, which opens with Import Model's dialog on
 * the file (on the desktop also another CAD program's file, which that dialog
 * converts to STEP first). `undefined` if they cancel.
 */
export async function importAnyFile(
  platform: Platform,
): Promise<Pick<ProjectSummary, 'id'> | undefined> {
  const file = await platform.files.pick(
    `${DESIGN_ACCEPT},${importAccept(!!platform.convertCad)},${FCSTD_ACCEPT}`,
  );
  if (!file) return undefined;
  // Another CAD program's file is a model too where the Import dialog converts it (ADR-0115 §1).
  const model =
    modelKind(mediaTypeOf(file.name)) || (!!platform.convertCad && isConvertibleCad(file.name));
  if (!model) return importProject(platform, file);
  const name = file.name.replace(/\.[^.]+$/, '') || 'Imported model';
  const id = await createProject(platform, createDocument({ name, appVersion: APP_VERSION }));
  requestModelImport(id, file);
  return { id };
}

/** What an `.f3d` file is picked as. */
export const F3D_ACCEPT = '.f3d';

/**
 * The most a `.f3d` file may be before it is read (M1): the import holds the
 * bytes, the unzipped entries and their decoded records in its worker's memory
 * at once, within the caps in `@extrudo/f3d`'s `archive.ts`.
 */
export const MAX_F3D_BYTES = 100 * 1024 * 1024;

/**
 * Lets the user pick an `.f3d` file and imports it as a new
 * design; `undefined` if they cancel. The importer loads only now, in its own
 * worker (`f3dImport.ts`). What it could not bring over is left for the
 * design's page. `check` stands in for the body check in tests (ADR-0084),
 * `run` for the worker.
 */
export async function importF3dFile(
  platform: Platform,
  picked?: File,
  check?: BodyCheck,
  run?: ImportRunner,
): Promise<ProjectId | undefined> {
  const file = picked ?? (await platform.files.pick(F3D_ACCEPT));
  if (!file) return undefined;
  if (file.size > MAX_F3D_BYTES)
    throw new Error(
      `This .f3d file is too large to import (the limit is ${MAX_F3D_BYTES / (1024 * 1024)} MB).`,
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.replace(/\.f3d$/i, '') || 'Imported design';
  const notifications = appNotifications.getState();
  const toast = notifications.push('info', READING_TEXT, { lifetime: 120_000 });
  let imported: ImportResult;
  try {
    imported = await (run ?? (await import('./f3dImport')).workerImportRunner())(bytes, name, {
      id: randomUuid(),
      appVersion: APP_VERSION,
    });
  } finally {
    notifications.dismiss(toast);
  }
  return saveF3dImport(platform, imported, check ?? (await import('./f3dCheck')).checkF3dBodies);
}

/** What the busy toast says while the importer reads the file. */
export const READING_TEXT = 'Reading the .f3d file…';

/** What the busy toast says while the body check runs. */
export const CHECKING_TEXT = 'Checking the bodies against the file…';

/**
 * Saves an imported `.f3d` design (ADR-0084). The body check runs first, before
 * anything is saved; then the replayed design is saved as it is, the frozen
 * bodies' STEP files are written, and the design with the plan applied is
 * saved over it. Bytes go to storage before the document that names them
 * (ADR-0061), and a failure part-way leaves the replayed design, with a notice.
 */
export async function saveF3dImport(
  platform: Platform,
  imported: ImportResult,
  check: BodyCheck,
): Promise<ProjectId> {
  const { design, report, preview, steps = [], bodies: links = [], files } = imported;
  const replay = design.toJSON();
  let result: BodyCheckResult;
  if (steps.some((s) => s.step !== undefined)) {
    const notifications = appNotifications.getState();
    const toast = notifications.push('info', CHECKING_TEXT, { lifetime: 120_000 });
    try {
      result = await check(design, steps, links, files);
    } catch (error) {
      result = { error: describeError(error) };
    } finally {
      notifications.dismiss(toast);
    }
  }
  // The files the replayed design itself imports (a base feature's body), before the document.
  for (const [attachment, bytes] of files ?? []) {
    const record = replay.attachments?.[attachment];
    if (record) await platform.projects.writeAttachment(replay.id, record.sha256, bytes);
  }
  const id = await createProject(
    platform,
    replay,
    preview ? new Blob([preview as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : undefined,
  );
  let removed = false;
  if (result && 'error' in result) {
    report.bodyCheck = { error: result.error };
  } else if (result) {
    const { applyBodyPlan, bodyFiles, bodyOutcomes } = await import('@extrudo/f3d');
    const plan = result;
    try {
      applyBodyPlan(design, plan, steps);
      const doc = design.toJSON();
      for (const [attachment, bytes] of bodyFiles(design, steps, files)) {
        const record = doc.attachments?.[attachment];
        if (record) await platform.projects.writeAttachment(id, record.sha256, bytes);
      }
      if (doc !== replay) await platform.projects.save(doc);
      report.bodies = bodyOutcomes(plan, design);
      for (const d of plan.dropped ?? []) {
        report.imported = report.imported.filter((n) => n !== d.name);
        report.skipped.push({ name: d.name, kind: 'DeleteFace', reason: d.reason });
      }
      removed = plan.remove.length > 0;
    } catch (error) {
      report.bodyCheck = { error: describeError(error) };
    }
  }
  for (const message of importNotices(report, removed)) noteOnOpen(id, message);
  return id;
}

/** What a FreeCAD file is picked as (any case: `.FCStd` is FreeCAD's own spelling). */
export const FCSTD_ACCEPT = '.fcstd';

/** Whether `fileName` is a FreeCAD file, by its extension in any case. */
export function isFcstd(fileName: string): boolean {
  return /\.fcstd$/i.test(fileName);
}

/**
 * The most a FreeCAD file may be before it is read, as `MAX_F3D_BYTES`
 * (`@extrudo/fcstd`'s `MAX_FCSTD_BYTES`; the import holds the bytes, the
 * entries it inflates and the XML tree at once).
 */
export const MAX_FCSTD_BYTES = 100 * 1024 * 1024;

/** What the busy toast says while the FreeCAD import runs. */
export const FCSTD_READING_TEXT = "Importing the FreeCAD file's shapes…";

/**
 * Lets the user pick a FreeCAD file (or takes `picked`) and imports it as a
 * new design named after the file (ADR-0144 decision 9): its final shapes as
 * bodies, each a STEP attachment on an `import` feature, with a report shown
 * when the design opens. The importer and its own kernel run in workers
 * (`fcstdImport.ts`); `run` stands in for them in tests. `undefined` if they
 * cancel.
 */
export async function importFcstdFile(
  platform: Platform,
  picked?: File,
  run?: FcstdImportRunner,
): Promise<ProjectId | undefined> {
  const file = picked ?? (await platform.files.pick(FCSTD_ACCEPT));
  if (!file) return undefined;
  if (file.size > MAX_FCSTD_BYTES)
    throw new Error(
      `This FreeCAD file is too large to import (the limit is ${MAX_FCSTD_BYTES / (1024 * 1024)} MB).`,
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.replace(/\.fcstd$/i, '') || 'Imported design';
  const notifications = appNotifications.getState();
  const toast = notifications.push('info', FCSTD_READING_TEXT, { lifetime: 15 * 60_000 });
  let imported: FcstdImported;
  try {
    imported = await (run ?? (await import('./fcstdImport')).fcstdImportRunner())(bytes, name, {
      id: randomUuid(),
      appVersion: APP_VERSION,
    });
  } finally {
    notifications.dismiss(toast);
  }
  return saveFcstdImport(platform, imported);
}

/**
 * Saves an imported FreeCAD design: the STEP files first, then the document
 * that names them (ADR-0061), then the report for its page.
 */
export async function saveFcstdImport(
  platform: Platform,
  { design, files, report }: FcstdImported,
): Promise<ProjectId> {
  const doc = design.toJSON();
  for (const [attachment, bytes] of files) {
    const record = doc.attachments?.[attachment];
    if (record) await platform.projects.writeAttachment(doc.id, record.sha256, bytes);
  }
  const id = await createProject(platform, doc);
  for (const message of fcstdNotices(report)) noteOnOpen(id, message);
  return id;
}

/** Why a shape was left out, in the app's words. */
const LEFT_OUT: Record<LeftOutReason, string> = {
  mesh: "a mesh, which Extrudo doesn't import from FreeCAD files yet",
  empty: 'no shape',
  binary: "stored in FreeCAD's binary form, which Extrudo can't read",
  unreadable: "its shape can't be read from the file",
  'no-solid': 'no solid',
  check: "its shape didn't come through unchanged",
  'too-large': 'over 25 MB as STEP',
  'design-full': "the design's files would pass 100 MB",
  kernel: "the geometry kernel couldn't read it",
  time: 'it took too long',
  'import-time': 'the import ran out of time',
  restarts: 'the geometry kernel failed too often',
};

/** Why a body's history stopped, in the app's words (after "because"). */
const HISTORY_STOP: Record<HistoryStop, string> = {
  type: "it has a feature Extrudo doesn't rebuild from FreeCAD files yet",
  suppressed: 'it has a suppressed feature',
  profile: 'a feature is made from a face or a part of a sketch',
  sketch: "a feature's sketch couldn't be imported",
  taper: 'a feature is tapered',
  direction: 'a feature goes in a direction of its own',
  'up-to': 'a feature goes up to a face or a shape',
  axis: "a revolve turns about an axis Extrudo can't use yet",
  value: "a feature has a value Extrudo can't read",
  option: "a feature has a setting Extrudo can't rebuild",
  'no-base': 'a cut, hole, fillet or chamfer comes before anything to work on',
  base: "a fillet or chamfer doesn't work on the feature before it",
  element: "a fillet, chamfer, pattern or mirror names an edge or face its body doesn't have",
  edges: 'a fillet or chamfer has no edges, or more than Extrudo can take',
  reference: "an edge or face a feature names couldn't be found on the rebuilt body",
  original: "a pattern or mirror repeats a feature Extrudo can't repeat",
  'transform-reference':
    "a pattern or mirror goes along a direction, axis or plane Extrudo can't use yet",
  'multi-transform': "a pattern of patterns combines steps Extrudo can't rebuild yet",
  chain: "its features don't follow each other",
  limit: 'it has too many features, or a pattern or hole larger than Extrudo takes',
  stored: "a feature's shape can't be read from the file",
  failed: 'a feature failed when Extrudo rebuilt it',
  differs: "a rebuilt feature didn't match the file's shape",
  kernel: 'the geometry kernel failed',
  time: 'rebuilding took too long',
  'import-time': 'the import ran out of time',
  restarts: 'the geometry kernel failed too often',
};

/** The FreeCAD import's report as a few readable notices. */
export function fcstdNotices(
  report: Pick<
    FcstdImportReport,
    'shapes' | 'leftOut' | 'finalShapes' | 'problems' | 'linkArrays'
  > &
    Partial<Pick<FcstdImportReport, 'bodies'>>,
): string[] {
  if (report.finalShapes === 0)
    return ['The FreeCAD file has no shapes to import, so the design is empty.'];
  const bodies = report.bodies ?? [];
  const history = bodies.filter((b) => b.outcome === 'history').length;
  const came = report.shapes.length + history;
  const plain = report.shapes.length;
  const total = `${report.finalShapes} shape${report.finalShapes === 1 ? '' : 's'}`;
  const out = [
    history === 0
      ? `Imported from the FreeCAD file: ${came} of ${total}, as ${came === 1 ? 'a body' : 'bodies'} without history.`
      : plain === 0
        ? `Imported from the FreeCAD file: ${came} of ${total}, with ${history === 1 ? 'its' : 'their'} history (sketches and features).`
        : `Imported from the FreeCAD file: ${came} of ${total}, ${history} with ${history === 1 ? 'its' : 'their'} history and ${plain} as ${plain === 1 ? 'a body' : 'bodies'} without history.`,
  ];
  const short = bodies.filter((b) => b.outcome === 'shape' && b.stop);
  if (short.length > 0) {
    const why = new Map<HistoryStop, number>();
    for (const b of short) {
      const reason = b.stop?.reason as HistoryStop;
      why.set(reason, (why.get(reason) ?? 0) + 1);
    }
    const common = [...why]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([reason]) => HISTORY_STOP[reason]);
    const partial = short.filter((b) => b.bodies.length > 0);
    out.push(
      `Taken from the file's own shapes, without their whole history: ${listed(short.map((b) => b.name))}${short.length === 1 ? ', because' : '. Most often because'} ${common.join(', or ')}.${
        partial.length > 0
          ? ' The features rebuilt before that stay in the timeline, ahead of a Remove that takes out what they made.'
          : ''
      }`,
    );
  }
  const byReason = new Map<LeftOutReason, string[]>();
  for (const l of report.leftOut)
    byReason.set(l.reason, [...(byReason.get(l.reason) ?? []), l.name]);
  if (byReason.size > 0)
    out.push(
      `Not imported: ${[...byReason]
        .map(([reason, names]) => `${listed(names)} (${LEFT_OUT[reason]})`)
        .join('; ')}.`,
    );
  // A body whose history stopped and whose own shape couldn't come in either: what was rebuilt stands in for it.
  const partly = bodies.filter((b) => b.outcome === 'left-out' && b.bodies.length > 0);
  if (partly.length > 0)
    out.push(
      `Only partly rebuilt, up to the feature where the history stopped: ${listed(partly.map((b) => b.name))}. ${partly.length === 1 ? 'It is' : 'They are'} not the whole shape from the file.`,
    );
  const threads = bodies.reduce(
    (n, b) => n + b.mapped.filter((m) => m.kind === 'hole' && m.threadLost).length,
    0,
  );
  if (threads > 0)
    out.push(
      `${threads === 1 ? 'A threaded hole' : `${threads} threaded holes`} came in as ${threads === 1 ? 'a plain hole' : 'plain holes'} of the size the file stores: the thread itself is not modelled.`,
    );
  if (report.linkArrays.length > 0)
    out.push(`Of each link array only one copy came in: ${listed([...report.linkArrays])}.`);
  const unread = report.problems.length;
  if (unread > 0)
    out.push(
      `${unread} thing${unread === 1 ? '' : 's'} in the file could not be read; shapes that depend on them may be missing. Please report it with the file: Help › Report a Bug…`,
    );
  return out;
}

/** At most six items, then "and N more". */
function listed(items: string[]): string {
  const shown = items.slice(0, 6);
  const more = items.length - shown.length;
  return `${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}`;
}

/**
 * The import report as a few readable notices. `removed`: the body check took
 * replayed bodies out with "Remove rebuilt bodies".
 */
export function importNotices(
  report: Pick<
    ImportReport,
    'imported' | 'skipped' | 'problems' | 'constraints' | 'bodies' | 'bodyCheck'
  >,
  removed = false,
): string[] {
  const skipped = report.skipped.filter((s) => s.reason !== 'suppressed in the file');
  const total = report.imported.length + skipped.length;
  const out = [
    `Imported from the .f3d file: ${report.imported.length} of ${total} timeline features.`,
  ];
  if (skipped.length > 0)
    out.push(`Not imported: ${listed(skipped.map((s) => `${s.name} (${s.reason})`))}.`);
  const unread = report.problems.length;
  if (unread > 0)
    out.push(
      `${unread} record${unread === 1 ? '' : 's'} in the file could not be read (a format Extrudo doesn't know yet); features that depend on them may be wrong. Please report it with the file: Help › Report a Bug…`,
    );
  const c = report.constraints;
  const left = c ? Object.values(c.leftOut).reduce((a, b) => a + b, 0) : 0;
  if (c && c.constraints + c.dimensions + left > 0)
    out.push(
      `Sketches keep ${c.constraints} constraints and ${c.dimensions} dimensions from the file${left > 0 ? `; ${left} were left out because they would over-constrain or move the geometry, or have no counterpart` : ''}.`,
    );
  if (report.bodyCheck)
    out.push(
      `The bodies couldn't be checked against the file (${report.bodyCheck.error}); the design is as the timeline rebuilt it.`,
    );
  const bodies = report.bodies ?? [];
  // A name the file repeats (in two components) says which component it is in.
  const counts = new Map<string, number>();
  for (const b of bodies) counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
  const label = (b: (typeof bodies)[number]) =>
    b.component !== undefined && (counts.get(b.name) ?? 0) > 1
      ? `${b.name} in ${b.component}`
      : b.name;
  const count = (outcome: string) => bodies.filter((b) => b.outcome === outcome).length;
  const frozen = bodies.filter((b) => b.outcome === 'frozen');
  if (frozen.length > 0)
    out.push(
      `Taken from the file's own shapes, without history: ${listed(frozen.map((b) => (b.reason ? `${label(b)} (${b.reason})` : label(b))))}.${removed ? ' Suppress "Remove rebuilt bodies" to see what the timeline made.' : ''}`,
    );
  const missing = count('missing');
  if (missing > 0)
    out.push(
      missing === 1
        ? "One of the file's bodies is missing: the timeline didn't make it, and its shape can't be read from the file yet."
        : `${missing} of the file's bodies are missing: the timeline didn't make them, and their shapes can't be read from the file yet.`,
    );
  const editable = count('editable');
  if (editable > 0 && frozen.length === 0 && missing === 0)
    out.push(
      editable === bodies.length
        ? editable === 1
          ? "The body matches the file's own shape."
          : `All ${editable} bodies match the file's own shapes.`
        : `${editable} of ${bodies.length} bodies match the file's own shapes; the rest couldn't be checked.`,
    );
  return out;
}

/** Downloads a project as `<name>.extrudo` and returns the file name. */
export async function exportProject(platform: Platform, id: ProjectId, name: string) {
  const file = await platform.projects.exportFile(id);
  const fileName = safeFileName(name, FILE_EXTENSION);
  platform.files.download(file, fileName);
  return fileName;
}

/**
 * Opens a `.extrudo` file the desktop app was handed (Open…, an association,
 * argv or the Open Recent list; P6-01 slice 2). Main already read the bytes;
 * the project is imported and linked to that file, as a linked-folder file is
 * (ADR-0065 §3), then opened; an `.extrudo.gz` is imported but not linked.
 * Leaves the notices for the project's page, the way `importProject` does.
 */
export async function openExternalFile(
  platform: Platform,
  file: OpenedFile,
): Promise<ProjectSummary> {
  // A gzipped file (`.extrudo.gz`, from a GitHub issue) comes in as a copy, the
  // way Import… brings it: linking it would write a plain zip back into a `.gz`.
  const gzipped = /\.gz$/i.test(file.path);
  // A file already linked to a project opens that project rather than importing
  // a second copy (P6-01 slice 2, finding 3): the desktop links an opened path
  // `external`, so a second open (a re-launch, a double-click) navigates to it.
  const existing = gzipped
    ? undefined
    : (await platform.projects.list()).find(
        (summary) =>
          !summary.trashed && summary.linked?.external && summary.linked.file === file.path,
      );
  if (existing) {
    navigate(projectHref(existing.id));
    return existing;
  }
  const notices: string[] = [];
  const summary = await platform.projects.importFile(
    new Blob([file.bytes as Uint8Array<ArrayBuffer>]),
    {
      onNotice: (message) => notices.push(message),
    },
  );
  if (!gzipped) {
    await platform.projects.link(summary.id, {
      file: file.path,
      modified: file.modified,
      sha256: sha256Hex(file.bytes),
      external: true,
    });
  }
  for (const notice of notices) noteOnOpen(summary.id, notice);
  navigate(projectHref(summary.id));
  return summary;
}

/** A plain-language message for a storage or file error (UI spec §8). */
export function describeError(error: unknown): string {
  if (error instanceof ArchiveError || error instanceof ProjectNotFoundError) return error.message;
  if (error instanceof DocumentLoadError) {
    if (error.code === 'too-new') {
      return 'This design was made with a newer Extrudo. Update the app to open it.';
    }
    return error.message;
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'The browser is out of storage space for this site.';
  }
  return error instanceof Error ? error.message : String(error);
}
