/**
 * OpenSCAD for the `import` feature (P5-04, ADR-0071): a `.scad` file is
 * compiled to a 3MF by OpenSCAD's own WebAssembly build, in a worker of its
 * own, and the kernel goes on with the mesh (ADR-0066 §3).
 *
 * This entry is the protocol: the types the kernel imports (the compiler
 * itself is `./node` or `./browser`, loaded when a design needs it; the
 * wording of OpenSCAD's log is `messages.ts`, used by both).
 */

// Types and constants only: the kernel's program imports this entry, so it
// carries no runtime code of the compiler with it.

/** One top-level variable a compile overrides: `-D name=value`. */
export interface ScadDefine {
  name: string;
  value: number;
}

/**
 * What an override's name may be: an OpenSCAD identifier, a special variable
 * (`$fn`) included.
 */
export const SCAD_IDENTIFIER = /^\$?[A-Za-z_][A-Za-z0-9_]*$/;

export interface ScadRequest {
  /** The file's own name: messages name it, and OpenSCAD reads it under it. */
  fileName: string;
  /** The `.scad` file's bytes (UTF-8). */
  source: Uint8Array;
  /** Top-level variables to override, in this order. */
  defines?: readonly ScadDefine[];
  /** Also list the file's customizer variables (`--export-format=param`). */
  parameters?: boolean;
  /**
   * Compile the model (default). `false` only lists the customizer variables
   * (`ScadCompiler.parameters`): the Import dialog's rows, P5-04 slice 2.
   */
  model?: boolean;
}

/** A customizer variable of the file, as OpenSCAD lists it. */
export interface ScadParameter {
  name: string;
  /** `number`, `string`, `boolean`; a vector is a `number` with an array `initial`. */
  type: string;
  initial: unknown;
  caption?: string;
  group?: string;
  min?: number;
  max?: number;
  step?: number;
}

/** One line of OpenSCAD's log, read. */
export interface ScadMessage {
  level: 'error' | 'warning' | 'echo' | 'trace';
  text: string;
  /** The file it names (its base name) and the line, when it says. */
  file?: string;
  line?: number;
}

export type ScadResult =
  | {
      ok: true;
      /** The model as a 3MF (indexed, 1 µm, ADR-0071 §1). */
      model: Uint8Array;
      /** Echoes and warnings, worded and capped (ADR-0071 §6). */
      warnings: string[];
      parameters?: ScadParameter[];
      /** The compile's own time, in ms. */
      ms: number;
    }
  | {
      ok: false;
      /** What went wrong, worded for the user. */
      error: string;
      warnings: string[];
      parameters?: ScadParameter[];
      ms: number;
    };

/** The customizer variables of a file, or why OpenSCAD couldn't list them. */
export type ScadParametersResult =
  | { ok: true; parameters: ScadParameter[] }
  | { ok: false; error: string };

export interface ScadLimits {
  /** A compile that runs longer is stopped (default 60 s). */
  timeoutMs?: number;
  /** The WASM heap a compile may grow to (default 1 GiB). */
  heapMaxBytes?: number;
}

/**
 * Compiles `.scad` files. Each compile is a fresh OpenSCAD instance (no state
 * from the last file), one at a time, in a worker that a time limit can stop.
 */
export interface ScadCompiler {
  compile(request: ScadRequest): Promise<ScadResult>;
  /**
   * The file's customizer variables (`--export-format=param`) without
   * compiling the model: what the Import dialog shows a row for.
   */
  parameters(request: Pick<ScadRequest, 'fileName' | 'source'>): Promise<ScadParametersResult>;
  /** Stops the worker. A compile after this starts a new one. */
  dispose(): void;
}
