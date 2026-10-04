/**
 * Our one zod import (ADR-0067 H1).
 *
 * zod compiles a schema's parser with `new Function` the first time it parses,
 * and it probes whether that is allowed at all when the schema is built. Both
 * are `script-src` violations, so the policy had to carry `'unsafe-eval'` for
 * zod's sake alone. Switching the JIT off once, before any schema exists (this
 * module is imported first by every module that builds one, and its own body
 * runs before its importer's), keeps parsing just as fast and lets the policy
 * drop `'unsafe-eval'` (ADR-0054, ADR-0037).
 *
 * A schema is free of the JIT under `jitless`; the runtime parser is the whole
 * validator, so nothing else changes. `globalConfig` is the same for every
 * zod schema in the page, worker and Node, since they share one zod module.
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
