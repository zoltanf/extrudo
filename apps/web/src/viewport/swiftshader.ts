/**
 * The launch command for a Chromium-based browser that draws WebGL in software
 * (ADR-0076): shown by the no-WebGL panel. Pure, so every brand and OS is a
 * unit test. The command starts a separate profile and window; the flag lets
 * websites run graphics code on the processor, which Chrome keeps off by
 * default, so it is never turned on for the normal profile.
 */
/** `other` is any other Chromium-based browser (Brave, Opera, Vivaldi…): no program name to offer. */
export type ChromiumBrand = 'chrome' | 'edge' | 'chromium' | 'other';
type NamedBrand = Exclude<ChromiumBrand, 'other'>;
export type DesktopOs = 'windows' | 'macos' | 'linux';

interface Brands {
  brands?: readonly { brand: string }[];
  platform?: string;
}

/** The Chromium-based browser, or undefined for Firefox, Safari or unknown. */
export function chromiumBrand(userAgent: string, data?: Brands): ChromiumBrand | undefined {
  const names = data?.brands?.map((b) => b.brand) ?? [];
  if (/Firefox\/|FxiOS\//.test(userAgent)) return undefined;
  if (
    names.some((n) => /Brave|Opera|Vivaldi/i.test(n)) ||
    /OPR\/|Opera|Vivaldi\/|Brave/.test(userAgent)
  )
    return 'other';
  if (names.some((n) => /Microsoft Edge/i.test(n))) return 'edge';
  if (names.some((n) => /Google Chrome/i.test(n))) return 'chrome';
  if (names.some((n) => /^Chromium$/i.test(n))) return 'chromium';
  if (/Edg\//.test(userAgent)) return 'edge';
  if (/Chrome\//.test(userAgent) && !/OPR\/|Chromium\//.test(userAgent)) return 'chrome';
  if (/Chromium\//.test(userAgent)) return 'chromium';
  if (names.length > 0) return 'other'; // another Chromium-based browser
  return undefined;
}

/** The desktop OS, or undefined for ChromeOS, Android, iOS and unknown. */
export function desktopOs(userAgent: string, data?: Brands): DesktopOs | undefined {
  if (/Android|iPhone|iPad|CrOS/.test(userAgent)) return undefined;
  const platform = data?.platform ?? '';
  if (/windows/i.test(platform) || /Windows/.test(userAgent)) return 'windows';
  if (/macos/i.test(platform) || /Macintosh|Mac OS X/.test(userAgent)) return 'macos';
  if (/linux/i.test(platform) || /Linux|X11/.test(userAgent)) return 'linux';
  return undefined;
}

const FLAGS = '--enable-unsafe-swiftshader --use-angle=swiftshader';

const LINUX: Record<NamedBrand, string> = {
  chrome: 'google-chrome',
  edge: 'microsoft-edge',
  chromium: 'chromium',
};
const WINDOWS: Record<NamedBrand, string> = {
  chrome: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
  edge: '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
  chromium: 'chromium.exe',
};
const MAC: Record<NamedBrand, string> = {
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  chromium: 'Chromium',
};

/** `url` is where the app is served (`location.origin + '/'`), never a fixed domain. */
export function swiftshaderCommand(brand: NamedBrand, os: DesktopOs, url: string): string {
  switch (os) {
    case 'linux':
      return `${LINUX[brand]} --user-data-dir="$HOME/.config/extrudo-software-gl" ${FLAGS} --app=${url}`;
    case 'windows':
      return `${WINDOWS[brand]} --user-data-dir="%LOCALAPPDATA%\\Extrudo-Software-GL" ${FLAGS} --app=${url}`;
    case 'macos':
      return `open -na "${MAC[brand]}" --args --user-data-dir="$HOME/Library/Application Support/Extrudo-Software-GL" ${FLAGS} --app=${url}`;
  }
}

export const SWIFTSHADER_FLAGS = FLAGS;

/** What to offer this browser: a full command, only the flags (other Chromium browsers), or nothing. */
export type SwiftshaderLaunch = { command: string } | { flags: string };

export function currentSwiftshaderLaunch(
  nav: { userAgent: string; userAgentData?: Brands },
  url: string,
): SwiftshaderLaunch | undefined {
  const brand = chromiumBrand(nav.userAgent, nav.userAgentData);
  const os = desktopOs(nav.userAgent, nav.userAgentData);
  if (!brand || !os) return undefined;
  if (brand === 'other') return { flags: FLAGS };
  return { command: swiftshaderCommand(brand, os, url) };
}

/** The `chrome://gpu` page for this browser (`edge://gpu` on Edge). */
export function gpuPage(nav: { userAgent: string; userAgentData?: Brands }): string {
  return chromiumBrand(nav.userAgent, nav.userAgentData) === 'edge' ? 'edge://gpu' : 'chrome://gpu';
}
