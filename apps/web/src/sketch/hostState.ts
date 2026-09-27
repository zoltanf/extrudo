import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ToolHost, ToolHostState } from './tools/host';

const NONE = createStore<ToolHostState | undefined>(() => undefined);

/**
 * Reads the tool host's state from components in the main chunk, where the
 * host (a lazy chunk, ADR-0014) may not have loaded yet: undefined until it has.
 */
export function useHostState<T>(
  host: ToolHost | undefined,
  select: (state: ToolHostState) => T,
): T | undefined {
  const store = (host?.state ?? NONE) as StoreApi<ToolHostState | undefined>;
  return useStore(store, (s) => (s ? select(s) : undefined));
}
