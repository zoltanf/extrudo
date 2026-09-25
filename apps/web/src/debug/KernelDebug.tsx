import type { BodyId } from '@extrudo/core';
import {
  isKernelCrash,
  KernelClient,
  type KernelStatus,
  spawnBrowserKernel,
  type TestPart,
} from '@extrudo/kernel';
import { useEffect, useMemo, useState } from 'react';
import type { Platform } from '../platform';
import { createViewportStore } from '../viewport/store';
import { Viewport } from '../viewport/Viewport';

const TEST_BODY = 'test-part' as BodyId;

/**
 * Kernel debug page (P0-09), at `#/debug/kernel`: renders the P0-02 test part
 * from the worker and can crash the kernel on purpose to show that it
 * restarts (NFR-03). The part is drawn in the real viewport (P0-05), which
 * makes this page the place to try visual styles on real geometry.
 */
export function KernelDebug({ platform }: { platform: Platform }) {
  const [status, setStatus] = useState<KernelStatus>('idle');
  const [restarts, setRestarts] = useState(0);
  const [part, setPart] = useState<TestPart>();
  const [message, setMessage] = useState('');
  const viewport = useMemo(
    () => createViewportStore({ preferences: platform.preferences }),
    [platform],
  );
  const bodies = useMemo(() => (part ? { [TEST_BODY]: part.mesh } : undefined), [part]);
  // Frame the part once the viewport knows its bounds.
  useEffect(
    () =>
      viewport.subscribe((s, prev) => {
        if (s.bounds && s.bounds !== prev.bounds) s.fit();
      }),
    [viewport],
  );
  const client = useMemo(
    () =>
      new KernelClient(spawnBrowserKernel, {
        onStatus: setStatus,
        onRestart: (n) => {
          setRestarts(n);
          setMessage('The kernel stopped and restarted. Your work is safe.');
        },
      }),
    [],
  );

  useEffect(() => {
    client
      .start()
      .catch((error: unknown) => setMessage(`The kernel didn't start: ${String(error)}`));
    return () => client.dispose();
  }, [client]);

  const render = async () => {
    setMessage('');
    try {
      setPart(await client.call((kernel) => kernel.debugTestPart()));
    } catch (error) {
      setMessage(String(error));
    }
  };

  const crash = async () => {
    setMessage('');
    try {
      await client.call((kernel) => kernel.debugCrash());
    } catch (error) {
      if (!isKernelCrash(error)) setMessage(String(error));
    }
  };

  return (
    <main className="kernel-debug">
      <header>
        <h1>Kernel debug</h1>
        <p role="status" aria-label="Kernel status">
          Kernel: <strong>{status}</strong>
          {restarts > 0 && ` · restarted ${restarts}×`}
        </p>
        <div className="actions">
          <button type="button" onClick={render} disabled={status !== 'ready'}>
            Render test part
          </button>
          <button type="button" onClick={crash} disabled={status !== 'ready'}>
            Crash the kernel
          </button>
        </div>
        {part && (
          <p data-testid="part-summary">
            {part.valid ? 'Valid solid' : 'Invalid solid'} · {part.faces} faces · {part.edges} edges
            · {part.measurements.volume.toFixed(1)} mm³ · {part.mesh.indices.length / 3} triangles ·
            built in {part.ms.toFixed(0)} ms
          </p>
        )}
        {message && <p className="message">{message}</p>}
      </header>
      <div className="stage" data-testid="kernel-stage">
        <Viewport viewport={viewport} bodies={bodies} />
      </div>
    </main>
  );
}
