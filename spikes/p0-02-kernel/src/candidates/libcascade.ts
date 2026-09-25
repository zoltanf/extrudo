// Candidate A: raw libcascade (OCCT 8.0.1, full prebuilt single-threaded build).

import type { OpenCascadeInstance } from 'libcascade';
import { createInstance } from 'libcascade/single/init';
import type { LoadResult } from '../shared/types.ts';
import { runRaw } from './raw-occt.ts';

let oc: OpenCascadeInstance | undefined;

export async function load(wasmUrl?: string): Promise<LoadResult> {
  const t = performance.now();
  oc = await createInstance(wasmUrl ? { locateFile: () => wasmUrl } : {});
  return { candidate: 'libcascade', initMs: performance.now() - t, heapBytes: heapBytes() };
}

export function heapBytes(): number {
  // biome-ignore lint/suspicious/noExplicitAny: wasmMemory is not in the published types
  return (oc as any).wasmMemory.buffer.byteLength;
}

export function run() {
  if (!oc) throw new Error('not loaded');
  return runRaw(oc, 'libcascade', 'raw OCCT (libcascade)');
}

export function instance() {
  if (!oc) throw new Error('not loaded');
  return oc;
}
