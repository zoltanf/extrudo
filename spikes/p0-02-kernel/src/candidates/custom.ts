// Candidate A': our own trimmed libcascade build (custom-build/, 126 bindings),
// running the same raw OCCT scenario as libcascade.ts.

import { createInstance } from '../../custom-build/dist/init.js';
import type { LoadResult } from '../shared/types.ts';
import { runRaw } from './raw-occt.ts';

// biome-ignore lint/suspicious/noExplicitAny: generated types of the custom build
let oc: any;

export async function load(wasmUrl?: string): Promise<LoadResult> {
  const t = performance.now();
  oc = await createInstance(wasmUrl ? { locateFile: () => wasmUrl } : {});
  return { candidate: 'custom', initMs: performance.now() - t, heapBytes: heapBytes() };
}

export function heapBytes(): number {
  return oc.wasmMemory.buffer.byteLength;
}

export function run() {
  if (!oc) throw new Error('not loaded');
  return runRaw(oc, 'custom', 'raw OCCT (own trimmed libcascade build)');
}

export function instance() {
  return oc;
}
