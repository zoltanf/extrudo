import { crc32, deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';

// A screenshot reduced to an 8-bit, 256-colour palette PNG (median cut, no dither), done in a
// blank page of the same browser. Shared by the tutorials (`tutorials/step.ts`) and the guide's
// pictures (`guide-shots.spec.ts`): a full-colour shot of the app's gradient view is about
// 570 kB, the indexed one under 150 kB.

/** Median cut in a blank page of the same browser (the e2e code has no DOM, so it is a string). */
const QUANTIZE = `async (base64) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  // Histogram over 5 bits a channel.
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const bin = bins.get(key);
    if (bin) bin.n++;
    else bins.set(key, { key, n: 1, c: [(data[i] >> 3) << 3 | 4, (data[i + 1] >> 3) << 3 | 4, (data[i + 2] >> 3) << 3 | 4] });
  }
  const range = (box, ch) => {
    let lo = 255, hi = 0;
    for (const b of box) { lo = Math.min(lo, b.c[ch]); hi = Math.max(hi, b.c[ch]); }
    return hi - lo;
  };
  const boxes = [[...bins.values()]];
  while (boxes.length < 256) {
    let best = -1, bestRange = 0, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        const r = range(box, ch) * Math.sqrt(box.reduce((a, b) => a + b.n, 0));
        if (r > bestRange) { bestRange = r; best = i; bestCh = ch; }
      }
    });
    if (best < 0) break;
    const box = boxes[best].sort((a, b) => a.c[bestCh] - b.c[bestCh]);
    const total = box.reduce((a, b) => a + b.n, 0);
    let run = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { run += box[i].n; cut = i + 1; if (run >= total / 2) break; }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  const palette = [];
  const index = new Map();
  boxes.forEach((box, i) => {
    let n = 0, r = 0, g = 0, b = 0;
    for (const bin of box) { n += bin.n; r += bin.c[0] * bin.n; g += bin.c[1] * bin.n; b += bin.c[2] * bin.n; index.set(bin.key, i); }
    palette.push(Math.round(r / n), Math.round(g / n), Math.round(b / n));
  });
  const pixels = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < pixels.length; p++, i += 4) {
    pixels[p] = index.get(((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3));
  }
  let binary = '';
  for (let i = 0; i < pixels.length; i += 8192) binary += String.fromCharCode(...pixels.subarray(i, i + 8192));
  return { width, height, palette, pixels: btoa(binary) };
}`;

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** A screenshot as an 8-bit palette PNG. */
export async function indexed(page: Page, png: Buffer): Promise<Buffer> {
  const scratch = await page.context().newPage();
  try {
    const image = (await scratch.evaluate(`(${QUANTIZE})('${png.toString('base64')}')`)) as {
      width: number;
      height: number;
      palette: number[];
      pixels: string;
    };
    const pixels = Buffer.from(image.pixels, 'base64');
    // Filter type 1 (Sub) on each row compresses flat areas and gradients better than none.
    const rows = Buffer.alloc((image.width + 1) * image.height);
    for (let y = 0; y < image.height; y++) {
      const out = y * (image.width + 1);
      rows[out] = 1;
      for (let x = 0; x < image.width; x++) {
        const here = pixels[y * image.width + x] as number;
        const left = x > 0 ? (pixels[y * image.width + x - 1] as number) : 0;
        rows[out + 1 + x] = (here - left) & 255;
      }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(image.width, 0);
    header.writeUInt32BE(image.height, 4);
    header.set([8, 3, 0, 0, 0], 8);
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('PLTE', Buffer.from(image.palette)),
      chunk('IDAT', deflateSync(rows, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  } finally {
    await scratch.close();
  }
}
