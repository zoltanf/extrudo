// The profile worker (ADR-0154): finds the regions of a sketch that isn't open
// and builds its fill, off the UI thread. One job at a time, in the order the
// client sends them; nothing is kept between jobs but the fonts. The regions go
// back first, then the fill: a job stopped at its deadline (the client terminates
// this worker) still leaves its regions to pick. Arrays the budget can't keep are
// neither sent nor built.

import { buildFill, fillBytes, findRegions } from './regionsJob';
import type { RegionsReply, RegionsRequest } from './regionsProtocol';

const post = (reply: RegionsReply, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(reply, transfer);

const wait = (ms: number | undefined) =>
  ms ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined;

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
    const found = findRegions(request.data);
    await wait(request.delay);
    if ('refused' in found) {
      post({ job, refused: found.refused });
      return;
    }
    const { regions, regionBytes, vertices } = found;
    const sendRegions = regionBytes <= request.maxBytes;
    const fill =
      sendRegions && regionBytes + fillBytes(vertices, regions.ids.length) <= request.maxBytes;
    post(
      {
        job,
        regionBytes,
        count: regions.ids.length,
        vertices,
        fill,
        ...(sendRegions && { regions }),
      },
      sendRegions
        ? [
            regions.areas.buffer,
            regions.loops.buffer,
            regions.points.buffer,
            regions.xy.buffer,
            regions.boxes.buffer,
          ]
        : [],
    );
    if (!fill) return;
    const built = buildFill(found);
    post({ job, fill: built }, built ? [built.positions.buffer, built.starts.buffer] : []);
  } catch (error) {
    post({ job, error: error instanceof Error ? error.message : String(error) });
  }
}

// A first, tiny job while the worker starts, so a design's first real job doesn't pay for
// the engine's warm-up (and a quick design never shows "Finding profiles…").
try {
  const p = (x: number, y: number) => ({ type: 'point', x, y });
  const found = findRegions({
    entities: {
      a: p(0, 0),
      b: p(1, 0),
      c: p(1, 1),
      ab: { type: 'line', start: 'a', end: 'b', construction: false },
      bc: { type: 'line', start: 'b', end: 'c', construction: false },
      ca: { type: 'line', start: 'c', end: 'a', construction: false },
    },
    constraints: {},
    dimensions: {},
  } as never);
  if (!('refused' in found)) buildFill(found);
} catch {
  // Only a warm-up.
}

// Messages are handled one after another: a font finishes loading before the job after it.
let chain = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<RegionsRequest>) => {
  chain = chain.then(() => handle(data));
};
