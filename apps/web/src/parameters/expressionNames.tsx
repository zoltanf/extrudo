import { type DocumentStore, evaluateParameters, formatQuantity } from '@extrudo/core';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { NameEntry } from './completion';

/**
 * The open document's parameter names for completion (ADR-0096). A getter, so
 * nothing is evaluated until a list opens and a document edit re-renders no
 * field. Without a provider (the home screen) there are none.
 */
const ExpressionNames = createContext<() => readonly NameEntry[]>(() => []);

export function useExpressionNames(): () => readonly NameEntry[] {
  return useContext(ExpressionNames);
}

/** Every parameter of `store`'s document, in document order, with its value. */
export function ExpressionNamesProvider({
  store,
  children,
}: {
  store: DocumentStore;
  children: ReactNode;
}) {
  const names = useMemo(() => {
    let cached: { doc: unknown; entries: NameEntry[] } | undefined;
    return () => {
      const doc = store.getState().doc;
      if (cached?.doc !== doc) {
        const entries = [...evaluateParameters(doc).parameters.values()].map(({ name, result }) =>
          result.ok
            ? { name, value: formatQuantity(result.value, result.dim, doc.settings) }
            : { name },
        );
        cached = { doc, entries };
      }
      return cached.entries;
    };
  }, [store]);
  return <ExpressionNames.Provider value={names}>{children}</ExpressionNames.Provider>;
}
