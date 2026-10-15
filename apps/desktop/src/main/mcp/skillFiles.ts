/**
 * The shipped skill's files (P6-08, ADR-0087 §7), bundled into main from
 * `apps/desktop/skill/extrudo/` at build time, so the server serves exactly
 * what the repository holds and the installer needs no loose files.
 */
import { createSkill, type Skill, type SkillFile } from './skill';

const PREFIX = '../../../skill/extrudo/';

const raw = import.meta.glob<string>('../../../skill/extrudo/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The skill's files, paths relative to its root. */
export const SKILL_FILES: readonly SkillFile[] = Object.entries(raw).map(([path, text]) => ({
  path: path.slice(PREFIX.length),
  text,
}));

/** The skill, as the server serves it. */
export const extrudoSkill = (): Skill => createSkill(SKILL_FILES);

/** The server's instructions: read the skill first. */
export const SKILL_INSTRUCTIONS = 'Read skill://extrudo/SKILL.md before modelling.';
