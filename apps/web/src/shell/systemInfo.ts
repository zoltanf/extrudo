/**
 * What the About dialog says about where the app runs: browser, OS, GPU and
 * rendering, memory and storage. Everything comes from the browser's own APIs; nothing
 * leaves the machine unless the person copies it into a bug report. Fields a
 * browser doesn't expose (device memory outside Chromium) are left out.
 */

export interface InfoRow {
  label: string;
  value: string;
}

interface UADataValues {
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  bitness?: string;
  fullVersionList?: { brand: string; version: string }[];
}
interface UAData {
  platform: string;
  getHighEntropyValues(hints: string[]): Promise<UADataValues>;
}

const MB = 1024 * 1024;
export const formatBytes = (bytes: number) =>
  bytes >= 1024 * MB
    ? `${(bytes / (1024 * MB)).toFixed(1)} GB`
    : bytes >= MB
      ? `${Math.round(bytes / MB)} MB`
      : `${Math.round(bytes / 1024)} kB`;

/** "under a minute", "12 min", "1 h 12 min", "2 d 3 h". */
export function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'under a minute';
  const [d, h, m] = [Math.floor(min / 1440), Math.floor(min / 60) % 24, min % 60];
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/** Browser name and version, from Client Hints where the browser has them, else the user agent. */
async function browser(): Promise<{ browser: string; os: string }> {
  const ua = navigator.userAgent;
  const electron = ua.match(/Electron\/([\d.]+)/)?.[1];
  const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  if (uaData) {
    const v = await uaData
      .getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'fullVersionList'])
      .catch((): UADataValues => ({}));
    const brands = v.fullVersionList?.filter((b) => !/Not.?A.?Brand/i.test(b.brand)) ?? [];
    const main =
      brands.find((b) => !/^Chromium$/.test(b.brand)) ?? brands.find((b) => b.brand === 'Chromium');
    const chromium = brands.find((b) => b.brand === 'Chromium')?.version;
    const name = electron
      ? `Electron ${electron} · Chromium ${chromium ?? ''}`.trim()
      : main
        ? `${main.brand} ${main.version}`
        : 'Chromium';
    const arch = [v.architecture, v.bitness && `${v.bitness}-bit`].filter(Boolean).join(' ');
    const platform = v.platform ?? uaData.platform;
    const os = [platform, platform === 'Linux' ? '' : v.platformVersion, arch && `(${arch})`]
      .filter(Boolean)
      .join(' ');
    return { browser: name, os };
  }
  const firefox = ua.match(/Firefox\/([\d.]+)/)?.[1];
  const safari = !firefox && ua.match(/Version\/([\d.]+).*Safari/)?.[1];
  const os = /Mac OS X/.test(ua)
    ? 'macOS'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /Linux/.test(ua)
          ? 'Linux'
          : navigator.platform;
  return {
    browser: firefox ? `Firefox ${firefox}` : safari ? `Safari ${safari}` : ua,
    os,
  };
}

/** Renderer strings of software rasterisers (no GPU in the path). */
const SOFTWARE = /SwiftShader|llvmpipe|softpipe|Software|Basic Render Driver/i;

/**
 * The GPU's name as WebGL reports it, and how the page renders: the WebGL
 * version, the backend ANGLE translates to, and whether a GPU does the work
 * (a context that refuses a major performance caveat fails on a software
 * rasteriser). From throwaway contexts.
 */
function graphics(): { gpu?: string; rendering: string } {
  try {
    const canvas = () => document.createElement('canvas');
    const gl2 = canvas().getContext('webgl2');
    const gl = gl2 ?? canvas().getContext('webgl');
    if (!gl) return { rendering: 'WebGL unavailable' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const caveat: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };
    const fast = gl2 ? canvas().getContext('webgl2', caveat) : canvas().getContext('webgl', caveat);
    for (const c of [gl, fast]) c?.getExtension('WEBGL_lose_context')?.loseContext();
    // "ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti (0x00001C82) Direct3D11 vs_5_0 ps_5_0, D3D11)"
    // "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"
    const gpu = /SwiftShader/i.test(raw)
      ? 'SwiftShader'
      : raw
          .replace(/^ANGLE \((.*)\)$/, '$1')
          .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
          .replace(/,\s*(OpenGL|D3D11|Vulkan|Metal).*$/i, '')
          // "AMD, AMD Radeon Graphics" → "AMD Radeon Graphics"
          .replace(/^([^,]+), (\1\b)/, '$2');
    const backend =
      raw.match(/,\s*((?:OpenGL ES|OpenGL|Vulkan)(?: [\d.]+)?|D3D11|D3D9|Metal)/i)?.[1] ??
      // "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)"
      (/\bANGLE Metal\b/.test(raw) ? 'Metal' : undefined);
    const software = !fast || SOFTWARE.test(raw);
    return {
      gpu,
      rendering: [
        `WebGL ${gl2 ? 2 : 1}${backend ? ` on ${backend}` : ''}`,
        software ? 'software rendering, slow' : 'hardware accelerated',
      ].join(' · '),
    };
  } catch {
    return { rendering: 'WebGL unavailable' };
  }
}

function appMode(desktop: boolean): string {
  if (desktop) return 'Desktop app';
  const installed =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches;
  return installed ? 'Web app, installed' : 'Web app, in a browser tab';
}

/** The kernel worker's state, read when the dialog opens. */
export type KernelInfo = () => Promise<{
  status: string;
  restarts: number;
  heap: { top: number; size: number };
}>;

const present = (rows: (InfoRow | false | undefined)[]) =>
  rows.filter((r): r is InfoRow => Boolean(r));

/** The rows under "Running on", and under "Memory and storage". */
export async function systemInfo(
  desktop: boolean,
  kernelInfo?: KernelInfo,
): Promise<{ running: InfoRow[]; storage: InfoRow[] }> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const [{ browser: name, os }, estimate, persisted, kernel] = await Promise.all([
    browser(),
    navigator.storage?.estimate?.().catch(() => undefined),
    navigator.storage?.persisted?.().catch(() => undefined),
    kernelInfo?.().catch(() => undefined),
  ]);
  const { gpu, rendering } = graphics();
  const running = present([
    { label: 'App', value: appMode(desktop) },
    { label: 'Open for', value: formatDuration(performance.now()) },
    { label: 'Browser', value: name },
    { label: 'System', value: os },
    {
      label: 'Processor',
      value: `${nav.hardwareConcurrency} threads${nav.deviceMemory ? ` · ${nav.deviceMemory >= 8 ? '8 GB or more' : `${nav.deviceMemory} GB`} RAM` : ''}`,
    },
    gpu !== undefined && { label: 'Graphics', value: gpu },
    { label: 'Rendering', value: rendering },
    {
      label: 'Screen',
      value: `${screen.width} × ${screen.height} at ${Math.round(devicePixelRatio * 100)}%`,
    },
    {
      label: 'Window',
      value: `${innerWidth} × ${innerHeight}${document.documentElement.dataset.theme ? `, ${document.documentElement.dataset.theme} theme` : ''}`,
    },
    kernel && {
      label: 'Kernel worker',
      value: `${kernel.status}, ${kernel.restarts} ${kernel.restarts === 1 ? 'restart' : 'restarts'} · ${formatBytes(kernel.heap.top)} in use of ${formatBytes(kernel.heap.size)} WASM memory`,
    },
    { label: 'Language', value: navigator.language },
    {
      label: 'Isolation',
      value: crossOriginIsolated ? 'Cross-origin isolated' : 'Not cross-origin isolated',
    },
    {
      label: 'Service worker',
      value: navigator.serviceWorker?.controller ? 'Controls this page' : 'None',
    },
  ]);
  const storage = present([
    memory && { label: 'Interface memory', value: `${formatBytes(memory.usedJSHeapSize)} JS heap` },
    estimate?.quota !== undefined && {
      label: 'Storage',
      value: `${formatBytes(estimate.usage ?? 0)} used of ${formatBytes(estimate.quota)}${persisted ? ', persistent' : ''}`,
    },
  ]);
  return { running, storage };
}
