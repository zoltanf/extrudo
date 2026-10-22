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
/** A box to 0.01 mm (an arc's extent comes from its tessellation; `+ 0` turns -0 into 0). */
const roundBox = ({ box }: { box: { min: number[]; max: number[] } }) => ({
  min: box.min.map((v) => Math.round(v * 100) / 100 + 0),
  max: box.max.map((v) => Math.round(v * 100) / 100 + 0),
});

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
  it('tells a ring from the hole inside it by area, holes and shapes (#85)', async () => {
    const { call, dispose } = await open();
    const sketch = jsonOf(
      await call('add_sketch', {
        plane: 'xy',
        shapes: [
          { shape: 'rectangle', from: [0, 0], to: [40, 30] },
          { shape: 'rectangle', from: [10, 10], to: [30, 20] },
        ],
      }),
    ).result;
    expect(sketch.regions).toHaveLength(2);
    expect(sketch.regions.map((r: { profile: unknown }) => r.profile)).toEqual(sketch.profiles);
    const ring = sketch.regions.find((r: { holes: unknown[] }) => r.holes.length === 1);
    const inner = sketch.regions.find((r: { holes: unknown[] }) => r.holes.length === 0);
    expect(ring).toMatchObject({
      area: 40 * 30 - 20 * 10,
      box: { min: [0, 0], max: [40, 30] },
      centroid: [20, 15],
      shapes: [0, 1],
    });
    expect(ring.outer).toHaveLength(4);
    expect(inner).toMatchObject({ area: 200, box: { min: [10, 10], max: [30, 20] }, shapes: [1] });
    // get_feature answers the same regions, without shapes.
    const detail = jsonOf(await call('get_feature', { id: sketch.id }));
    expect(detail.regions.map((r: { area: number }) => r.area)).toEqual(
      sketch.regions.map((r: { area: number }) => r.area),
    );
    expect(detail.regions[0].shapes).toBeUndefined();
    // Extruding the ring alone makes the hollow frame.
    await call('add_feature', {
      type: 'extrude',
      inputs: { profiles: [ring.profile], distance: '5 mm' },
    });
    expect(jsonOf(await call('get_bodies'))[0].volume).toBeCloseTo(1000 * 5, 3);
    dispose();
  });
  it("answers a sketch's frame, on origin and construction planes, and curve references (#86)", async () => {
    const { call, dispose } = await open();
    const front = jsonOf(
      await call('add_sketch', {
        plane: 'xz',
        shapes: [{ shape: 'rectangle', from: [0, 0], to: [10, 10] }],
      }),
    ).result;
    expect(front.frame).toEqual({
      origin: [0, 0, 0],
      xDir: [1, 0, 0],
      yDir: [0, 0, 1],
      normal: [0, -1, 0],
    });
    const [plane] = jsonOf(
      await call('add_feature', {
        type: 'offsetPlane',
        inputs: { plane: { kind: 'plane', id: 'origin:xz' }, distance: '-60 mm' },
      }),
    ).result;
    const onPlane = jsonOf(
      await call('add_sketch', {
        plane: { kind: 'plane', id: plane.id },
        shapes: [
          { shape: 'rectangle', from: [5, 0], to: [10, 10] },
          { shape: 'line', from: [0, 0], to: [0, 10] },
        ],
      }),
    );
    expect(onPlane.problems).toEqual([]);
    expect(onPlane.result.frame.origin).toEqual([0, 60, 0]);
    expect(onPlane.result.frame.normal).toEqual([0, -1, 0]);
    const detail = jsonOf(await call('get_feature', { id: onPlane.result.id }));
    expect(detail.frame).toEqual(onPlane.result.frame);
    const axis = detail.curves.at(-1);
    expect(axis.ref).toEqual({ kind: 'sketchEntity', id: `${onPlane.result.id}/${axis.id}` });
    // A revolve about that line: a tube 10 mm tall from r = 5 to r = 10.
    const revolved = jsonOf(
      await call('add_feature', {
        type: 'revolve',
        inputs: { profiles: onPlane.result.profiles, axis: axis.ref },
      }),
    );
    expect(revolved.problems).toEqual([]);
    const bodies = jsonOf(await call('get_bodies'));
    expect(bodies.at(-1).volume).toBeCloseTo(Math.PI * (100 - 25) * 10, 0);
    dispose();
  });
  it('finds overlapping bodies, not touching ones (#89)', async () => {
    const { call, dispose } = await open();
    const cube = async (x: number) =>
      jsonOf(
        await call('add_feature', {
          type: 'box',
          inputs: { length: '20 mm', width: '20 mm', height: '20 mm', x: `${x} mm` },
        }),
      ).result[0].id as string;
    const a = await cube(0);
    const b = await cube(10);
    const c = await cube(40);
    const d = await cube(60);
    expect(jsonOf(await call('check_interference'))).toEqual([
      {
        a: `${a}:0`,
        b: `${b}:0`,
        volume: 4000,
        box: { min: [0, -10, 0], max: [10, 10, 20] },
      },
    ]);
    // Only the two that touch face to face: nothing.
    expect(
      jsonOf(
        await call('check_interference', {
          bodies: [
            { kind: 'body', id: c },
            { kind: 'body', id: `${d}:0` },
          ],
        }),
      ),
    ).toEqual([]);
    dispose();
  });
  it('takes a floor plan: one body from the top, cut at z = 10, apart from the view (#88)', async () => {
    const { call, host, dispose } = await open();
    const asked: unknown[][] = [];
    host.snapshot = async (...args) => {
      asked.push(args);
      return new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    };
    const box = jsonOf(
      await call('add_feature', {
        type: 'box',
        inputs: { length: '20 mm', width: '20 mm', height: '20 mm' },
      }),
    ).result[0].id;
    // No inputs: as before.
    expect((await call('screenshot')).result.content[0]?.type).toBe('image');
    await call('screenshot', {
      view: 'top',
      bodies: [{ kind: 'body', id: box }],
      section: { plane: 'xy', offset: '10 mm' },
      overlays: false,
      size: 1024,
    });
    expect(asked).toEqual([
      [768, undefined],
      [
        1024,
        {
          view: 'top',
          overlays: false,
          bodies: [`${box}:0`],
          section: { origin: [0, 0, 10], normal: [0, 0, 1] },
        },
      ],
    ]);
    const refused = await call('screenshot', { section: { plane: 'xy', offset: 'ten' } });
    expect(textOf(refused)).toBe("section.offset: a number of mm or '10 mm'.");
    expect(textOf(await call('screenshot', { size: 100 }))).toMatch(/^size: /);
    dispose();
  });

  it('keeps expression coordinates as dimensions, so the sketch follows a parameter (#103)', async () => {
    const { call, dispose } = await open();
    await call('set_parameter', { name: 'wall_t', expression: '3 mm' });
    const sketch = jsonOf(
      await call('add_sketch', {
        plane: 'xy',
        shapes: [
          { shape: 'rectangle', from: ['-40 mm + wall_t', '-5 mm + wall_t'], to: [37, 52] },
          { shape: 'circle', center: [100, 'wall_t'], diameter: 4 },
          {
            shape: 'polyline',
            points: [
              ['150 mm + wall_t', 0],
              [170, 0],
              [170, 20],
            ],
            closed: true,
          },
          { shape: 'slot', from: [200, 0], to: [220, 0], width: '2 * wall_t' },
        ],
      }),
    ).result;
    const byX = (regions: { box: { min: number[]; max: number[] } }[]) =>
      regions.map(roundBox).sort((a, b) => (a.min[0] as number) - (b.min[0] as number));
    expect(byX(sketch.regions)).toEqual([
      { min: [-37, -2], max: [37, 52] },
      { min: [98, 1], max: [102, 5] },
      { min: [153, 0], max: [170, 20] },
      { min: [197, -3], max: [223, 3] },
    ]);
    const extrude = jsonOf(
      await call('add_feature', {
        type: 'extrude',
        inputs: { profiles: [sketch.profiles[0]], distance: '5 mm' },
      }),
    );
    expect(extrude.problems).toEqual([]);
    const box = async () => roundBox(jsonOf(await call('get_bodies'))[0]);
    expect(await box()).toEqual({ min: [-37, -2, 0], max: [37, 52, 5] });

    const changed = jsonOf(await call('set_parameter', { name: 'wall_t', expression: '5 mm' }));
    expect(changed.problems).toEqual([]);
    expect(await box()).toEqual({ min: [-35, 0, 0], max: [37, 52, 5] });
    // The other shapes followed too, and the polyline stayed closed.
    const after = jsonOf(await call('get_feature', { id: sketch.id }));
    expect(byX(after.regions)).toEqual([
      { min: [-35, 0], max: [37, 52] },
      { min: [98, 3], max: [102, 7] },
      { min: [155, 0], max: [170, 20] },
      { min: [195, -5], max: [225, 5] },
    ]);
    dispose();
  });

  it("draws an arc on its through point's side, whichever side that is (#104)", async () => {
    const { call, dispose } = await open();
    const sketch = jsonOf(
      await call('add_sketch', {
        plane: 'xz',
        shapes: [
          { shape: 'arc', start: [-72, 20], end: [-72, 52], through: [-88, 36] },
          { shape: 'line', from: [-72, 52], to: [-72, 20] },
          { shape: 'arc', start: [70, 20], end: [70, 52], through: [86, 36] },
          { shape: 'line', from: [70, 52], to: [70, 20] },
        ],
      }),
    ).result;
    const boxes = sketch.regions.map(roundBox);
    expect(boxes).toEqual(
      expect.arrayContaining([
        { min: [-88, 20], max: [-72, 52] },
        { min: [70, 20], max: [86, 52] },
      ]),
    );
    dispose();
  });
});
