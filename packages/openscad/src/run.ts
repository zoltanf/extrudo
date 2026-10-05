/**
 * One compile, inside the compiler's worker (ADR-0071 §3): a fresh OpenSCAD
 * instance from the already compiled WASM, the file written into its memory
 * file system, `callMain` once for the customizer list (when asked) and once
 * for the model. The instance is dropped afterwards, so nothing of one file
 * reaches the next and its whole heap goes with it.
 *
 * Imports nothing at run time: Node runs this file as it is in a
 * `worker_threads` worker, which resolves no extensionless import.
 */
import type { ScadDefine, ScadRequest } from './index.ts';

/** The glue's factory (`dist/openscad.js`'s default export), as far as we use it. */
export type OpenscadFactory = (options: Record<string, unknown>) => Promise<OpenscadModule>;

interface OpenscadModule {
  callMain(args: string[]): number;
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array | string): void;
    readFile(path: string): Uint8Array;
  };
}

/** What a run gives back, before it is worded (`messages.ts`). */
export interface RawRun {
  /** `main`'s exit code; absent when the run trapped. */
  code?: number;
  /** Everything OpenSCAD printed for the model, in order (stdout and stderr). */
  lines: string[];
  /** The 3MF, when OpenSCAD wrote one. */
  model?: Uint8Array;
  /** The customizer list's JSON, when asked for and OpenSCAD wrote one. */
  parameters?: string;
  /** The trap's message, when the WASM trapped (out of memory, a crash). */
  trap?: string;
  /** The WASM heap at the end, in bytes. */
  heapBytes: number;
  /** The compile's own time (instance and runs), in ms. */
  ms: number;
}

const WORK = '/work';

/** The file's path inside OpenSCAD: its own name, made safe for a path. */
export function scadPath(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() || 'model.scad';
  return `${WORK}/${base.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/** An override as OpenSCAD's `-D` takes it. */
export function defineArgument(define: ScadDefine): string {
  return `${define.name}=${String(define.value)}`;
}

export async function runOpenscad(
  factory: OpenscadFactory,
  wasm: WebAssembly.Module,
  request: ScadRequest,
  heapMaxBytes: number,
): Promise<RawRun> {
  const start = performance.now();
  const lines: string[] = [];
  let memory: WebAssembly.Memory | undefined;
  const heapBytes = () => memory?.buffer.byteLength ?? 0;
  let module: OpenscadModule;
  try {
    module = await factory({
      noInitialRun: true,
      // Two `callMain`s on one instance: `main` returning must not end it.
      noExitRuntime: true,
      // The glue's heap limit, patched to read this (openscad.mjs).
      heapMax: heapMaxBytes,
      print: (line: string) => lines.push(line),
      printErr: (line: string) => lines.push(line),
      instantiateWasm(
        imports: WebAssembly.Imports,
        receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
      ) {
        void WebAssembly.instantiate(wasm, imports).then((instance) => {
          memory = Object.values(instance.exports).find(
            (value): value is WebAssembly.Memory => value instanceof WebAssembly.Memory,
          );
          receive(instance, wasm);
        });
        return {};
      },
    });
  } catch (error) {
    return { lines, trap: message(error), heapBytes: heapBytes(), ms: performance.now() - start };
  }
  const path = scadPath(request.fileName);
  let parameters: string | undefined;
  try {
    module.FS.mkdirTree(WORK);
    module.FS.writeFile(path, request.source);
    if (request.parameters) {
      const out = `${WORK}/out.param`;
      if (module.callMain([path, '-o', out, '--export-format=param']) === 0) {
        parameters = new TextDecoder().decode(module.FS.readFile(out));
      }
      // The model's log is what the user reads; the list's run says the same.
      lines.length = 0;
    }
    const out = `${WORK}/out.3mf`;
    const args = [path, '-o', out, '--backend=manifold'];
    for (const define of request.defines ?? []) args.push('-D', defineArgument(define));
    const code = module.callMain(args);
    let model: Uint8Array | undefined;
    try {
      model = module.FS.readFile(out);
    } catch {
      model = undefined;
    }
    return {
      code,
      lines,
      ...(model && code === 0 && { model }),
      ...(parameters !== undefined && { parameters }),
      heapBytes: heapBytes(),
      ms: performance.now() - start,
    };
  } catch (error) {
    return {
      lines,
      ...(parameters !== undefined && { parameters }),
      trap: message(error),
      heapBytes: heapBytes(),
      ms: performance.now() - start,
    };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
