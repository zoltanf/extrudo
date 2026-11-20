/**
 * The body check hashes each written body once (ADR-0083, amendment of
 * 2026-11-20): `importF3d` encodes and hashes a body in its worker, and the
 * probe, the plan and the files to store take that. Counts the hashing, not
 * the clock.
 */
import { Design } from '@extrudo/api';
import * as storage from '@extrudo/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyBodyPlan,
  type BodyPlan,
  bodyFiles,
  fileBodies,
  probeDocument,
  stepFile,
  withStepFiles,
} from './body-check';
import type { BodyStep } from './brep-step';

vi.mock('@extrudo/storage', async (original) => {
  const real = await original<typeof import('@extrudo/storage')>();
  return { ...real, sha256Hex: vi.fn(real.sha256Hex) };
});
const hashes = vi.mocked(storage.sha256Hex);

/** `n` written bodies (and one the writer could not write). */
function steps(n: number): BodyStep[] {
  const out: BodyStep[] = [{ record: 0, name: 'Body0', reason: 'no stream' }];
  for (let i = 1; i <= n; i++)
    out.push({ record: i, name: `Body${i}`, step: `ISO-10303-21;#${i}` });
  return out;
}

/** The app's steps after the check: probe, file bodies, every body frozen, the files to store. */
function check(written: readonly BodyStep[]) {
  const design = Design.create({ name: 'T' });
  const probe = probeDocument(design, written);
  const measured = new Map(
    probe.bodies.map((b) => [b.record, { volume: 1, box: [0, 0, 0, 1, 1, 1] as const }]),
  );
  const file = fileBodies(written, [], measured);
  const plan: BodyPlan = {
    matched: [],
    frozen: written
      .filter((s) => s.step !== undefined)
      .map(({ record, name }) => ({ record, name })),
    remove: [],
    outcomes: [],
  };
  applyBodyPlan(design, plan, written);
  return { design, probe, file, files: bodyFiles(design, written) };
}

beforeEach(() => {
  hashes.mockClear();
});

describe('one hash per written body', () => {
  it('hashes nothing on the page when the steps carry their bytes and hash', () => {
    const prepared = withStepFiles(steps(5));
    expect(hashes).toHaveBeenCalledTimes(5);
    hashes.mockClear();
    const { design, probe, file, files } = check(prepared);
    expect(hashes).not.toHaveBeenCalled();
    // The probe, the plan and the stored files all name the same bytes.
    expect(probe.bodies).toHaveLength(5);
    expect(file.filter((f) => f.size !== undefined)).toHaveLength(5);
    expect(Object.keys(design.doc.attachments ?? {})).toHaveLength(5);
    for (const [id, bytes] of files) {
      const record = design.doc.attachments?.[id];
      expect(record?.sha256).toBe(storage.sha256Hex(bytes));
      expect(record?.size).toBe(bytes.length);
    }
  });

  it('hashes each body once when the steps come without them', () => {
    check(steps(4));
    expect(hashes).toHaveBeenCalledTimes(4);
  });

  it('gives the bytes and hash of the text as stored', () => {
    const [, step] = withStepFiles(steps(1));
    const text = 'ISO-10303-21;#1';
    expect(step?.bytes).toEqual(new TextEncoder().encode(text));
    expect(step?.sha256).toBe(storage.sha256Hex(new TextEncoder().encode(text)));
    expect(stepFile({ record: 0, name: 'Body0', reason: 'no stream' })).toBeUndefined();
  });
});
