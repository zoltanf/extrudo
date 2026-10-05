// Lets a plain Node script import the workspace's TypeScript directly
// (`pnpm api:generate`, ADR-0068 §3). Node strips the types itself; this only
// resolves what the sources use: extensionless relative imports (`./zod`) and
// the `.ts` extension.
//
//   node --import ./scripts/ts-import.mjs some-script.mjs
//
// Nothing else is hooked: no transform, no bundle, no watch. A script that wants
// the real build reads `dist`.

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

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
