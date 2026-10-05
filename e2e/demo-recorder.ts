import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';

// Records the tools' demo clips (P3-12, FR-UX-04, ADR-0052). A clip is made
// from the real app: the spec drives it, this loop takes JPEG screenshots of
// the view as fast as the page allows, they are laid on a constant 15 fps
// timeline by when each was taken, and Playwright's own ffmpeg (VP8 only, no
// other codec) encodes them to a small WebM. The OS cursor isn't in a
// screenshot, so the page gets a drawn one (`CURSOR_SCRIPT`).

export const FPS = 15;
/** Clip size in px; the tooltip shows it at 236 × 148 (8:5), so it is sharp on a 2× screen. */
export const DEMO_SIZE = { width: 480, height: 300 } as const;
/** The aspect of a clip: wide enough for a dialog beside the model. */
const ASPECT = DEMO_SIZE.width / DEMO_SIZE.height;

/** Playwright's ffmpeg (`playwright install ffmpeg`), `FFMPEG`, or one on the PATH. */
export function findFfmpeg(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (platform() === 'darwin'
      ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
      : platform() === 'win32'
        ? join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright')
        : join(homedir(), '.cache', 'ms-playwright'));
  const binary =
    platform() === 'darwin'
      ? 'ffmpeg-mac'
      : platform() === 'win32'
        ? 'ffmpeg-win64.exe'
        : 'ffmpeg-linux';
  if (existsSync(root)) {
    for (const dir of readdirSync(root).filter((d) => d.startsWith('ffmpeg-'))) {
      const candidate = join(root, dir, binary);
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'ffmpeg';
}

/** A pointer drawn into the page: an arrow, and a ring where the button goes down. */
export const CURSOR_SCRIPT = `
(() => {
  const mount = () => {
    if (document.getElementById('demo-cursor')) return;
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    cursor.innerHTML =
      '<div id="demo-ring" style="position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:3px solid #ffb23e;opacity:0;transform:scale(.4)"></div>' +
      '<svg width="22" height="28" viewBox="0 0 22 28" style="position:absolute;left:-1px;top:-1px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"><path d="M2 2 L2 22 L7.5 17 L11 25.5 L14.5 24 L11 15.8 L18.5 15.8 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cursor);
    const ring = cursor.querySelector('#demo-ring');
    addEventListener('mousemove', (e) => {
      cursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    }, true);
    addEventListener('mousedown', (e) => {
      cursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
      ring.animate(
        [{ opacity: 1, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.5)' }],
        { duration: 380, easing: 'ease-out' },
      );
    }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;

/** Keeps what isn't part of a demo out of the frame: the onboarding hint and card. */
export const DEMO_STYLE = `
[data-viewport-hint], [aria-label="Tutorial"], [data-tutorial-ring] { display: none !important; }
`;

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of the view a clip shows: the full height of the work area, 8:5, from its right edge. */
export function clipOf(box: { x: number; y: number; width: number; height: number }): Clip {
  const width = Math.min(box.width, Math.round(box.height * ASPECT));
  const height = Math.round(width / ASPECT);
  return { x: box.x + box.width - width, y: box.y, width, height };
}

interface Frame {
  at: number;
  jpeg: Buffer;
}

export class Recorder {
  readonly frames: Frame[] = [];
  #running = false;
  #loop: Promise<void> | undefined;

  constructor(
    private readonly page: Page,
    private readonly clip: Clip,
  ) {}

  /** Takes screenshots until `stop`, one after another. */
  start(): void {
    this.#running = true;
    this.#loop = (async () => {
      while (this.#running) {
        const at = performance.now();
        const jpeg = await this.page.screenshot({ type: 'jpeg', quality: 88, clip: this.clip });
        this.frames.push({ at, jpeg });
      }
    })();
  }

  async stop(): Promise<void> {
    this.#running = false;
    await this.#loop;
  }

  /** The frames at a constant rate: each slot gets the latest frame taken by then, and the last one is held. */
  resample(holdMs = 600): Buffer[] {
    const first = this.frames[0];
    const last = this.frames.at(-1);
    if (!first || !last) throw new Error('nothing was recorded');
    const step = 1000 / FPS;
    const count = Math.floor((last.at - first.at) / step) + 1;
    const out: Buffer[] = [];
    let cursor = 0;
    for (let k = 0; k < count; k++) {
      const t = first.at + k * step;
      while (this.frames[cursor + 1] && (this.frames[cursor + 1] as Frame).at <= t) cursor++;
      out.push((this.frames[cursor] as Frame).jpeg);
    }
    for (let k = 0; k < Math.round((holdMs / 1000) * FPS); k++) out.push(last.jpeg);
    return out;
  }

  /** Encodes the clip to `out` (a `.webm`) and returns its length in seconds. */
  async encode(
    out: string,
    options: {
      crf?: number;
      holdMs?: number;
      /** Output size; a tool demo's 480 × 300 unless given. */
      size?: { width: number; height: number };
      bitrate?: string;
    } = {},
  ): Promise<number> {
    const size = options.size ?? DEMO_SIZE;
    const frames = this.resample(options.holdMs);
    await mkdir(dirname(out), { recursive: true });
    const args = [
      ['-y', '-loglevel', 'error'],
      ['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0'],
      ['-vf', `scale=${size.width}:${size.height}:flags=lanczos`],
      // Constrained quality: the UI is flat colour, so a high CRF still looks clean.
      ['-c:v', 'libvpx', '-b:v', options.bitrate ?? '600k', '-crf', String(options.crf ?? 30)],
      ['-pix_fmt', 'yuv420p', '-auto-alt-ref', '0', '-an', out],
    ].flat();
    const child = spawn(findFfmpeg(), args, { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)),
      );
    });
    for (const frame of frames) {
      if (!child.stdin.write(frame)) {
        await new Promise((resolve) => child.stdin.once('drain', resolve));
      }
    }
    child.stdin.end();
    await done;
    return frames.length / FPS;
  }
}
