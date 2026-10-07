/**
 * The plugin files a design carries, read once each (P6-03 slice 3, ADR-0077
 * §6): what a stored `plugin` feature's dialog is generated from, so a chip
 * opens it even where the plugin isn't installed. The map is read
 * synchronously by the dialog controller; `files` is a new map each time one is read.
 */
import { type AttachmentId, type DocumentStore, pluginFileOf } from '@extrudo/core';
import { type PluginFile, readPluginFile } from '@extrudo/storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { attachmentBytes } from '../sketch/fonts';

export function useDesignPluginFiles(store: DocumentStore): {
  files: ReadonlyMap<AttachmentId, PluginFile>;
  version: number;
} {
  const files = useRef(new Map<AttachmentId, PluginFile>());
  const asked = useRef(new Set<AttachmentId>());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const read = () => {
      for (const feature of store.getState().doc.features) {
        const id = pluginFileOf(feature);
        if (!id || asked.current.has(id)) continue;
        asked.current.add(id);
        void attachmentBytes(id).then((data) => {
          if (!data) return;
          try {
            files.current.set(id, readPluginFile(new Uint8Array(data)));
            setVersion((v) => v + 1);
          } catch {
            // The feature itself reports an unreadable file.
          }
        });
      }
    };
    read();
    return store.subscribe(read);
  }, [store]);
  // A new map each time one is read, so what depends on it follows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is that signal.
  const snapshot = useMemo(() => new Map(files.current), [version]);
  return { files: snapshot, version };
}
