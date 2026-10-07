/**
 * Files the user saves or opens. The web build downloads through a link and
 * picks through a file input; Electron (Phase 6) will use native dialogs.
 */
export interface FileAccess {
  /** Offers a file to the user (a download in the browser). */
  download(file: Blob, name: string): void;
  /** Lets the user pick one file; `undefined` if they cancel. `accept` as for <input>. */
  pick(accept: string): Promise<File | undefined>;
  /**
   * Desktop only (P6-01 slice 2): "Save As…" writes to a path the user chooses
   * and answers where it went, so the design can be linked to that file. The
   * browser has no path to give and leaves this out; the native File menu's
   * Save As… is offered only when it exists.
   */
  saveAs?(file: Blob, name: string): Promise<{ path: string; modified: number } | undefined>;
}

/**
 * A file name from a project name: no path separators or control characters.
 * It is the kernel's (`@extrudo/kernel`), which the export writes names with
 * (ADR-0069).
 */
export { safeFileName } from '@extrudo/kernel';

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
