/**
 * The shipped skill as MCP resources (P6-08, ADR-0087 §7), per SEP-2640 (the
 * Skills extension, Final): every file of `apps/desktop/skill/extrudo/` is a
 * resource `skill://extrudo/<path>`, `skills/list` and `skills/get` answer the
 * skill's entry (its frontmatter as JSON and every file's SHA-256 and size),
 * and `resources/directory/read` lists a directory's direct children. Pure
 * over the files it is given, so the tests need neither the build nor a disk.
 */
import { createHash } from 'node:crypto';

/** A file of the skill: its path relative to the skill's root, and its text. */
export interface SkillFile {
  path: string;
  text: string;
}

export interface SkillResourceEntry {
  uri: string;
  digest: string;
  size: number;
}

/** A `skills/list` entry (SEP-2640 "Enumeration via skills/list"). */
export interface SkillEntry {
  uri: string;
  frontmatter: Record<string, string>;
  resources: SkillResourceEntry[];
}

/** A resource as `resources/list` and `resources/directory/read` describe it. */
export interface SkillResource {
  uri: string;
  name: string;
  mimeType: string;
  description?: string;
}

export const SKILL_SCHEME = 'skill://';
export const DIRECTORY_MIME = 'inode/directory';

/**
 * The `SKILL.md` frontmatter as a flat object of strings. The skill's own
 * frontmatter is `key: value` lines (a value may be quoted); anything richer
 * is refused, so the JSON can't silently differ from the file.
 */
export function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match?.[1]) throw new Error('SKILL.md has no frontmatter.');
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!pair?.[1] || pair[2] === undefined) {
      throw new Error(`SKILL.md frontmatter: can't read "${line}".`);
    }
    let value = pair[2].trim();
    if (/^".*"$/.test(value)) value = JSON.parse(value) as string;
    else if (/^'.*'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
    out[pair[1]] = value;
  }
  if (!out.name || !out.description) {
    throw new Error('SKILL.md frontmatter needs a name and a description.');
  }
  return out;
}

const mimeOf = (path: string): string =>
  path.endsWith('.md')
    ? 'text/markdown'
    : path.endsWith('.json')
      ? 'application/json'
      : 'text/plain';

export interface Skill {
  readonly name: string;
  /** `skill://<name>/SKILL.md`. */
  readonly uri: string;
  readonly entry: SkillEntry;
  /** Every file as a resource (for `resources/list`). */
  resources(): SkillResource[];
  /** A file's text by its URI, or undefined. */
  read(uri: string): { text: string; mimeType: string } | undefined;
  /** A directory's direct children, or undefined when `uri` is not a directory of the skill. */
  directory(uri: string): SkillResource[] | undefined;
  /** `SKILL.md`'s text. */
  readonly text: string;
}

export function createSkill(files: readonly SkillFile[]): Skill {
  const main = files.find((file) => file.path === 'SKILL.md');
  if (!main) throw new Error('The skill has no SKILL.md.');
  const frontmatter = parseFrontmatter(main.text);
  const name = frontmatter.name as string;
  const root = `${SKILL_SCHEME}${name}`;
  const uriOf = (path: string) => `${root}/${path}`;
  // SKILL.md first, then the rest by path (code points, so the order is the same everywhere).
  const sorted = [...files].sort((a, b) =>
    a === main ? -1 : b === main ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const byUri = new Map(sorted.map((file) => [uriOf(file.path), file]));
  const resources: SkillResourceEntry[] = sorted.map((file) => {
    const bytes = Buffer.from(file.text, 'utf8');
    return {
      uri: uriOf(file.path),
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      size: bytes.length,
    };
  });
  const describe = (file: SkillFile): SkillResource => ({
    uri: uriOf(file.path),
    name: file === main ? name : (file.path.split('/').pop() ?? file.path),
    mimeType: mimeOf(file.path),
    ...(file === main && { description: frontmatter.description }),
  });
  const directories = new Set<string>(['']);
  for (const file of sorted) {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  return {
    name,
    uri: uriOf('SKILL.md'),
    text: main.text,
    entry: { uri: uriOf('SKILL.md'), frontmatter, resources },
    resources: () => sorted.map(describe),
    read(uri) {
      const file = byUri.get(uri);
      return file && { text: file.text, mimeType: mimeOf(file.path) };
    },
    directory(uri) {
      if (uri !== root && !uri.startsWith(`${root}/`)) return undefined;
      const dir = uri === root ? '' : uri.slice(root.length + 1);
      if (!directories.has(dir)) return undefined;
      const prefix = dir === '' ? '' : `${dir}/`;
      const children: SkillResource[] = [];
      for (const sub of directories) {
        if (sub !== '' && sub.startsWith(prefix) && !sub.slice(prefix.length).includes('/')) {
          children.push({
            uri: uriOf(sub),
            name: sub.slice(prefix.length),
            mimeType: DIRECTORY_MIME,
          });
        }
      }
      for (const file of sorted) {
        if (file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes('/')) {
          children.push(describe(file));
        }
      }
      return children;
    },
  };
}
