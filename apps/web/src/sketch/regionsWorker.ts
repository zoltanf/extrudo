// The profile worker (ADR-0154): finds the regions of a sketch that isn't open
// and builds its fill, off the UI thread. One job at a time, in the order the
// client sends them; nothing is kept between jobs but the fonts. The client
// stops a job that runs past its deadline by terminating this worker.
import { regionsOf } from './regionsJob';
import type { RegionsReply, RegionsRequest } from './regionsProtocol';

const post = (reply: RegionsReply, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(reply, transfer);

async function handle(request: RegionsRequest): Promise<void> {
  if (request.type === 'font') {
    const text = await import('@extrudo/sketch/text');
    try {
      text.loadFont(request.id, request.bytes);
    } catch {
      // A font that doesn't parse: its text has no ink here, as on the UI thread.
    }
    return;
  }
  const { job } = request;
  post({ job, started: true });
  try {
    const result = regionsOf(request.data, request.maxFillVertices);
    if (request.delay) await new Promise((resolve) => setTimeout(resolve, request.delay));
    if (result.refused !== undefined || !result.regions) {
      post({ job, refused: result.refused ?? '' });
      return;
    }
    const { regions, fill, vertices } = result;
    const transfer: Transferable[] = [
      regions.areas.buffer,
      regions.loops.buffer,
      regions.points.buffer,
      regions.xy.buffer,
      regions.boxes.buffer,
    ];
    if (fill) transfer.push(fill.positions.buffer, fill.starts.buffer);
    post({ job, regions, vertices, ...(fill && { fill }) }, transfer);
  } catch (error) {
    post({ job, error: error instanceof Error ? error.message : String(error) });
  }
}

// A first, tiny job while the worker starts, so a design's first real job doesn't pay for
// the engine's warm-up (and a quick design never shows "Finding profiles…").
const square = (['a', 'b', 'c', 'd'] as const).map(
  (id, i) => [id, [i % 3 === 0 ? 0 : 1, i < 2 ? 0 : 1]] as const,
);
try {
  const entities: Record<string, unknown> = {};
  square.forEach(([id, [x, y]], i) => {
    const [next] = square[(i + 1) % 4] as (typeof square)[number];
    entities[id] = { type: 'point', x, y };
    entities[`${id}2`] = {
      type: 'point',
      x: square[(i + 1) % 4]?.[1][0],
      y: square[(i + 1) % 4]?.[1][1],
    };
    entities[`${id}${next}`] = { type: 'line', start: id, end: `${id}2`, construction: false };
  });
  regionsOf({ entities, constraints: {}, dimensions: {} } as never, Number.POSITIVE_INFINITY);
} catch {
  // Only a warm-up.
}

// Messages are handled one after another: a font finishes loading before the job after it.
let chain = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<RegionsRequest>) => {
  chain = chain.then(() => handle(data));
};
