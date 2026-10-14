/**
 * The body check: pairing within and outside each
 * tolerance, counterparts, leftovers, outcomes, the attachment limits, and the
 * plan applied to a `Design`. Pure, no kernel and no samples.
 */
import { Design } from '@extrudo/api';
import { type BodyId, type ComponentId, updateBody } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  applyBodyPlan,
  type BodyMeasure,
  type BodyPlan,
  bodyOutcomes,
  type FileBody,
  fileBodies,
  INWARD_REASON,
  measureProbe,
  planBodies,
  probeDocument,
  REMOVE_NAME,
  VOLUME_TOLERANCE,
} from './body-check';
import type { BodyStep } from './brep-step';
import type { BodyLink } from './map';

const bid = (s: string) => s as BodyId;
const cid = (s: string) => s as ComponentId;

/** A box measure: volume and [xmin, ymin, zmin, xmax, ymax, zmax]. */
const box = (x: number, size: number): BodyMeasure => ({
  volume: size ** 3,
  box: [x, x, x, x + size, x + size, x + size],
});

const file = (record: number, measure: BodyMeasure | undefined, extra: Partial<FileBody> = {}) => ({
  record,
  name: `Body${record}`,
  ...extra,
  ...(measure ? { measure } : { unchecked: 'the writer could not write it' }),
});

describe('planBodies: pairing', () => {
  it('pairs inside both tolerances and not outside either', () => {
    const one = box(0, 10);
    // Volume 0.5 % over is within; the same box within 0.05 mm is within.
    const within: BodyMeasure = { volume: one.volume * (1 + VOLUME_TOLERANCE), box: one.box };
    expect(
      planBodies({ replayed: [{ id: bid('r1'), measure: one }], file: [file(1, within)] }).matched,
    ).toHaveLength(1);
    const overVolume: BodyMeasure = { volume: one.volume * 1.006, box: one.box };
    expect(
      planBodies({ replayed: [{ id: bid('r1'), measure: one }], file: [file(1, overVolume)] })
        .matched,
    ).toHaveLength(0);
    const overBox: BodyMeasure = {
      volume: one.volume,
      box: [0.06, 0, 0, 10.06, 10, 10],
    };
    expect(
      planBodies({ replayed: [{ id: bid('r1'), measure: one }], file: [file(1, overBox)] }).matched,
    ).toHaveLength(0);
  });

  it('pairs coincident duplicates one-to-one', () => {
    const one = box(0, 10);
    const plan = planBodies({
      replayed: [
        { id: bid('r1'), measure: one },
        { id: bid('r2'), measure: one },
      ],
      file: [file(1, one), file(2, one)],
    });
    expect(new Set(plan.matched.map((m) => m.body))).toEqual(new Set([bid('r1'), bid('r2')]));
    expect(plan.matched).toHaveLength(2);
  });
});

describe('planBodies: counterparts and leftovers', () => {
  it('uses the creator hint as the counterpart of an unpaired body', () => {
    const plan = planBodies({
      replayed: [
        { id: bid('r1'), measure: box(0, 10) },
        { id: bid('r2'), measure: box(100, 10) },
      ],
      file: [file(1, box(0, 10)), file(2, box(50, 10), { hint: bid('r2') })],
    });
    // Body1 pairs with r1; Body2 is unmatched, and its hint r2 (unpaired) is taken out.
    expect(plan.matched[0]?.body).toBe(bid('r1'));
    expect(plan.frozen[0]?.counterpart).toBe(bid('r2'));
    expect(plan.remove).toEqual([bid('r2')]);
  });

  it('falls back to the box overlap (IoU) when there is no hint', () => {
    const plan = planBodies({
      replayed: [
        { id: bid('r1'), measure: { volume: 10, box: [0, 0, 0, 10, 1, 1] } },
        { id: bid('r2'), measure: { volume: 10, box: [100, 100, 100, 110, 101, 101] } },
      ],
      file: [file(1, { volume: 12, box: [0, 0, 0, 12, 1, 1] })],
    });
    // Both are outside tolerance; r1 overlaps most (IoU 10/12 ≈ 0.83 ≥ 0.5).
    expect(plan.frozen[0]?.counterpart).toBe(bid('r1'));
  });

  it('takes leftover replayed bodies out only when nothing is unchecked', () => {
    const measure = box(0, 10);
    const withUnchecked = planBodies({
      replayed: [
        { id: bid('r1'), measure },
        { id: bid('r2'), measure: box(50, 10) },
      ],
      file: [file(1, measure), file(2, undefined)],
    });
    // r1 matched; r2 is a leftover, but a file body is unchecked, so it stays.
    expect(withUnchecked.remove).toEqual([]);
    const allChecked = planBodies({
      replayed: [
        { id: bid('r1'), measure },
        { id: bid('r2'), measure: box(50, 10) },
      ],
      file: [file(1, measure)],
    });
    expect(allChecked.remove).toEqual([bid('r2')]);
  });
});

describe('planBodies: outcomes and limits', () => {
  it('marks an unchecked file body missing when no replayed body is left for it', () => {
    const plan = planBodies({
      replayed: [],
      file: [file(1, undefined)],
    });
    expect(plan.outcomes[0]).toMatchObject({ record: 1, outcome: 'missing' });
  });

  it('keeps a body over the attachment limit unchecked, not missing', () => {
    const plan = planBodies({
      replayed: [],
      file: [file(1, box(0, 10), { size: 26 * 1024 * 1024 })],
    });
    expect(plan.outcomes[0]).toMatchObject({ record: 1, outcome: 'unchecked' });
    expect(plan.frozen).toEqual([]);
  });

  it('keeps both file names of repeated names across components', () => {
    const plan = planBodies({
      replayed: [],
      file: [
        file(1, box(0, 10), { component: cid('c1') }),
        file(2, box(100, 10), { component: cid('c2') }),
      ],
    });
    expect(plan.outcomes.map((o) => [o.name, o.component])).toEqual([
      ['Body1', 'c1'],
      ['Body2', 'c2'],
    ]);
  });

  it('resolves component names for the report', () => {
    const design = Design.create({ name: 'T' });
    const lid = design.component('Lid');
    design.component('Base');
    const plan: BodyPlan = {
      matched: [],
      frozen: [],
      remove: [],
      outcomes: [{ record: 1, name: 'Body3', component: lid.id, outcome: 'frozen' }],
    };
    const outcomes = bodyOutcomes(plan, design);
    expect(outcomes[0]?.component).toBe('Lid');
  });
});

describe('fileBodies', () => {
  it('turns a failed or empty probe measure into unchecked', () => {
    const steps: BodyStep[] = [
      { record: 1, name: 'Body1', step: 'a' },
      { record: 2, name: 'Body2', step: 'bb' },
      { record: 3, name: 'Body3', reason: 'unsupported geometry (spline-surface)' },
    ];
    const links: BodyLink[] = [
      { record: 1, name: 'Body1', hint: bid('r1') },
      { record: 2, name: 'Body2' },
    ];
    const measured = new Map<number, BodyMeasure | { error: string }>([
      [1, { error: 'readStep failed' }],
      [2, { volume: 0, box: [0, 0, 0, 0, 0, 0] }],
    ]);
    const bodies = fileBodies(steps, links, measured);
    expect(bodies[0]).toMatchObject({ record: 1, unchecked: 'readStep failed', hint: bid('r1') });
    expect(bodies[1]).toMatchObject({ record: 2, unchecked: 'the probe made no solid for it' });
    expect(bodies[2]).toMatchObject({
      record: 3,
      unchecked: 'unsupported geometry (spline-surface)',
    });
    expect(bodies[0]?.size).toBe(1);
    expect(bodies[1]?.size).toBe(2);
  });

  it('leaves a written body with an inward-signed surface unchecked, measure or not', () => {
    const steps: BodyStep[] = [
      { record: 1, name: 'Body1', step: 'a', inward: true },
      { record: 2, name: 'Body2', step: 'bb', inward: true },
    ];
    const links: BodyLink[] = [
      { record: 1, name: 'Body1', hint: bid('r1') },
      { record: 2, name: 'Body2' },
    ];
    const measured = new Map<number, BodyMeasure | { error: string }>([
      [1, { volume: 1255, box: [0, 0, 0, 1, 1, 1] }],
    ]);
    const bodies = fileBodies(steps, links, measured);
    expect(bodies[0]).toMatchObject({ record: 1, unchecked: INWARD_REASON, hint: bid('r1') });
    expect(bodies[0]?.measure).toBeUndefined();
    expect(bodies[1]).toMatchObject({ record: 2, unchecked: INWARD_REASON });
  });
});

describe('probeDocument', () => {
  it('adds one attachment record and one import per written body, files included', () => {
    const replay = Design.create({ name: 'T' });
    const steps: BodyStep[] = [
      { record: 1, name: 'Body1', step: 'ISO-10303-21;\nA;' },
      { record: 2, name: 'Body2', reason: 'no stream' },
    ];
    const probe = probeDocument(replay, steps);
    expect(probe.bodies).toHaveLength(1);
    expect(probe.bodies[0]?.record).toBe(1);
    const attachments = Object.values(probe.design.doc.attachments ?? {});
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ name: 'Body1', mediaType: 'model/step' });
    expect(probe.files.size).toBe(1);
    // The probe import is in the probe design and nothing leaked into the replay.
    expect(probe.design.doc.features.map((f) => f.type)).toEqual(['import']);
    expect(replay.doc.features).toEqual([]);
  });

  it('skips a written body with an inward-signed surface', () => {
    const replay = Design.create({ name: 'T' });
    const steps: BodyStep[] = [
      { record: 1, name: 'Body1', step: 'ISO-10303-21;\nA;' },
      { record: 2, name: 'Body2', step: 'ISO-10303-21;\nB;', inward: true },
    ];
    const probe = probeDocument(replay, steps);
    expect(probe.bodies).toHaveLength(1);
    expect(probe.bodies[0]?.record).toBe(1);
    expect(probe.files.size).toBe(1);
  });
});

describe('measureProbe', () => {
  it('measures shown replayed bodies and each clean probe import, and says why the rest are not', async () => {
    const replay = Design.create({ name: 'T' });
    replay.state.dispatch(
      updateBody({ id: bid('hidden:0'), changes: { name: 'Hidden', visible: false } }),
    );
    const steps: BodyStep[] = [
      { record: 1, name: 'Body1', step: 'ONE' },
      { record: 2, name: 'Body2', step: 'TWO' },
      { record: 3, name: 'Body3', step: 'THREE' },
    ];
    const probe = probeDocument(replay, steps);
    const [one, two, three] = probe.bodies.map((b) => b.feature);
    const asked: BodyId[] = [];
    const { replayed, measured } = await measureProbe(
      probe,
      {
        features: {
          [one as string]: { status: 'ok' },
          [two as string]: { status: 'error', message: 'unreadable STEP' },
          [three as string]: { status: 'ok' },
        },
        bodies: [bid('shown:0'), bid('hidden:0'), bid(`${one}:0`)],
      },
      async (body) => {
        asked.push(body);
        return box(0, 10);
      },
    );
    expect(replayed.map((r) => r.id)).toEqual([bid('shown:0')]);
    expect(measured.get(1)).toEqual(box(0, 10));
    expect(measured.get(2)).toEqual({ error: 'unreadable STEP' });
    expect(measured.get(3)).toEqual({ error: 'the probe made 0 bodies' });
    expect(asked).toEqual([bid('shown:0'), bid(`${one}:0`)]);
  });
});

describe('applyBodyPlan', () => {
  const steps: BodyStep[] = [
    { record: 1, name: 'Body1', step: 'ONE' },
    { record: 2, name: 'Body2', step: 'TWO' },
  ];

  it('adds the Remove first, one named/stamped import per frozen body, and names matched bodies', () => {
    const design = Design.create({ name: 'T' });
    const lid = design.component('Lid');
    const plan: BodyPlan = {
      matched: [{ body: bid('make:0'), record: 1, name: 'Body1' }],
      frozen: [{ record: 2, name: 'Body2', component: lid.id }],
      remove: [bid('other:0')],
      outcomes: [],
    };
    applyBodyPlan(design, plan, steps);
    const features = design.doc.features;
    expect(features.map((f) => f.name)).toEqual([REMOVE_NAME, 'Import Body2']);
    expect(features[0]?.type).toBe('remove');
    const remove = features[0];
    expect(remove?.inputs.bodies).toMatchObject({ refs: [{ kind: 'body', id: 'other:0' }] });
    const imported = features[1];
    expect(imported?.component).toBe(lid.id);
    // The frozen body is named from metadata.
    const bodyId = `${imported?.id}:0` as BodyId;
    expect(design.doc.bodies[bodyId]?.name).toBe('Body2');
    expect(design.doc.bodies[bodyId]?.component).toBe(lid.id);
    // The matched body is renamed too.
    expect(design.doc.bodies[bid('make:0')]?.name).toBe('Body1');
    // One attachment record per frozen body, content-addressed.
    const attachments = Object.values(design.doc.attachments ?? {});
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: 'Body2',
      fileName: 'Body2.step',
      mediaType: 'model/step',
    });
    expect(attachments[0]?.size).toBe(3);
    expect(design.validate()).toEqual([]);
    // The marker stays at the end (every feature active).
    expect(design.doc.timelineMarker).toBe(design.doc.features.length);
  });

  it('reuses one attachment when two frozen bodies are byte-identical', () => {
    const design = Design.create({ name: 'T' });
    const same: BodyStep[] = [
      { record: 1, name: 'Body1', step: 'SAME' },
      { record: 2, name: 'Body2', step: 'SAME' },
    ];
    applyBodyPlan(
      design,
      {
        matched: [],
        frozen: [
          { record: 1, name: 'Body1' },
          { record: 2, name: 'Body2' },
        ],
        remove: [],
        outcomes: [],
      },
      same,
    );
    expect(Object.keys(design.doc.attachments ?? {})).toHaveLength(1);
    expect(design.doc.features.map((f) => f.name)).toEqual(['Import Body1', 'Import Body2']);
  });

  it('does nothing when the plan is empty', () => {
    const design = Design.create({ name: 'T' });
    applyBodyPlan(design, { matched: [], frozen: [], remove: [], outcomes: [] }, []);
    expect(design.doc.features).toEqual([]);
    expect(design.doc.attachments).toBeUndefined();
  });

  it('keeps a matched body in its component when it is renamed', () => {
    const design = Design.create({ name: 'T' });
    const lid = design.component('Lid');
    design.setComponentBodies(lid.id, [bid('make:0')]);
    applyBodyPlan(
      design,
      {
        matched: [{ body: bid('make:0'), record: 1, name: 'Body1', component: lid.id }],
        frozen: [],
        remove: [],
        outcomes: [],
      },
      steps,
    );
    expect(design.doc.bodies[bid('make:0')]).toMatchObject({ name: 'Body1', component: lid.id });
  });
});
