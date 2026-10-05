/**
 * `@extrudo/cli`: the headless CLI (P5-03, ADR-0069).
 *
 * ```
 * import { openDesign } from '@extrudo/cli';
 *
 * const job = await openDesign('bracket.extrudo');
 * await job.setParameters({ width: '60 mm' });
 * const { bodies, errors } = await job.compute();
 * await job.export({ format: '3mf' });
 * await job.dispose();
 * ```
 *
 * `openDesign` and the rest come from `./headless`, also importable on its own
 * (`@extrudo/cli/headless`) for a caller that wants the library without the
 * command line. The binary (`bin/extrudo.mjs`) is `src/cli.ts`'s `run`.
 */

export {
  DESIGN_ERROR,
  FILE_ERROR,
  OK,
  type Options,
  type Streams,
  USAGE,
} from './cli';
export * from './headless';
