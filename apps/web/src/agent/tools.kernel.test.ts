/**
 * The agent tools against the real kernel: what an agent following the skill
 * does, recomputed, so body IDs, profiles and frames are the kernel's own.
 */
import { Design } from '@extrudo/api';
import { describe, expect, it } from 'vitest';
import type { AgentReply } from '../platform/agent';
import { kernelHost } from './kernelTesting';
import { fakeContext } from './testing';
import { runTool } from './tools';

const textOf = (reply: AgentReply) => (reply.result.content[0] as { text: string }).text;
const jsonOf = (reply: AgentReply) => JSON.parse(textOf(reply));

async function open() {
  const k = await kernelHost(Design.create({ name: 'Agent' }).toJSON());
  const ctx = fakeContext(k.host, [], { settleMs: 30_000 });
  const call = (name: string, args: Record<string, unknown> = {}) => runTool(name, args, ctx);
  return { ...k, call };
}

/** A sketch of one rectangle and its extrude; answers the extrude's id. */
async function plate(
  call: (name: string, args?: Record<string, unknown>) => Promise<AgentReply>,
  inputs: Record<string, unknown> = {},
  at: [number, number] = [0, 0],
) {
  const sketch = jsonOf(
    await call('add_sketch', {
      plane: 'xy',
      shapes: [{ shape: 'rectangle', from: at, to: [at[0] + 40, at[1] + 20] }],
    }),
  ).result;
  const added = jsonOf(
    await call('add_feature', {
      type: 'extrude',
      inputs: { profiles: sketch.profiles, distance: '5 mm', ...inputs },
    }),
  );
  expect(added.problems).toEqual([]);
  return added.result[0].id as string;
}

describe('the agent tools on the real kernel', { timeout: 60_000 }, () => {
  it('joins into a body named by its feature id, as the skill says (#84)', async () => {
    const { call, dispose } = await open();
    const first = await plate(call);
    const bodies = jsonOf(await call('get_bodies'));
    expect(bodies.map((b: { id: string }) => b.id)).toEqual([`${first}:0`]);

    const sketch = jsonOf(
      await call('add_sketch', {
        plane: 'xy',
        shapes: [{ shape: 'rectangle', from: [10, 5], to: [20, 15] }],
      }),
    ).result;
    const joined = jsonOf(
      await call('add_feature', {
        type: 'extrude',
        inputs: {
          profiles: sketch.profiles,
          distance: '10 mm',
          operation: 'join',
          bodies: [{ kind: 'body', id: first }],
        },
      }),
    );
    expect(joined.problems).toEqual([]);
    const after = jsonOf(await call('get_bodies'));
    expect(after).toHaveLength(1);
    expect(after[0].volume).toBeCloseTo(40 * 20 * 5 + 10 * 10 * 5, 3);
    dispose();
  });

  it('refuses a body that is not there with its path, and changes nothing (#84)', async () => {
    const { call, store, dispose } = await open();
    await plate(call);
    const before = store.getState().doc;
    const refused = await call('add_feature', {
      type: 'shell',
      inputs: { bodies: [{ kind: 'body', id: 'nothing:0' }], thickness: '1 mm' },
    });
    expect(refused.result.isError).toBe(true);
    expect(textOf(refused)).toMatch(/^bodies\.0: There is no body "nothing:0"/);
    expect(store.getState().doc).toBe(before);
    dispose();
  });

  it('asks which body when the feature made several', async () => {
    const { call, dispose } = await open();
    const sketch = jsonOf(
      await call('add_sketch', {
        plane: 'xy',
        shapes: [
          { shape: 'rectangle', from: [0, 0], to: [10, 10] },
          { shape: 'rectangle', from: [20, 0], to: [30, 10] },
        ],
      }),
    ).result;
    const two = jsonOf(
      await call('add_feature', {
        type: 'extrude',
        inputs: { profiles: sketch.profiles, distance: '5 mm' },
      }),
    ).result[0];
    const ids = jsonOf(await call('get_bodies')).map((b: { id: string }) => b.id);
    expect(ids).toEqual([`${two.id}:0`, `${two.id}:1`]);
    const refused = await call('add_feature', {
      type: 'shell',
      inputs: { bodies: [{ kind: 'body', id: two.id }], thickness: '1 mm' },
    });
    expect(textOf(refused)).toBe(
      `bodies.0: ${two.name} made 2 bodies: name one, ${two.id}:0, ${two.id}:1.`,
    );
    dispose();
  });
  it('colours two bodies, each one undo step (#83)', async () => {
    const { call, dispose } = await open();
    const a = await plate(call);
    const b = await plate(call, {}, [50, 0]);
    const red = jsonOf(await call('set_body_appearance', { id: `${a}:0`, color: '#FF0000' }));
    expect(red.done).toMatch(/^Agent: Change Body\d+$/);
    expect(red.result).toMatchObject({ id: `${a}:0`, color: '#ff0000', visible: true });
    await call('set_body_appearance', { id: b, color: '#00ff00', opacity: 0.5, name: 'Lid' });
    const bodies = jsonOf(await call('get_bodies'));
    expect(bodies.map((x: Record<string, unknown>) => [x.id, x.name, x.color, x.opacity])).toEqual([
      [`${a}:0`, expect.stringMatching(/^Body/), '#ff0000', undefined],
      [`${b}:0`, 'Lid', '#00ff00', 0.5],
    ]);
    expect(jsonOf(await call('undo')).undone).toMatch(/^Agent: Change Body\d+$/);
    const undone = jsonOf(await call('get_bodies'));
    expect(undone[1].color).toBeUndefined();
    expect(undone[0].color).toBe('#ff0000');
    const hidden = jsonOf(await call('set_body_appearance', { id: `${a}:0`, visible: false }));
    expect(hidden.result.visible).toBe(false);
    expect(textOf(await call('set_body_appearance', { id: 'x:0', color: '#000000' }))).toMatch(
      /^id: There is no body "x:0"/,
    );
    expect(textOf(await call('set_body_appearance', { id: `${a}:0`, color: 'red' }))).toBe(
      'color: A colour is #rrggbb.',
    );
    dispose();
  });
});
