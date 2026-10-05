#!/usr/bin/env node
/**
 * `extrudo`: the headless CLI (P5-03, ADR-0069). A thin launcher — it lets
 * Node resolve the workspace's TypeScript the way the sources are written
 * (extensionless relative imports), the same hook `scripts/ts-import.mjs`
 * registers for `pnpm api:generate`, and then runs `src/cli.ts`:
 *
 * ```
 * node packages/cli/bin/extrudo.mjs info design.extrudo --json
 * pnpm extrudo export design.extrudo --format 3mf --param width=60mm
 * ```
 *
 * The kernel's WASM and the solver's are loaded from `pnpm wasm`'s build
 * output, exactly as the tests and the app do. Publishing this as an npm
 * binary (with the WASM and the fonts bundled) is Phase 6's work.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// Node strips the types itself (Node ≥ 24); this only resolves what the
// sources use: an extensionless relative import, or a directory's index.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw error;
      const parent = context.parentURL ?? import.meta.url;
      const base = new URL(specifier, parent);
      for (const candidate of [`${base.href}.ts`, `${base.href}/index.ts`]) {
        if (existsSync(fileURLToPath(candidate))) return { url: candidate, shortCircuit: true };
      }
      throw error;
    }
  },
});

const { run } = await import('../src/cli.ts');
process.exitCode = await run(process.argv.slice(2));
