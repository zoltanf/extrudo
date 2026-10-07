import { useState } from 'react';
import { Button } from '../design-system/Button';
import { currentSwiftshaderLaunch, gpuPage, type SwiftshaderLaunch } from './swiftshader';

/** The launch command for this browser, or undefined (not Chromium, or no desktop OS). */
function browserLaunch(): SwiftshaderLaunch | undefined {
  if (typeof navigator === 'undefined' || typeof location === 'undefined') return undefined;
  return currentSwiftshaderLaunch(
    navigator as unknown as Parameters<typeof currentSwiftshaderLaunch>[0],
    `${location.origin}/`,
  );
}

function browserGpuPage(): string {
  if (typeof navigator === 'undefined') return 'chrome://gpu';
  return gpuPage(navigator as unknown as Parameters<typeof gpuPage>[0]);
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => undefined,
        );
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/**
 * Drawn in place of the 3D view where the browser gives no WebGL 2 (ADR-0076).
 * The rest of the shell stays mounted, so the design stays usable. In a
 * Chromium-based browser it leads with a command that starts a separate window
 * drawing WebGL in software.
 */
export function NoWebgl({
  onRetry,
  detail,
  launch = browserLaunch(),
  gpu = browserGpuPage(),
}: {
  onRetry(): void;
  detail?: string;
  launch?: SwiftshaderLaunch | undefined;
  gpu?: string;
}) {
  const command = launch && 'command' in launch ? launch.command : undefined;
  return (
    <section
      aria-label="3D view unavailable"
      data-webgl="none"
      className="absolute inset-0 grid place-items-center overflow-auto p-6 text-ink"
    >
      <div className="flex max-w-[38rem] flex-col gap-3 rounded-dialog border border-line bg-raised p-6">
        <h2 className="text-lg font-semibold">Extrudo can't draw the 3D view in this browser</h2>
        <p className="text-muted">
          The 3D view needs WebGL 2, and this browser has it turned off or blocked.
        </p>
        {launch && 'flags' in launch && (
          <div className="flex flex-col gap-2" data-swiftshader-flags>
            <p className="font-semibold">Open a window that draws in software</p>
            <p className="text-muted">
              Start your browser with <code className="font-mono">{launch.flags}</code> and a
              separate <code className="font-mono">--user-data-dir</code>. This turns on software 3D
              for that one window only; the setting lets websites run graphics code on the
              processor, which browsers keep off by default for safety.
            </p>
          </div>
        )}
        {command && (
          <div className="flex flex-col gap-2" data-swiftshader>
            <p className="font-semibold">Open a window that draws in software</p>
            <p className="text-muted">
              Run this command in a terminal. It starts a separate browser window with software 3D:
            </p>
            <div className="flex items-start gap-2">
              <code
                data-swiftshader-command
                className="min-w-0 flex-1 rounded-control border border-line bg-bg p-2 font-mono text-field break-all select-all"
              >
                {command}
              </code>
              <CopyButton text={command} label="Copy command" />
            </div>
            <p className="text-muted">
              Then open Extrudo in that window. The view will be slower than with a graphics card.
            </p>
            <p className="text-muted">
              This turns on software 3D for this one window only; your normal browser stays as it
              is, because the setting lets websites run graphics code on the processor, which Chrome
              keeps off by default for safety.
            </p>
            <p className="text-muted">
              Designs are kept per browser profile: in this window use File › Export .extrudo, and
              in the new one File › Import .extrudo….
            </p>
          </div>
        )}
        <p className="text-muted">Other things to try:</p>
        <ul className="ml-5 list-disc text-muted">
          <li>
            Turn on hardware acceleration. Chrome and Edge: Settings › System › "Use graphics
            acceleration when available". Firefox: Settings › Performance.
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span>Chromium browsers: open {gpu} to see why the graphics card isn't used.</span>
            <CopyButton text={gpu} label={`Copy ${gpu}`} />
          </li>
          <li>
            In a virtual machine, or on a machine without a graphics driver, Chrome can draw in
            software if it is started with --enable-unsafe-swiftshader.
          </li>
          <li>
            Firefox usually draws in software on its own, and so does the Extrudo desktop app.
          </li>
          <li>Update your graphics driver, then restart the browser.</li>
        </ul>
        <p className="text-muted">
          Your design is safe. The timeline, browser, parameters, customizer and export still work;
          only the picture is missing.
        </p>
        {detail && <p className="font-mono text-field text-muted">{detail}</p>}
        <div>
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Shown when the 3D view failed for another reason (a render error). */
export function ViewStopped({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <section
      aria-label="3D view stopped"
      data-webgl="error"
      className="absolute inset-0 grid place-items-center overflow-auto p-6 text-ink"
    >
      <div className="flex max-w-[34rem] flex-col gap-3 rounded-dialog border border-line bg-raised p-6">
        <h2 className="text-lg font-semibold">The 3D view stopped working</h2>
        <p className="text-muted">
          Your design is safe, and the rest of Extrudo still works. Trying again redraws the view.
        </p>
        <p className="font-mono text-field text-muted">{message}</p>
        <div>
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </section>
  );
}
