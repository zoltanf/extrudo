import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSkillInstaller,
  displayPath,
  installSkill,
  skillRoot,
  skillState,
  skillsHome,
} from './skillInstall';

const files = [
  { path: 'SKILL.md', text: '---\nname: extrudo\n---\n# Skill\n' },
  { path: 'references/api.md', text: '# API\n' },
];
const temp = () => mkdtempSync(join(tmpdir(), 'extrudo-skill-'));

describe('installing the skill into an agent (ADR-0087 amendment 2026-10-18)', () => {
  it('knows each agent’s global skills folder', () => {
    expect(skillsHome('claude-code', '/home/me')).toBe('/home/me/.claude/skills');
    expect(skillsHome('codex', '/home/me')).toBe('/home/me/.codex/skills');
    expect(skillsHome('opencode', '/home/me')).toBe('/home/me/.config/opencode/skills');
    expect(skillsHome('json', '/home/me')).toBeUndefined();
  });

  it('puts the files in extrudo/ under the folder, or in the folder when it is extrudo/ itself', () => {
    expect(skillRoot('/a/skills')).toBe('/a/skills/extrudo');
    expect(skillRoot('/a/skills/extrudo')).toBe('/a/skills/extrudo');
  });

  it('shows the home directory as ~', () => {
    expect(displayPath('/home/me/.claude/skills', '/home/me')).toBe('~/.claude/skills');
    expect(displayPath('/opt/skills', '/home/me')).toBe('/opt/skills');
    expect(displayPath('/home/mentor/x', '/home/me')).toBe('/home/mentor/x');
  });

  it('tells missing, stale and current apart by the files’ digests', () => {
    const dir = temp();
    expect(skillState(dir, files)).toBe('missing');
    const root = installSkill(dir, files);
    expect(root).toBe(join(dir, 'extrudo'));
    expect(readFileSync(join(root, 'references/api.md'), 'utf8')).toBe('# API\n');
    expect(skillState(dir, files)).toBe('current');
    writeFileSync(join(root, 'SKILL.md'), 'old\n');
    expect(skillState(dir, files)).toBe('stale');
    // A missing reference is stale too, and installing again replaces everything.
    installSkill(dir, files);
    expect(skillState(dir, files)).toBe('current');
    expect(skillState(join(dir, 'extrudo'), files)).toBe('current');
  });

  it('installs through the chosen folder, starting at the agent’s, and answers where', async () => {
    const home = temp();
    const asked: string[] = [];
    let answer: string | undefined = join(home, '.claude', 'skills');
    const installer = createSkillInstaller({
      files,
      home,
      chooseFolder: async (defaultPath) => {
        asked.push(defaultPath);
        return answer;
      },
    });
    expect(installer.state('claude-code')).toEqual({
      dir: '~/.claude/skills/extrudo',
      state: 'missing',
    });
    expect(installer.state('json')).toBeUndefined();
    expect(installer.state(42)).toBeUndefined();
    expect(await installer.install('claude-code')).toEqual({
      dir: '~/.claude/skills/extrudo',
      state: 'current',
    });
    expect(installer.state('claude-code')?.state).toBe('current');
    // An agent with no known folder starts at home; cancelling installs nothing.
    answer = undefined;
    expect(await installer.install('prompt')).toBeUndefined();
    expect(asked).toEqual([join(home, '.claude', 'skills'), home]);
    // The person may pick the skill's own folder.
    mkdirSync(join(home, 'other', 'extrudo'), { recursive: true });
    answer = join(home, 'other', 'extrudo');
    expect((await installer.install('codex'))?.dir).toBe('~/other/extrudo');
  });
});
