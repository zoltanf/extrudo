/**
 * The body check compares the bodies the replay made against the file's own B-rep
 * bodies. The importer rebuilds a design from the timeline and, where the file
 * carried a B-rep stream, `brep-step.ts` writes that body as STEP. This module
 * compares the two sets by geometry and decides, per file body, whether the
 * replayed body is the file's (editable) or the file's own shape must come in
 * frozen, with the replayed version taken out by a Remove.
 *
 * Three pieces, all pure but for the `Design` edits, so the app and the Node
 * corpus tooling run the same code:
 *
 * 1. {@link probeDocument}: the replay document plus one attachment record and
 *    one `import` per written body, appended at the marker. A kernel measures
 *    the replay's bodies and the probe's import bodies; the app supplies the
 *    kernel (this module has none).
 * 2. {@link planBodies}: pairs the measured replayed bodies with the measured
 *    file bodies (volume within {@link VOLUME_TOLERANCE}, tight bbox within
 *    {@link BOX_TOLERANCE} mm), finds the counterpart of each unpaired body and
 *    the leftovers, and says what each file body's outcome is. Pure.
 * 3. {@link applyBodyPlan}: one `Remove "Remove rebuilt bodies"` first, then one
 *    `import "Import Body<n>"` per frozen body (its own attachment, its own
 *    component stamp), and the file's name on every matched body. One undo
 *    step; the rollback marker is untouched.
 *
 * The writer runs on untrusted bytes, so nothing here loops or allocates
 * unbounded: the pairing is O(|F|·|R|) over the design's own bodies, and the
 * attachment limits (25 MB a file, 100 MB a design) are applied in the plan.
 */
import { Design } from '@extrudo/api';
import {
  type Attachment,
  type AttachmentId,
  addAttachment,
  type BodyId,
  type ComponentId,
  importInputs,
  newId,
  updateBody,
} from '@extrudo/core';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_BYTES, sha256Hex } from '@extrudo/storage';
import type { BodyStep } from './brep-step';
import type { BodyLink, BodyOutcome } from './map';

/** A replayed body and a file body are the same when the volume is within this fraction of the file's. */
export const VOLUME_TOLERANCE = 0.005;
/** …and the tight bounding boxes agree within this many mm on every side. */
export const BOX_TOLERANCE = 0.05;
/** The smallest box overlap (IoU) that makes an unpaired replayed body a frozen body's counterpart. */
export const IOU_MIN = 0.5;

/** The Remove feature's name. */
export const REMOVE_NAME = 'Remove rebuilt bodies';

/** A body's measured shape: volume (mm³) and tight bounding box (mm). */
export interface BodyMeasure {
  volume: number;
  /** `[xmin, ymin, zmin, xmax, ymax, zmax]`, mm. */
  box: readonly [number, number, number, number, number, number];
}

/** A replayed body at the marker, as a kernel measured it. */
export interface ReplayedBody {
  id: BodyId;
  measure: BodyMeasure;
}

/** Everything known about one visible file body before planning. */
export interface FileBody {
  record: number;
  name: string;
  /** The Extrudo component the file has it in (`BodyLink.component`), when it has one. */
  component?: ComponentId;
  /** The replayed body the creator link points at (`BodyLink.hint`), when the replay knows it. */
  hint?: BodyId;
  /** The STEP text's size in bytes, when the body was written (the attachment limit). */
  size?: number;
  /** The probe imported it cleanly (exactly one body, volume > 0) — absent otherwise. */
  measure?: BodyMeasure;
  /** Why it wasn't checked (the writer's or the probe's reason), when `measure` is absent. */
  unchecked?: string;
}

/** What `planBodies` pairs over: the replayed bodies and every visible file body. */
export interface BodyMeasures {
  /** Replayed bodies at the marker whose metadata is not `visible: false`, timeline order. */
  replayed: readonly ReplayedBody[];
  /** Every visible file body, in file order. */
  file: readonly FileBody[];
}

/** One probe import: which file body it is, and the feature/body/attachment it became. */
export interface ProbeBody {
  record: number;
  /** The probe import feature's ID. */
  feature: string;
  /** The probe body's ID (`<feature>:0`). */
  body: BodyId;
  attachment: AttachmentId;
}

/** A replay document prepared for the kernel: the bodies it names, and their STEP bytes. */
export interface BodyProbe {
  /** The replay document plus one `import` per written body, appended at the marker. */
  design: Design;
  /** The probe imports, in file order. */
  bodies: ProbeBody[];
  /** The STEP bytes by attachment ID, for the kernel's `FileSource`. */
  files: Map<AttachmentId, Uint8Array>;
}

/** The plan's view of one file body. */
export interface PlannedBody {
  record: number;
  name: string;
  component?: ComponentId;
  outcome: 'editable' | 'frozen' | 'unchecked' | 'missing';
  /** Plain words for the notice: "the timeline made it differently" | "the timeline didn't make it". */
  reason?: string;
  /** Technical: the match's dv/db, or the writer's/probe's reason. */
  detail?: string;
}

/** What to do with the file's bodies: what matched, what freezes, what comes out. */
export interface BodyPlan {
  /** The replayed body each matched file body is (kept editable, renamed to the file's name). */
  matched: { body: BodyId; record: number; name: string; component?: ComponentId }[];
  /** The file bodies that come in frozen, with the replayed body to take out (when there is one). */
  frozen: { record: number; name: string; component?: ComponentId; counterpart?: BodyId }[];
  /** The replayed bodies the one Remove takes out (counterparts, then leftovers). */
  remove: BodyId[];
  /** One outcome per visible file body, in file order. */
  outcomes: PlannedBody[];
}

/** The byte length of a STEP text, as it will be stored (ASCII). */
export function stepSize(step: string): number {
  return new TextEncoder().encode(step).length;
}

/**
 * Builds the file-body list `planBodies` takes from the writer's steps, the
 * importer's links and what a kernel measured of each probe body. A record with
 * a measure `{ error }` (the probe import failed) is unchecked with that reason.
 * Pure; the app and the corpus tooling share it.
 */
export function fileBodies(
  steps: readonly BodyStep[],
  links: readonly BodyLink[],
  measured: ReadonlyMap<number, BodyMeasure | { error: string }>,
): FileBody[] {
  const linkOf = new Map(links.map((l) => [l.record, l]));
  return steps.map((step) => {
    const link = linkOf.get(step.record);
    const got = measured.get(step.record);
    // A file body counts as checked only with a clean import (one body, a positive volume).
    const measure = got && !('error' in got) && got.volume > 0 ? got : undefined;
    const reason =
      got && 'error' in got
        ? got.error
        : got && !('error' in got) && got.volume <= 0
          ? 'the probe made no solid for it'
          : step.reason;
    return {
      record: step.record,
      name: step.name,
      ...(link?.component !== undefined ? { component: link.component } : {}),
      ...(link?.hint !== undefined ? { hint: link.hint } : {}),
      ...(step.step !== undefined ? { size: stepSize(step.step) } : {}),
      ...(measure ? { measure } : { unchecked: reason ?? 'the shape could not be read' }),
    };
  });
}

/**
 * The replay document plus one attachment record and one `import` per written
 * body, so a kernel computes the replayed bodies and the file's
 * own shapes together. Only bodies the writer could write are probed; the rest
 * stay unchecked. The probe is thrown away after measuring: it is not the
 * project's document.
 */
export function probeDocument(replay: Design, steps: readonly BodyStep[]): BodyProbe {
  const design = Design.from(replay.toJSON());
  const bodies: ProbeBody[] = [];
  const files = new Map<AttachmentId, Uint8Array>();
  design.transaction('Probe the file bodies', () => {
    for (const step of steps) {
      if (step.step === undefined) continue;
      const bytes = new TextEncoder().encode(step.step);
      const attachment = newId<AttachmentId>();
      const record: Attachment = {
        name: step.name,
        fileName: `${step.name}.step`,
        mediaType: 'model/step',
        sha256: sha256Hex(bytes),
        size: bytes.length,
      };
      design.state.dispatch(addAttachment({ id: attachment, attachment: record }));
      const feature = design.add('import', importInputs({ file: attachment, up: 'z' }), {
        name: `Probe ${step.name}`,
      });
      files.set(attachment, bytes);
      bodies.push({
        record: step.record,
        feature: feature.id,
        body: `${feature.id}:0` as BodyId,
        attachment,
      });
    }
  });
  return { design, bodies, files };
}

/** What a probe recompute made: each feature's status and the bodies, in order. */
export interface ProbeOutput {
  features: Readonly<Record<string, { status: 'ok' | 'warning' | 'error'; message?: string }>>;
  bodies: readonly BodyId[];
}

/**
 * Measures what a probe recompute made, with the kernel's measuring function:
 * the replayed bodies (not a probe import's, not hidden by the replay) and,
 * per probed file body, its measure or why its import is not clean (a feature
 * that did not finish `ok`, or other than exactly one body). The result is
 * what `fileBodies` and `planBodies` take.
 */
export async function measureProbe(
  probe: BodyProbe,
  made: ProbeOutput,
  measure: (body: BodyId) => Promise<BodyMeasure | undefined>,
): Promise<{
  replayed: ReplayedBody[];
  measured: Map<number, BodyMeasure | { error: string }>;
}> {
  const probeBodies = new Set(probe.bodies.map((b) => b.body));
  const replayed: ReplayedBody[] = [];
  for (const id of made.bodies) {
    if (probeBodies.has(id) || probe.design.doc.bodies[id]?.visible === false) continue;
    const m = await measure(id);
    if (m) replayed.push({ id, measure: m });
  }
  const measured = new Map<number, BodyMeasure | { error: string }>();
  for (const b of probe.bodies) {
    const status = made.features[b.feature];
    const count = made.bodies.filter((id) => id.startsWith(`${b.feature}:`)).length;
    if (status && status.status !== 'ok') {
      measured.set(b.record, { error: status.message ?? 'the probe import failed' });
    } else if (count !== 1) {
      measured.set(b.record, { error: `the probe made ${count} bodies` });
    } else {
      measured.set(b.record, (await measure(b.body)) ?? { error: 'no body' });
    }
  }
  return { replayed, measured };
}

/** The largest component difference between two boxes, in mm. */
function maxBoxDiff(
  a: readonly [number, number, number, number, number, number],
  b: readonly [number, number, number, number, number, number],
): number {
  let most = 0;
  for (let i = 0; i < 6; i++) most = Math.max(most, Math.abs((a[i] as number) - (b[i] as number)));
  return most;
}

/** The intersection-over-union volume of two boxes. */
function boxIoU(
  a: readonly [number, number, number, number, number, number],
  b: readonly [number, number, number, number, number, number],
): number {
  let inter = 1;
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(a[i] as number, b[i] as number);
    const hi = Math.min(a[i + 3] as number, b[i + 3] as number);
    inter *= Math.max(0, hi - lo);
  }
  if (inter <= 0) return 0;
  const vol = (x: readonly [number, number, number, number, number, number]) =>
    Math.max(0, (x[3] as number) - (x[0] as number)) *
    Math.max(0, (x[4] as number) - (x[1] as number)) *
    Math.max(0, (x[5] as number) - (x[2] as number));
  const union = vol(a) + vol(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Pairs the measured replayed bodies with the measured file bodies by geometry
 * (volume and box), then decides each file body's outcome:
 *
 * - matched → **editable** (the replayed body stays; the file's name goes on it).
 * - written and probe-imported but unpaired → **frozen**; its counterpart (the
 *   creator hint if that body is unpaired, else the unpaired body whose box
 *   overlaps it most, IoU ≥ {@link IOU_MIN}) is taken out.
 * - not written, or the probe failed → **unchecked** (nothing changes).
 * - an unchecked body with no unpaired replayed body left for it → **missing**.
 *
 * Leftover unpaired replayed bodies are taken out too only when every visible
 * file body was checked. The 25 MB / 100 MB attachment limits turn
 * a frozen body into an unchecked one ("too large to keep with the design"), in
 * file order.
 */
export function planBodies(measures: BodyMeasures): BodyPlan {
  const { replayed, file } = measures;
  const matched: BodyPlan['matched'] = [];
  const frozen: BodyPlan['frozen'] = [];
  const status = new Map<number, PlannedBody['outcome']>();
  const reason = new Map<number, string>();
  const detail = new Map<number, string>();

  // Pair each measured file body (file order) with the closest unpaired replayed
  // body within both tolerances (greedy; the tolerances make a wrong pair a
  // coincident copy, which is interchangeable anyway).
  const pairedR = new Set<BodyId>();
  for (const f of file) {
    const fm = f.measure;
    if (!fm || fm.volume <= 0) continue;
    let best: ReplayedBody | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const r of replayed) {
      if (pairedR.has(r.id)) continue;
      const dv = Math.abs(r.measure.volume - fm.volume) / fm.volume;
      if (dv > VOLUME_TOLERANCE) continue;
      const db = maxBoxDiff(r.measure.box, fm.box);
      if (db > BOX_TOLERANCE) continue;
      const s = dv / VOLUME_TOLERANCE + db / BOX_TOLERANCE;
      if (s >= bestScore) continue;
      bestScore = s;
      best = r;
    }
    if (!best) continue;
    pairedR.add(best.id);
    status.set(f.record, 'editable');
    matched.push({ body: best.id, record: f.record, name: f.name, component: f.component });
    const dv = Math.abs(best.measure.volume - fm.volume) / fm.volume;
    detail.set(
      f.record,
      `dv ${(dv * 100).toFixed(3)}%, db ${maxBoxDiff(best.measure.box, fm.box).toFixed(4)} mm`,
    );
  }

  // The measured but unpaired bodies: frozen, unless an attachment limit stops
  // them, in which case they stay unchecked.
  const counterpartUsed = new Set<BodyId>();
  let total = 0;
  for (const f of file) {
    const fm = f.measure;
    if (!fm || fm.volume <= 0 || status.get(f.record) === 'editable') continue;
    const size = f.size ?? 0;
    if (size > MAX_ATTACHMENT_BYTES || total + size > MAX_ATTACHMENTS_BYTES) {
      status.set(f.record, 'unchecked');
      reason.set(f.record, 'too large to keep with the design');
      continue;
    }
    total += size;
    const counterpart = counterpartOf(f, replayed, pairedR, counterpartUsed);
    if (counterpart) counterpartUsed.add(counterpart);
    status.set(f.record, 'frozen');
    reason.set(
      f.record,
      counterpart ? 'the timeline made it differently' : "the timeline didn't make it",
    );
    frozen.push({
      record: f.record,
      name: f.name,
      ...(f.component !== undefined ? { component: f.component } : {}),
      ...(counterpart ? { counterpart } : {}),
    });
  }

  // Leftover unpaired replayed bodies: taken out too only when nothing is
  // unchecked. With unchecked bodies, some leftovers may be their
  // replay, so they are kept; the unchecked bodies the leftovers can't explain
  // are missing (count only).
  const leftovers = replayed.filter((r) => !pairedR.has(r.id) && !counterpartUsed.has(r.id));
  const remove: BodyId[] = [];
  for (const f of frozen) if (f.counterpart) remove.push(f.counterpart);
  const unexplained = file.filter((f) => !f.measure && status.get(f.record) === undefined).length;
  if (unexplained === 0) for (const r of leftovers) remove.push(r.id);
  const missingCount = Math.max(0, unexplained - leftovers.length);
  let seen = 0;
  for (const f of file) {
    if (f.measure || status.get(f.record) !== undefined) continue;
    const missing = seen++ < missingCount;
    status.set(f.record, missing ? 'missing' : 'unchecked');
    if (missing) reason.set(f.record, "the timeline didn't make it");
    if (f.unchecked !== undefined) detail.set(f.record, f.unchecked);
  }

  const outcomes: PlannedBody[] = file.map((f) => ({
    record: f.record,
    name: f.name,
    ...(f.component !== undefined ? { component: f.component } : {}),
    outcome: status.get(f.record) ?? 'unchecked',
    ...(reason.has(f.record) ? { reason: reason.get(f.record) } : {}),
    ...(detail.has(f.record) ? { detail: detail.get(f.record) } : {}),
  }));
  return { matched, frozen, remove: [...new Set(remove)], outcomes };
}

/** The counterpart (the body to take out) of an unpaired file body. */
function counterpartOf(
  f: FileBody,
  replayed: readonly ReplayedBody[],
  pairedR: Set<BodyId>,
  used: Set<BodyId>,
): BodyId | undefined {
  if (!f.measure) return undefined;
  // The creator hint first, when that body is unpaired and not already a counterpart.
  if (
    f.hint !== undefined &&
    !pairedR.has(f.hint) &&
    !used.has(f.hint) &&
    replayed.some((r) => r.id === f.hint)
  ) {
    return f.hint;
  }
  let best: ReplayedBody | undefined;
  let bestIoU = -1;
  for (const r of replayed) {
    if (pairedR.has(r.id) || used.has(r.id)) continue;
    const iou = boxIoU(r.measure.box, f.measure.box);
    if (iou >= IOU_MIN && iou > bestIoU) {
      bestIoU = iou;
      best = r;
    }
  }
  return best?.id;
}

/**
 * Applies a plan to the design, as one undo step: the Remove first (so its
 * bodies are named by the timeline as it stands), then one frozen import per
 * body in file order (its own attachment record, named "Import Body<n>",
 * stamped with the file body's component), then the file's name on every
 * matched body. The marker is not moved (the features go at its end).
 */
export function applyBodyPlan(design: Design, plan: BodyPlan, steps: readonly BodyStep[]): void {
  const byRecord = new Map(steps.map((s) => [s.record, s]));
  design.transaction('Bring in the file bodies', () => {
    if (plan.remove.length > 0) {
      design.add(
        'remove',
        { bodies: plan.remove.map((id) => ({ kind: 'body', id })) },
        { name: REMOVE_NAME },
      );
    }
    const byHash = new Map<string, AttachmentId>();
    for (const f of plan.frozen) {
      const step = byRecord.get(f.record);
      if (step?.step === undefined) continue;
      const bytes = new TextEncoder().encode(step.step);
      if (bytes.length > MAX_ATTACHMENT_BYTES) continue;
      const sha256 = sha256Hex(bytes);
      let attachment = byHash.get(sha256);
      if (attachment === undefined) {
        const stored = Object.entries(design.doc.attachments ?? {}).find(
          ([, a]) => a.sha256 === sha256,
        );
        if (stored) {
          attachment = stored[0] as AttachmentId;
        } else {
          attachment = newId<AttachmentId>();
          design.state.dispatch(
            addAttachment({
              id: attachment,
              attachment: {
                name: f.name,
                fileName: `${f.name}.step`,
                mediaType: 'model/step',
                sha256,
                size: bytes.length,
              },
            }),
          );
        }
        byHash.set(sha256, attachment);
      }
      const feature = design.add('import', importInputs({ file: attachment, up: 'z' }), {
        name: `Import ${f.name}`,
        ...(f.component !== undefined ? { component: f.component } : {}),
      });
      design.state.dispatch(
        updateBody({
          id: `${feature.id}:0` as BodyId,
          changes: {
            name: f.name,
            ...(f.component !== undefined ? { component: f.component } : {}),
          },
        }),
      );
    }
    for (const m of plan.matched) {
      // Set the file body's component too: a replayed body with no metadata of
      // its own takes its component from the feature that made it (`origins`),
      // and writing `name` alone would store a fresh, loose `{ name, visible:
      // true }` record and lose that (a hidden component's body would show).
      design.state.dispatch(
        updateBody({
          id: m.body,
          changes: {
            name: m.name,
            ...(m.component !== undefined ? { component: m.component } : {}),
          },
        }),
      );
    }
  });
}

/**
 * The STEP bytes of a design's body attachments, by attachment ID, for a
 * kernel's `FileSource` — what a frozen body's `import` reads. Built from the
 * writer's steps (their SHA-256 is how `applyBodyPlan` named them).
 */
export function bodyFiles(
  design: Design,
  steps: readonly BodyStep[],
): Map<AttachmentId, Uint8Array> {
  const byHash = new Map<string, Uint8Array>();
  for (const step of steps) {
    if (step.step === undefined) continue;
    const bytes = new TextEncoder().encode(step.step);
    byHash.set(sha256Hex(bytes), bytes);
  }
  const files = new Map<AttachmentId, Uint8Array>();
  for (const [id, attachment] of Object.entries(design.doc.attachments ?? {})) {
    const bytes = byHash.get(attachment.sha256);
    if (bytes) files.set(id as AttachmentId, bytes);
  }
  return files;
}

/**
 * The plan's outcomes as the report's, with each component ID
 * resolved to its name so repeated names across components can be told apart.
 */
export function bodyOutcomes(plan: BodyPlan, design: Design): BodyOutcome[] {
  const nameOf = new Map((design.doc.components ?? []).map((c) => [c.id, c.name]));
  return plan.outcomes.map((o) => ({
    name: o.name,
    ...(o.component !== undefined
      ? { component: nameOf.get(o.component) ?? String(o.component) }
      : {}),
    outcome: o.outcome,
    ...(o.reason !== undefined ? { reason: o.reason } : {}),
    ...(o.detail !== undefined ? { detail: o.detail } : {}),
  }));
}
