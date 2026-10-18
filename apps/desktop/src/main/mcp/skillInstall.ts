/**
 * Installing the shipped skill into an agent's skills folder (ADR-0087
 * amendment 2026-10-18, skills): the folder each agent reads at start, whether
 * the skill there is the one this build ships (by digest), and writing it
 * through a folder the person chose (ADR-0075's external-files rule: main
 * writes only where a dialog said). Electron-free: the dialog is injected.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import type { McpSkillTarget } from '../../shared/ipc';
import type { SkillFile } from './skill';

/** The folder the skill's files go in, under the agent's skills folder. */
export const SKILL_FOLDER = 'extrudo';

/** Each agent's global skills folder, under the home directory; unknown agents have none. */
export function skillsHome(target: string, home: string): string | undefined {
  switch (target) {
    case 'claude-code':
      return join(home, '.claude', 'skills');
    case 'codex':
      return join(home, '.codex', 'skills');
    case 'opencode':
      return join(home, '.config', 'opencode', 'skills');
    default:
      return undefined;
  }
}

/** `<dir>/extrudo`, or `dir` itself when the person picked the skill's own folder. */
export function skillRoot(dir: string): string {
  return basename(dir) === SKILL_FOLDER ? dir : join(dir, SKILL_FOLDER);
}

/** A path for people: the home directory as `~`. */
export function displayPath(path: string, home: string): string {
  return path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

const digest = (text: string) =>
  createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/** Whether the skill's root under `dir` holds exactly this build's files. */
export function skillState(dir: string, files: readonly SkillFile[]): McpSkillTarget['state'] {
  const root = skillRoot(dir);
  if (!existsSync(join(root, 'SKILL.md'))) return 'missing';
  for (const file of files) {
    const path = join(root, file.path);
    if (!existsSync(path) || digest(readFileSync(path, 'utf8')) !== digest(file.text))
      return 'stale';
  }
  return 'current';
}

/** Writes the skill's files under `dir`'s skill root, replacing what is there; answers the root. */
export function installSkill(dir: string, files: readonly SkillFile[]): string {
  const root = skillRoot(dir);
  for (const file of files) {
    const path = join(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.text);
  }
  return root;
}

export interface SkillInstallerOptions {
  files: readonly SkillFile[];
  home: string;
  /** The folder dialog: starts at `defaultPath`, answers the folder or undefined when cancelled. */
  chooseFolder(defaultPath: string): Promise<string | undefined>;
}

export interface SkillInstaller {
  /** The agent's folder and whether the skill is there; undefined for an agent with no known folder. */
  state(target: unknown): McpSkillTarget | undefined;
  /** Asks for the folder (the agent's, or home for an unknown agent), writes the skill, answers where. */
  install(target: unknown): Promise<McpSkillTarget | undefined>;
}

export function createSkillInstaller(options: SkillInstallerOptions): SkillInstaller {
  const { files, home } = options;
  const describe = (root: string): McpSkillTarget => ({
    dir: displayPath(root, home),
    state: skillState(root, files),
  });
  const folderOf = (target: unknown) =>
    typeof target === 'string' ? skillsHome(target, home) : undefined;
  return {
    state(target) {
      const dir = folderOf(target);
      return dir ? describe(skillRoot(dir)) : undefined;
    },
    async install(target) {
      const chosen = await options.chooseFolder(folderOf(target) ?? home);
      if (!chosen) return undefined;
      return describe(installSkill(chosen, files));
    },
  };
}
