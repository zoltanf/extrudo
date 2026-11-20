/**
 * The import's rebuilder (ADR-0144 S5, S12b): each attachment is sent once, and a mesh
 * attachment turns the kernel's mesh bodies on, once.
 */
import type { AttachmentId, ExtrudoDocument } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { importRebuilder } from './import-rebuild';

const doc = (mediaType: string) =>
  ({
    features: [],
    bodies: {},
    attachments: {
      a1: { name: 'A', fileName: 'a', mediaType, sha256: 'x', size: 1 },
      a2: { name: 'B', fileName: 'b', mediaType, sha256: 'y', size: 1 },
    },
  }) as unknown as ExtrudoDocument;

function fake() {
  const calls: string[] = [];
  return {
    calls,
    api: {
      addFile: async (id: AttachmentId) => {
        calls.push(`add ${id}`);
      },
      recompute: async () => ({ status: 'done', bodies: [], features: {}, reports: {} }),
      measureBodies: async () => ({}),
      enableMeshes: async () => {
        calls.push('meshes');
      },
    } as never,
  };
}

const files = new Map([
  ['a1' as AttachmentId, new Uint8Array([1])],
  ['a2' as AttachmentId, new Uint8Array([2])],
]);

describe('importRebuilder', () => {
  it('turns mesh bodies on once, for a mesh attachment', async () => {
    const { api, calls } = fake();
    const r = importRebuilder(api);
    await r.rebuild(doc('model/stl'), files);
    await r.rebuild(doc('model/stl'), files);
    expect(calls).toEqual(['add a1', 'meshes', 'add a2']);
  });

  it('leaves them off for STEP', async () => {
    const { api, calls } = fake();
    await importRebuilder(api).rebuild(doc('model/step'), files);
    expect(calls).toEqual(['add a1', 'add a2']);
  });
});
