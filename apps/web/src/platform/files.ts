/**
 * Files the user saves or opens. The web build downloads through a link and
 * picks through a file input; Electron (Phase 6) will use native dialogs.
 */
export interface FileAccess {
  /** Offers a file to the user (a download in the browser). */
  download(file: Blob, name: string): void;
  /** Lets the user pick one file; `undefined` if they cancel. `accept` as for <input>. */
  pick(accept: string): Promise<File | undefined>;
}

/** A file name from a project name: no path separators or control characters. */
export function safeFileName(name: string, extension: string): string {
  const base = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return `${base || 'Untitled'}${extension}`;
}

export function webFiles(): FileAccess {
  return {
    download(file, name) {
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.style.display = 'none';
      document.body.append(link);
      link.click();
      link.remove();
      // Give the download time to start before the URL goes.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    pick(accept) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        const finish = (file: File | undefined) => {
          input.remove();
          resolve(file);
        };
        input.addEventListener('change', () => finish(input.files?.[0]), { once: true });
        input.addEventListener('cancel', () => finish(undefined), { once: true });
        document.body.append(input);
        input.click();
      });
    },
  };
}
