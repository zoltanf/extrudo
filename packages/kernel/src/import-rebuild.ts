/**
 * An import's "rebuild the design so far and measure it" (P6-25 S5, ADR-0144
 * decision 3) over any `KernelApi`: the app's nested import kernel worker and
 * a kernel in Node (tests, the CLI) share this one implementation.
 *
 * What it keeps per kernel instance, so what crosses to the kernel stays
 * bounded as the import grows: the attachments already sent (each file goes
 * once) and the body versions of the last recompute, passed back as `have`
 * so a rebuild meshes only the bodies the newest feature changed. A new
 * kernel (after a restart) needs a new `importRebuilder`.
 */
import type { AttachmentId, BodyId, ExtrudoDocument } from '@extrudo/core';
import type { KernelApi } from './service';
import type { StoredShapeMeasure } from './stored-shape';

/** What one rebuild found: every body at the end of the timeline, and what failed. */
export interface ImportRebuild {
  /** Every body at the end of the timeline, in creation order. */
  ids: string[];
  /** The bodies measured: all of `ids` but the `skip`ped ones. */
  bodies: Record<string, StoredShapeMeasure>;
  /** The features whose status is an error, with the kernel's message. */
  failed: { feature: string; message: string }[];
}

export interface ImportRebuilder {
  /**
   * Recomputes `doc` and measures its bodies, leaving out `skip` (bodies the
   * caller has settled already: measuring them again would only cost time).
   * Throws when the kernel fails or a newer request cancelled the recompute.
   */
  rebuild(
    doc: ExtrudoDocument,
    files: ReadonlyMap<AttachmentId, Uint8Array>,
    skip?: readonly string[],
  ): Promise<ImportRebuild>;
}

export function importRebuilder(
  api: Pick<KernelApi, 'addFile' | 'recompute' | 'measureBodies'>,
): ImportRebuilder {
  const sent = new Set<AttachmentId>();
  let have: Record<BodyId, string> = {};
  return {
    async rebuild(doc, files, skip = []) {
      for (const [id, bytes] of files) {
        if (sent.has(id)) continue;
        const attachment = doc.attachments?.[id];
        if (!attachment) continue;
        const copy = bytes.slice().buffer as ArrayBuffer;
        await api.addFile(id, copy, attachment.mediaType, attachment.fileName);
        sent.add(id);
      }
      const result = await api.recompute({ doc, have });
      if (result.status !== 'done') throw new Error('the rebuild was cancelled');
      have = Object.fromEntries(result.bodies.map((b) => [b.id, b.version])) as Record<
        BodyId,
        string
      >;
      const ids = result.bodies.map((b) => b.id as string);
      const left = new Set(skip);
      const measured = ids.filter((id) => !left.has(id)) as BodyId[];
      const bodies = measured.length > 0 ? await api.measureBodies(measured) : {};
      const failed = Object.entries(result.features)
        .filter(([, status]) => status.status === 'error')
        .map(([feature, status]) => ({ feature, message: status.message ?? 'it failed' }));
      return { ids, bodies, failed };
    },
  };
}
