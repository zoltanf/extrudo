import { describe, expect, it } from 'vitest';
import { extrudoSkill, SKILL_FILES } from './skillFiles';

describe('the bundled skill (ADR-0087 §7)', () => {
  it('carries every file of apps/desktop/skill/extrudo', () => {
    expect(SKILL_FILES.map((f) => f.path).sort()).toEqual([
      'SKILL.md',
      'references/api.md',
      'references/examples.md',
      'references/tools.md',
    ]);
  });

  it('is the extrudo skill, within SEP-2640 limits', () => {
    const skill = extrudoSkill();
    expect(skill.uri).toBe('skill://extrudo/SKILL.md');
    expect(skill.entry.frontmatter.name).toBe('extrudo');
    expect(skill.entry.resources.length).toBeLessThanOrEqual(512);
    const total = skill.entry.resources.reduce((sum, r) => sum + r.size, 0);
    expect(total).toBeLessThanOrEqual(16 * 1024 * 1024);
    for (const resource of skill.entry.resources)
      expect(resource.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
