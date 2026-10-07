/**
 * Chromium's GPU switches (ADR-0076 §7), decided as a pure function so a unit
 * test can check them without an Electron binary.
 *
 * `enable-unsafe-swiftshader` lets a machine with no usable GPU get SwiftShader
 * WebGL instead of none. The "unsafe" is about untrusted web content reaching
 * SwiftShader; this app loads only its own `app://` content and blocks
 * navigation elsewhere (ADR-0075), so the risk does not apply.
 * `--software-rendering` or `EXTRUDO_SOFTWARE_RENDERING=1` turns the GPU off
 * and names SwiftShader as the ANGLE backend: the escape hatch for a buggy driver.
 */
export interface RenderingPlan {
  /** Switches for `app.commandLine.appendSwitch(name, value?)`. */
  switches: { name: string; value?: string }[];
  /** Whether to call `app.disableHardwareAcceleration()`. */
  disableHardwareAcceleration: boolean;
}

export function renderingPlan(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): RenderingPlan {
  const software =
    argv.includes('--software-rendering') ||
    (env.EXTRUDO_SOFTWARE_RENDERING !== undefined &&
      env.EXTRUDO_SOFTWARE_RENDERING !== '' &&
      env.EXTRUDO_SOFTWARE_RENDERING !== '0');
  // With the GPU process disabled `enable-unsafe-swiftshader` alone gives no
  // WebGL (measured, Chromium 152); `use-angle=swiftshader` names the backend.
  const switches: RenderingPlan['switches'] = [{ name: 'enable-unsafe-swiftshader' }];
  if (software) switches.push({ name: 'use-angle', value: 'swiftshader' });
  return { switches, disableHardwareAcceleration: software };
}
