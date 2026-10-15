import { FEATURE_TYPES } from '@extrudo/api';
import { describe, expect, it } from 'vitest';
import type { AgentReply } from '../platform/agent';
import { TOOL_NAMES, TOOL_SCHEMAS, type ToolName } from './schemas';
import { fakeContext } from './testing';
import { runTool } from './tools';
import { TOOLS_PAGE_PATH, toolsPage } from './toolsPage';

// The shipped skill (P6-08, ADR-0087 §7), read as text from the desktop app's folder.
const files = import.meta.glob<string>('../../../desktop/skill/extrudo/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const file = (path: string) => files[`../../../desktop/skill/extrudo/${path}`] ?? '';

interface Call {
  tool: string;
  args: Record<string, unknown>;
}

/** Every `{ "tool": …, "args": … }` line of the JSON blocks in a page. */
function calls(text: string): Call[] {
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  return blocks.flatMap((block) =>
    block
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Call),
  );
}

describe('the shipped skill (ADR-0087 §7)', () => {
  it('has the Agent Skills frontmatter', () => {
    expect(file('SKILL.md')).toMatch(/^---\nname: extrudo\ndescription: .+\n---\n/);
  });

  it(`has an up-to-date ${TOOLS_PAGE_PATH}`, () => {
    expect(file('references/tools.md') === toolsPage(), 'run pnpm api:generate').toBe(true);
  });

  it('names only tools that exist', () => {
    for (const path of ['SKILL.md', 'references/examples.md']) {
      for (const [, name] of file(path).matchAll(/`([a-z]+_[a-z_]+)`/g)) {
        expect(TOOL_NAMES, `${path}: \`${name}\``).toContain(name);
      }
    }
  });

  it('gives every example call valid input, of a feature type the API has', () => {
    const all = calls(file('references/examples.md'));
    expect(all.length).toBeGreaterThan(20);
    for (const call of all) {
      expect(TOOL_NAMES, call.tool).toContain(call.tool);
      const parsed = TOOL_SCHEMAS[call.tool as ToolName].input.safeParse(call.args);
      expect(parsed.success, JSON.stringify(call)).toBe(true);
      if (call.tool === 'add_feature') expect(FEATURE_TYPES).toContain(call.args.type);
    }
  });

  it('runs both worked examples through the tools without an error', async () => {
    const ctx = fakeContext(undefined);
    const textOf = (reply: AgentReply) => (reply.result.content[0] as { text: string }).text;
    for (const call of calls(file('references/examples.md'))) {
      const host = ctx.current();
      const doc = host?.store.getState().doc;
      // `<Name id>`: the id of the feature named Name, as the example says.
      const args = JSON.parse(
        JSON.stringify(call.args).replace(/<([^<>]+) id>/g, (_, name: string) => {
          const found = doc?.features.find((f) => f.name === name);
          if (!found) throw new Error(`No feature named ${name} for ${JSON.stringify(call)}`);
          return found.id;
        }),
      );
      const reply = await runTool(call.tool, args, ctx);
      expect(reply.result.isError, `${call.tool}: ${textOf(reply)}`).toBeUndefined();
    }
    const names = ctx
      .current()
      ?.store.getState()
      .doc.features.map((f) => f.name);
    expect(names).toEqual(['Plate', 'Upright', 'Fillet1', 'Hole A', 'Hole B']);
  });
});
