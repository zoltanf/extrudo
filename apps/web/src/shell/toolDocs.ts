/**
 * The generated tool reference (ADR-0080 §2, §4): one Markdown page per tool in
 * the toolbar, plus the index, built from the app's own catalogue (`TOOLS`,
 * `TABS`), its key map (`keysFor`) and the list of demos (`DEMO_TOOLS`).
 *
 * `pnpm docs:generate` writes these pages under `docs/guide/tools/`, where the
 * site (`apps/site`) builds them into `/docs/tools/`, and
 * `toolDocs.test.ts` fails when the checked-in files are stale. Nothing here is
 * hand-maintained except the notes a person writes between the `<!-- notes -->`
 * markers: those are carried over on every regeneration, so a page can explain
 * what the catalogue cannot.
 *
 * Pure and DOM-free: the generator script runs this under Node's type stripping,
 * and the web app's own Vitest runs it for the staleness test. The one `node:`
 * import lives in the test, not here.
 */
import { keysFor } from '../commands/keymap';
import { DEMO_TOOLS } from '../onboarding/demos';
import { TABS, TOOLS, type Tool, type ToolId } from './tools';

const NOTES_OPEN = '<!-- notes -->';
const NOTES_CLOSE = '<!-- /notes -->';

/** One tab › group a tool appears in, and the name it takes in that group. */
interface Placement {
  tab: string;
  group: string;
  /** The group's own label for the tool, when it differs from the tool's. */
  alias?: string;
}

/** Everything a page needs about one tool. */
interface ToolInfo {
  id: ToolId;
  title: string;
  hint: string;
  /** The label of the first tab it appears in, which is its sidebar category. */
  category: string;
  /** Its place across `TABS` in reading order, 1-based. */
  order: number;
  placements: Placement[];
  demo: boolean;
}

/**
 * Every page, as `path → Markdown`, relative to the repository root:
 * `docs/guide/tools/<id>.md` per tool and `docs/guide/tools/index.md`.
 * `existing(path)` gives a file's current text (or `undefined`), whose notes
 * between the markers are kept.
 */
export function toolPages(existing: (path: string) => string | undefined): Map<string, string> {
  const pages = new Map<string, string>([['docs/guide/tools/index.md', indexPage()]]);
  for (const info of toolInfos()) {
    const path = `docs/guide/tools/${info.id}.md`;
    pages.set(path, toolPage(info, notesOf(existing(path))));
  }
  return pages;
}

/**
 * The tools a page is made for, in `TABS` reading order: every `ToolId` some
 * tab's group lists (as a tile or in its `more`) that has no `comesWith`. A tool
 * in several tabs keeps the first tab it appears in as its category and lists
 * every placement.
 */
function toolInfos(): ToolInfo[] {
  const byId = new Map<ToolId, ToolInfo>();
  let order = 0;
  for (const tab of TABS) {
    for (const group of tab.groups) {
      for (const id of [...group.tools, ...(group.more ?? [])]) {
        const tool: Tool = TOOLS[id];
        if (tool.comesWith) continue;
        let info = byId.get(id);
        if (!info) {
          order += 1;
          info = {
            id,
            title: titleOf(tool.label),
            hint: tool.hint,
            category: tab.label,
            order,
            placements: [],
            demo: DEMO_TOOLS.includes(id),
          };
          byId.set(id, info);
        }
        const alias = group.labels?.[id];
        info.placements.push({
          tab: tab.label,
          group: group.label,
          ...(alias && alias !== tool.label ? { alias } : {}),
        });
      }
    }
  }
  return [...byId.values()];
}

/** A tool's title: its label without the trailing ellipsis a command carries. */
function titleOf(label: string): string {
  return label.replace(/…$/, '');
}

/** One tool page, as the ADR-0080 §2 template says. */
function toolPage(info: ToolInfo, notes: string): string {
  const lines = [
    '---',
    `title: ${info.title}`,
    'section: Tools',
    `category: ${info.category}`,
    `order: ${info.order}`,
    '---',
    '',
    `# ${info.title}`,
    '',
    info.hint,
    '',
    '| Where | Shortcut |',
    '|---|---|',
    `| ${placements(info)} | ${shortcut(info.id)} |`,
  ];
  if (info.demo) {
    lines.push(
      '',
      `<video src="demo:${info.id}" muted loop autoplay playsinline aria-label="${info.title} demo"></video>`,
    );
  }
  lines.push('', NOTES_OPEN);
  if (notes !== '') lines.push(...notes.split('\n'));
  lines.push(NOTES_CLOSE);
  return `${lines.join('\n')}\n`;
}

/** The index: every tool, by tab and group, in `TABS` reading order. */
function indexPage(): string {
  const lines = [
    '---',
    'title: Tools',
    'section: Tools',
    'order: 0',
    '---',
    '',
    '# Tools',
    '',
    'Every tool in the toolbar, by tab. On a Mac, Ctrl is ⌘.',
  ];
  for (const tab of TABS) {
    // The tools to list, in the group's own order, skipping the ones without a page.
    const groups = tab.groups
      .map((group) => ({
        label: group.label,
        tools: [...group.tools, ...(group.more ?? [])].filter(
          (id) => !(TOOLS[id] as Tool).comesWith,
        ),
      }))
      .filter((group) => group.tools.length > 0);
    if (groups.length === 0) continue;
    lines.push('', `## ${tab.label}`);
    for (const group of groups) {
      lines.push('', `### ${group.label}`, '');
      for (const id of group.tools) {
        const tool = TOOLS[id];
        lines.push(`- [${titleOf(tool.label)}](./${id}.md) — ${tool.hint}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Every placement of a tool, joined in `TABS` order. */
function placements(info: ToolInfo): string {
  return info.placements
    .map(({ tab, group, alias }) => `${tab} › ${group}${alias ? ` (as ${alias})` : ''}`)
    .join(' · ');
}

/** A tool's keys: `Mod` reads as Ctrl, several keys joined by "or", none as "None". */
function shortcut(id: ToolId): string {
  const keys = keysFor(id);
  if (keys.length === 0) return 'None';
  return keys.map((key) => key.replace(/Mod/g, 'Ctrl')).join(' or ');
}

/** The notes a page already had, between its markers (empty when there are none). */
function notesOf(text: string | undefined): string {
  const match = text ? new RegExp(`${NOTES_OPEN}([\\s\\S]*?)${NOTES_CLOSE}`).exec(text) : null;
  if (!match) return '';
  return (match[1] ?? '').replace(/^\n/, '').replace(/\n$/, '');
}
