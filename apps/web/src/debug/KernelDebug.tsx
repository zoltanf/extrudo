import {
  type BodyMesh,
  isKernelCrash,
  KernelClient,
  type KernelStatus,
  spawnBrowserKernel,
  type TestPart,
} from '@extrudo/kernel';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Kernel debug page (P0-09), at `#/debug/kernel`: renders the P0-02 test part
 * from the worker and can crash the kernel on purpose to show that it
 * restarts (NFR-03). The real viewport arrives with P0-05.
 */
export function KernelDebug() {
  const [status, setStatus] = useState<KernelStatus>('idle');
  const [restarts, setRestarts] = useState(0);
  const [part, setPart] = useState<TestPart>();
  const [message, setMessage] = useState('');
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
        {part && (
          <Canvas
            camera={{ position: [60, -75, 55], up: [0, 0, 1], fov: 35 }}
            onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
            frameloop="demand"
          >
            <ambientLight intensity={0.7} />
            <directionalLight position={[40, -60, 90]} intensity={2.2} />
            <PartView mesh={part.mesh} center={part.measurements.bbox} />
          </Canvas>
        )}
      </div>
    </main>
  );
}

function PartView({ mesh, center }: { mesh: BodyMesh; center: TestPart['measurements']['bbox'] }) {
  const { faces, edges } = useMemo(() => geometries(mesh), [mesh]);
  const offset = center.min.map((v, i) => -(v + (center.max[i] ?? 0)) / 2) as [
    number,
    number,
    number,
  ];
  return (
    <group position={offset}>
      <mesh geometry={faces}>
        <meshStandardMaterial color="#ffb23e" roughness={0.55} metalness={0.05} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#15181f" />
      </lineSegments>
    </group>
  );
}

function geometries(mesh: BodyMesh) {
  const faces = new BufferGeometry();
  faces.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  faces.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  faces.setIndex(new BufferAttribute(mesh.indices, 1));

  // Edge polylines → segment pairs.
  const segments: number[] = [];
  for (let e = 0; e < mesh.edgeRanges.length; e += 2) {
    const first = mesh.edgeRanges[e] ?? 0;
    const count = mesh.edgeRanges[e + 1] ?? 0;
    for (let p = first; p < first + count - 1; p++) {
      for (let k = 0; k < 6; k++) segments.push(mesh.edgePoints[3 * p + k] ?? 0);
    }
  }
  const edges = new BufferGeometry();
  edges.setAttribute('position', new BufferAttribute(new Float32Array(segments), 3));
  return { faces, edges };
}
