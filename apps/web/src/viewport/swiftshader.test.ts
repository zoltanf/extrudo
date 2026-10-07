import { describe, expect, it } from 'vitest';
import {
  chromiumBrand,
  currentSwiftshaderLaunch,
  desktopOs,
  gpuPage,
  swiftshaderCommand,
} from './swiftshader';

const URL = 'https://example.test/';
const CHROME_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('chromiumBrand', () => {
  it('reads userAgentData brands first', () => {
    expect(
      chromiumBrand('', { brands: [{ brand: 'Not A;Brand' }, { brand: 'Google Chrome' }] }),
    ).toBe('chrome');
    expect(
      chromiumBrand('', { brands: [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }] }),
    ).toBe('edge');
    expect(chromiumBrand('', { brands: [{ brand: 'Chromium' }] })).toBe('chromium');
    expect(chromiumBrand('', { brands: [{ brand: 'Brave' }] })).toBe('other');
  });
  it('falls back to the user agent', () => {
    expect(chromiumBrand(CHROME_LINUX)).toBe('chrome');
    expect(chromiumBrand(EDGE_WIN)).toBe('edge');
    expect(chromiumBrand('Mozilla/5.0 (X11) Chromium/152.0 Chrome/152.0')).toBe('chromium');
  });
  it('is undefined for Firefox and Safari', () => {
    expect(chromiumBrand(FIREFOX)).toBeUndefined();
    expect(chromiumBrand(SAFARI)).toBeUndefined();
  });
});

describe('desktopOs', () => {
  it('reads the platform or the user agent', () => {
    expect(desktopOs('', { platform: 'Windows' })).toBe('windows');
    expect(desktopOs('', { platform: 'macOS' })).toBe('macos');
    expect(desktopOs(CHROME_LINUX)).toBe('linux');
    expect(desktopOs(EDGE_WIN)).toBe('windows');
  });
  it('offers nothing on ChromeOS, Android and iOS', () => {
    expect(desktopOs('Mozilla/5.0 (X11; CrOS x86_64 1) Chrome/152')).toBeUndefined();
    expect(desktopOs('Mozilla/5.0 (Linux; Android 14) Chrome/152')).toBeUndefined();
    expect(desktopOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBeUndefined();
  });
});

describe('swiftshaderCommand', () => {
  const flags = '--enable-unsafe-swiftshader --use-angle=swiftshader --app=https://example.test/';
  it.each([
    ['chrome', 'google-chrome'],
    ['edge', 'microsoft-edge'],
    ['chromium', 'chromium'],
  ] as const)('linux %s', (brand, bin) => {
    expect(swiftshaderCommand(brand, 'linux', URL)).toBe(
      `${bin} --user-data-dir="$HOME/.config/extrudo-software-gl" ${flags}`,
    );
  });
  it.each([
    ['chrome', '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'],
    ['edge', '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"'],
    ['chromium', 'chromium.exe'],
  ] as const)('windows %s', (brand, bin) => {
    expect(swiftshaderCommand(brand, 'windows', URL)).toBe(
      `${bin} --user-data-dir="%LOCALAPPDATA%\\Extrudo-Software-GL" ${flags}`,
    );
  });
  it.each([
    ['chrome', 'Google Chrome'],
    ['edge', 'Microsoft Edge'],
    ['chromium', 'Chromium'],
  ] as const)('macos %s', (brand, app) => {
    expect(swiftshaderCommand(brand, 'macos', URL)).toBe(
      `open -na "${app}" --args --user-data-dir="$HOME/Library/Application Support/Extrudo-Software-GL" ${flags}`,
    );
  });
  it('is undefined for Firefox or a phone', () => {
    expect(currentSwiftshaderLaunch({ userAgent: FIREFOX }, URL)).toBeUndefined();
    expect(
      currentSwiftshaderLaunch({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/152' }, URL),
    ).toBeUndefined();
    expect(currentSwiftshaderLaunch({ userAgent: CHROME_LINUX }, URL)).toEqual({
      command: expect.stringContaining('google-chrome'),
    });
  });

  it('gives other Chromium browsers the flags, not a program name', () => {
    const brave = {
      userAgent: CHROME_LINUX,
      userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Brave' }] },
    };
    expect(chromiumBrand(brave.userAgent, brave.userAgentData)).toBe('other');
    expect(currentSwiftshaderLaunch(brave, URL)).toEqual({
      flags: '--enable-unsafe-swiftshader --use-angle=swiftshader',
    });
    expect(chromiumBrand(`${CHROME_LINUX} OPR/110.0`)).toBe('other');
    expect(chromiumBrand(`${CHROME_LINUX} Vivaldi/6.8`)).toBe('other');
    expect(chromiumBrand('', { brands: [{ brand: 'Whale' }] })).toBe('other');
  });
});

describe('gpuPage', () => {
  it('is edge://gpu on Edge and chrome://gpu otherwise', () => {
    expect(gpuPage({ userAgent: EDGE_WIN })).toBe('edge://gpu');
    expect(gpuPage({ userAgent: CHROME_LINUX })).toBe('chrome://gpu');
    expect(gpuPage({ userAgent: FIREFOX })).toBe('chrome://gpu');
  });
});
