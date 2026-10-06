/**
 * `extrudo`: the command line of P5-03 (ADR-0069 §3). Four commands over an
 * `.extrudo` design:
 *
 * ```
 * extrudo info   <design.extrudo> [--json]
 * extrudo export <design.extrudo> --format stl|3mf|step [--out <path>]
 *                [--param name=expr]… [--config <name>] [--bodies a,b]
 *                [--resolution coarse|medium|fine|<mm>] [--json]
 * extrudo set    <design.extrudo> [--param name=expr]… [--config <name>] --out <new.extrudo>
 * extrudo check  <design.extrudo> [--param …] [--config …] [--json]
 * ```
 *
 * **Exit codes** (ADR-0069 §3): 0 it worked; 1 the command line was wrong (a
 * usage message, or a parameter the design doesn't have or an expression that
 * doesn't evaluate); 2 the design has errors (`check`, an export of a body
 * that isn't there, a change a sketch can't take); 3 a file couldn't be read
 * or written. Messages go to stderr in the app's wording; `--json` prints one
 * object on stdout instead.
 *
 * Everything it computes goes through `headless.ts`, so a script and this
 * command do the same thing.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type ComputeResult,
  type DesignJob,
  EXTRUDO_VERSION,
  type ExportedFile,
  FileError,
  HeadlessError,
  openDesign,
  ParameterError,
} from './headless';

/** What the commands share: where output and messages go. */
export interface Streams {
  out(text: string): void;
  err(text: string): void;
}

const consoleStreams: Streams = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

/** Exit codes (ADR-0069 §3). */
export const OK = 0;
export const USAGE = 1;
export const DESIGN_ERROR = 2;
export const FILE_ERROR = 3;

/** The commands, in the order `--help` lists them. */
const COMMANDS = ['info', 'export', 'set', 'check'] as const;
type Command = (typeof COMMANDS)[number];

const USAGE_TEXT = `extrudo ${EXTRUDO_VERSION} — recompute an Extrudo design in Node and export it.

Usage:
  extrudo info   <design.extrudo> [--json]
  extrudo export <design.extrudo> --format stl|3mf|step [--out <path>]
                [--param name=expr]... [--config <name>] [--bodies a,b]
                [--resolution coarse|medium|fine|<deviation mm>] [--json]
  extrudo set    <design.extrudo> [--param name=expr]... [--config <name>] --out <new.extrudo>
  extrudo check  <design.extrudo> [--param name=expr]... [--config <name>] [--json]

Options:
  --param name=expr   Set a parameter (units are welcome: width=60mm, tilt=30deg).
                      Repeatable. A driving dimension's own parameter works too.
  --config <name>     Put a configuration's values on the parameters.
  --bodies a,b        Export only these bodies, by name.
  --out <path>        Where to write. For export it is the one file to write;
                      for set it is the .extrudo file to write.
  --resolution        coarse, medium (the default), fine, or a deflection in mm.
  --json              One JSON object on stdout instead of the text report.

Exit codes: 0 ok, 1 usage, 2 the design has errors, 3 a file could not be read or written.`;

/** A command line that can't be run: the message and the usage, exit 1. */
class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** The options of a command line, after parsing. */
export interface Options {
  command: Command;
  design: string;
  format?: string;
  out?: string;
  params: Record<string, string>;
  config?: string;
  bodies?: string[];
  resolution?: string;
  json: boolean;
}

/** The options `parseArgs` knows about; `--param` repeats, the rest are one. */
const PARSE_OPTIONS = {
  format: { type: 'string' },
  out: { type: 'string' },
  param: { type: 'string', multiple: true },
  config: { type: 'string' },
  bodies: { type: 'string' },
  resolution: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
} as const;

/** `name=expr` pairs of `--param`, in the order they were given. */
function parametersOf(values: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of values) {
    const at = pair.indexOf('=');
    if (at < 1) {
      throw new UsageError(
        `--param takes name=expression, as in --param width=60mm ("${pair}" doesn't).`,
      );
    }
    const name = pair.slice(0, at).trim();
    const expression = pair.slice(at + 1).trim();
    if (name.length === 0 || expression.length === 0) {
      throw new UsageError(
        `--param takes name=expression, as in --param width=60mm ("${pair}" doesn't).`,
      );
    }
    if (out[name] !== undefined) {
      throw new UsageError(`--param ${name} was given twice.`);
    }
    out[name] = expression;
  }
  return out;
}

/** One command line parsed with the options above (`parseArgs`, strictly). */
function parseLine(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    options: PARSE_OPTIONS,
    strict: true,
  });
}

/** The parsed command line, or what is wrong with it. */
export function parse(argv: readonly string[]): Options | { help: true } | { version: true } {
  let parsed: ReturnType<typeof parseLine>;
  try {
    parsed = parseLine(argv);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.version) return { version: true };
  const command = positionals[0];
  if (values.help || command === undefined) {
    if (values.help && command === undefined) return { help: true };
    if (command !== undefined && !COMMANDS.includes(command as Command)) {
      throw new UsageError(
        `There is no "${command}" command. The commands are: ${COMMANDS.join(', ')}.`,
      );
    }
    throw new UsageError('extrudo needs a command and a design file.');
  }
  if (!COMMANDS.includes(command as Command)) {
    throw new UsageError(
      `There is no "${command}" command. The commands are: ${COMMANDS.join(', ')}.`,
    );
  }
  const design = positionals[1];
  if (design === undefined) {
    throw new UsageError(`extrudo ${command} needs a design file (.extrudo).`);
  }
  if (positionals.length > 2) {
    throw new UsageError(
      `extrudo ${command} takes one design file; "${positionals.slice(2).join(' ')}" is extra.`,
    );
  }
  const options: Options = {
    command: command as Command,
    design,
    params: parametersOf(values.param ?? []),
    json: values.json === true,
  };
  if (values.format !== undefined) options.format = values.format;
  if (values.out !== undefined) options.out = values.out;
  if (values.config !== undefined) options.config = values.config;
  if (values.bodies !== undefined) {
    options.bodies = values.bodies
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    if (options.bodies.length === 0) {
      throw new UsageError('--bodies takes body names, separated by commas.');
    }
  }
  if (values.resolution !== undefined) options.resolution = values.resolution;
  if (options.command === 'export' && options.format === undefined) {
    throw new UsageError('extrudo export needs --format stl, 3mf or step.');
  }
  if (options.command === 'set' && options.out === undefined) {
    throw new UsageError('extrudo set needs --out <new.extrudo> to write.');
  }
  if (options.command !== 'export' && options.format !== undefined) {
    throw new UsageError(`--format is for extrudo export, not ${options.command}.`);
  }
  if (options.command !== 'export' && options.bodies !== undefined) {
    throw new UsageError(`--bodies is for extrudo export, not ${options.command}.`);
  }
  if (options.command !== 'export' && options.resolution !== undefined) {
    throw new UsageError(`--resolution is for extrudo export, not ${options.command}.`);
  }
  return options;
}

/** `--resolution` as a preset name or a deflection in mm. */
function resolutionOf(text: string | undefined): 'coarse' | 'medium' | 'fine' | number | undefined {
  if (text === undefined) return undefined;
  if (text === 'coarse' || text === 'medium' || text === 'fine') return text;
  const deflection = Number(text);
  if (Number.isFinite(deflection) && deflection > 0) return deflection;
  throw new UsageError(
    `--resolution takes coarse, medium, fine or a deflection in mm ("${text}" is none).`,
  );
}

/** Opens the design and applies the parameters and configuration asked for. */
async function opened(options: Options): Promise<DesignJob> {
  const { job, notices } = await openDesign(options.design);
  try {
    for (const [name, expression] of Object.entries(options.params)) {
      await job.setParameters({ [name]: expression });
    }
    if (options.config) await job.applyConfiguration(options.config);
  } catch (error) {
    await job.dispose();
    throw error;
  }
  for (const notice of notices) job.notices.includes(notice) || console.warn(notice);
  return job;
}

/** What a parameter's unit reads as: the document's unit, `deg`, or nothing. */
function unitLabel(unit: string, lengthUnit: string): string {
  if (unit === 'angle') return 'deg';
  if (unit === 'unitless') return '';
  return lengthUnit;
}

/** The lines `info` prints. */
function report(job: DesignJob, result: ComputeResult): string[] {
  const lines: string[] = [job.doc.name];
  const summary = [
    `${job.doc.settings.units}`,
    `${result.bodies.length} ${result.bodies.length === 1 ? 'body' : 'bodies'}`,
    `${result.ms.toFixed(0)} ms`,
  ];
  if (result.errors > 0)
    summary.push(`${result.errors} ${result.errors === 1 ? 'error' : 'errors'}`);
  if (result.warnings > 0) {
    summary.push(`${result.warnings} ${result.warnings === 1 ? 'warning' : 'warnings'}`);
  }
  lines.push(`  ${summary.join(' · ')}`);
  const parameters = job.parameters;
  // The parameters a person added, then the ones the model owns: a driving
  // dimension's and a feature input's, which `--param` takes and names.
  for (const [owner, heading] of [
    ['user', 'Parameters:'],
    ['dimension', 'Parameters (driving dimensions):'],
    ['feature', 'Parameters (feature inputs):'],
  ] as const) {
    const group = parameters.filter((parameter) => parameter.owner === owner);
    if (group.length === 0) continue;
    const names = Math.max(...parameters.map((p) => p.name.length));
    const expressions = Math.max(...parameters.map((p) => p.expression.length));
    lines.push(heading);
    for (const parameter of group) {
      const unit = unitLabel(parameter.unit, job.doc.settings.units);
      const value =
        parameter.value === undefined ? '—' : `${parameter.value}${unit ? ` ${unit}` : ''}`;
      lines.push(
        `  ${parameter.name.padEnd(names)}  ${parameter.expression.padEnd(expressions)} = ${value}` +
          `${parameter.of ? `  (${parameter.of})` : ''}`,
      );
    }
  }
  const configurations = job.configurations;
  if (configurations.length > 0) {
    lines.push(`Configurations: ${configurations.join(', ')}`);
  }
  lines.push('Features:');
  for (const feature of result.features) {
    // A script says how many features it made (P5-02, ADR-0070).
    const made = feature.script
      ? ` (made ${feature.script.generated.length} ${feature.script.generated.length === 1 ? 'feature' : 'features'})`
      : '';
    lines.push(
      `  ${feature.status.padEnd(7)} ${feature.name}${made}${feature.message ? `: ${feature.message}` : ''}`,
    );
  }
  lines.push('Bodies:');
  for (const body of result.bodies) {
    const size = body.size.map((v) => v.toFixed(2)).join(' × ');
    lines.push(
      `  ${body.name}  ${size} mm · ${body.faces} ${body.faces === 1 ? 'face' : 'faces'}` +
        ` · ${Math.round(body.volume)} mm³${body.mesh ? ' · mesh' : ''}`,
    );
  }
  return lines;
}

/** `info`: the design as it computes. */
async function info(options: Options, streams: Streams): Promise<number> {
  const job = await opened(options);
  try {
    const result = await job.compute();
    if (options.json) {
      streams.out(
        JSON.stringify(
          {
            name: job.doc.name,
            units: job.doc.settings.units,
            notices: job.notices,
            parameters: job.parameters,
            configurations: job.configurations,
            features: result.features,
            bodies: result.bodies,
            errors: result.errors,
            warnings: result.warnings,
            ms: Math.round(result.ms),
          },
          null,
          2,
        ),
      );
    } else {
      for (const notice of job.notices) streams.err(notice);
      for (const line of report(job, result)) streams.out(line);
    }
    return result.errors > 0 ? DESIGN_ERROR : OK;
  } finally {
    await job.dispose();
  }
}

/** Where an exported file goes: `--out`, or next to the design. */
function pathOf(options: Options, file: ExportedFile): string {
  if (options.out) return options.out;
  const folder = dirname(options.design);
  const beside = join(folder, file.name);
  // Never write over the design itself.
  return beside === options.design ? join(folder, `export-${file.name}`) : beside;
}

/** `export`: the chosen bodies as mesh or STEP files. */
async function exportCommand(options: Options, streams: Streams): Promise<number> {
  const format = (options.format ?? '').toLowerCase();
  if (format !== 'stl' && format !== '3mf' && format !== 'step') {
    throw new UsageError(`--format takes stl, 3mf or step ("${options.format}" is none).`);
  }
  const resolution = resolutionOf(options.resolution);
  const job = await opened(options);
  try {
    const files = await job.export({
      format,
      ...(options.bodies ? { bodies: options.bodies } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
      // One file when the command named one, else an STL is one file per body.
      ...(options.out ? { singleFile: true } : {}),
    });
    if (files.length === 0) {
      streams.err('This design has nothing to export.');
      return DESIGN_ERROR;
    }
    const written: {
      path: string;
      name: string;
      bytes: number;
      bodies: string[];
      triangles: number;
      closed: boolean;
    }[] = [];
    for (const file of files) {
      const path = pathOf(options, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.bytes);
      written.push({
        path,
        name: file.name,
        bytes: file.bytes.length,
        bodies: file.bodies,
        triangles: file.triangles,
        closed: file.closed,
      });
      if (!file.closed) {
        streams.err(
          `${file.name} holds ${file.bodies.join(', ')}, whose mesh isn't closed; a slicer would repair it.`,
        );
      }
    }
    if (options.json) streams.out(JSON.stringify({ files: written }, null, 2));
    else for (const file of written) streams.out(`Wrote ${file.path}`);
    return OK;
  } finally {
    await job.dispose();
  }
}

/** `set`: the design with the changes, written as a new `.extrudo` file. */
async function set(options: Options, streams: Streams): Promise<number> {
  const job = await opened(options);
  try {
    const bytes = await job.save(options.out as string);
    if (options.json) {
      streams.out(
        JSON.stringify(
          {
            name: job.doc.name,
            path: options.out,
            bytes: bytes.length,
            parameters: job.parameters,
          },
          null,
          2,
        ),
      );
    } else {
      streams.out(`Wrote ${options.out}`);
    }
    return OK;
  } finally {
    await job.dispose();
  }
}

/** `check`: recompute and say what is wrong, for a CI of a design library. */
async function check(options: Options, streams: Streams): Promise<number> {
  const job = await opened(options);
  try {
    // No volumes: a check is about the design's features, and measuring a
    // threaded body costs more than computing it.
    const result = await job.status();
    const problems = result.features.filter((feature) => feature.status !== 'ok');
    if (options.json) {
      streams.out(
        JSON.stringify(
          {
            name: job.doc.name,
            ok: result.errors === 0,
            errors: result.errors,
            warnings: result.warnings,
            features: result.features,
            bodies: result.bodies,
            ms: Math.round(result.ms),
          },
          null,
          2,
        ),
      );
    } else {
      if (result.errors === 0) {
        streams.out(`${job.doc.name}: no errors (${result.bodies.length} bodies).`);
      } else {
        streams.err(`${job.doc.name}: ${result.errors} errors.`);
        for (const feature of problems) {
          if (feature.status === 'error') {
            streams.err(`  ${feature.name}: ${feature.message ?? 'Internal error'}`);
          }
        }
      }
      for (const feature of problems.filter((p) => p.status === 'warning')) {
        streams.err(`  ${feature.name} (warning): ${feature.message ?? 'Warning'}`);
      }
    }
    return result.errors > 0 ? DESIGN_ERROR : OK;
  } finally {
    await job.dispose();
  }
}

/**
 * Runs one command line and returns its exit code. Nothing is thrown: every
 * failure becomes a message on stderr and a code (ADR-0069 §3).
 */
export async function run(
  argv: readonly string[],
  streams: Streams = consoleStreams,
): Promise<number> {
  try {
    const parsed = parse(argv);
    if ('help' in parsed) {
      streams.out(USAGE_TEXT);
      return OK;
    }
    if ('version' in parsed) {
      streams.out(EXTRUDO_VERSION);
      return OK;
    }
    switch (parsed.command) {
      case 'info':
        return await info(parsed, streams);
      case 'export':
        return await exportCommand(parsed, streams);
      case 'set':
        return await set(parsed, streams);
      case 'check':
        return await check(parsed, streams);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      streams.err(`extrudo: ${error.message}`);
      streams.err(USAGE_TEXT);
      return USAGE;
    }
    if (error instanceof ParameterError) {
      streams.err(`extrudo: ${error.message}`);
      return USAGE;
    }
    if (error instanceof FileError) {
      streams.err(`extrudo: ${error.message}`);
      return FILE_ERROR;
    }
    if (error instanceof HeadlessError) {
      streams.err(`extrudo: ${error.message}`);
      return DESIGN_ERROR;
    }
    streams.err(`extrudo: ${error instanceof Error ? error.message : String(error)}`);
    return FILE_ERROR;
  }
}
