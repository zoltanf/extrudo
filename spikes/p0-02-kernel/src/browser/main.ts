// P0-02 browser harness: spawn the worker for ?c=<candidate>, time it to
// "kernel ready", render the returned mesh with plain three.js, and print the
// measurements. Playwright reads window.__spike.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CandidateId, MeshData } from '../shared/types.ts';

const candidate = (new URLSearchParams(location.search).get('c') ?? 'libcascade') as CandidateId;
for (const a of document.querySelectorAll('nav a'))
  a.classList.toggle('on', a.getAttribute('href') === `?c=${candidate}`);
const out = document.getElementById('out') as HTMLElement;

const t0 = performance.now();
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ candidate, t0 });
worker.onmessage = (e) => {
  const d = e.data;
  if (!d.ok) {
    out.innerHTML = `<pre class="bad">${d.error}</pre>`;
    (window as unknown as { __spike: unknown }).__spike = d;
    return;
  }
  const workerReadyMs = d.readyAt - performance.timeOrigin - t0;
  render(d.result.mesh);
  const r = d.result;
  const row = (k: string, v: string, cls = '') => `<tr><td>${k}</td><td class="${cls}">${v}</td></tr>`;
  const ms = (v: number) => `${v.toFixed(1)} ms`;
  out.innerHTML = `
    <h3>${candidate} <small>(${r.layer})</small></h3>
    <table>
      ${row('worker ready (spawn → kernel init done)', ms(workerReadyMs))}
      ${row('  of which module import', ms(d.importMs))}
      ${row('  of which WASM fetch+compile+init', ms(d.load.initMs))}
      ${row('crossOriginIsolated / SharedArrayBuffer', `${d.crossOriginIsolated} / ${d.sharedArrayBuffer}`)}
    </table>
    <table><tr><td><b>op</b></td><td><b>first / warm median</b></td></tr>
      ${Object.keys(r.timings)
        .map((k) => row(k, `${r.timings[k].toFixed(1)} / ${d.warmMedian[k].toFixed(1)} ms`))
        .join('')}
    </table>
    <table>
      ${row('valid', String(r.checks.valid), r.checks.valid ? 'ok' : 'bad')}
      ${row('volume (expected)', `${r.checks.volume.toFixed(2)} (${r.checks.expectedVolume.toFixed(2)})`)}
      ${row('faces / edges / triangles', `${r.checks.faces} / ${r.checks.edges} / ${r.checks.triangles}`)}
      ${row('STL watertight', String(r.checks.stlWatertight), r.checks.stlWatertight ? 'ok' : 'bad')}
      ${row('STEP bytes / re-import faces', `${r.checks.stepBytes} / ${r.checks.stepReimportFaces}`)}
      ${row('history: faces named', `${r.history.coverage.faces.named}/${r.history.coverage.faces.total}`)}
      ${row('history: edges named (+derived)', `${r.history.coverage.edges.named} (+${r.history.coverage.edges.derived})/${r.history.coverage.edges.total}`)}
    </table>
    <pre>${r.history.lines.join('\n')}\n\n${r.history.notes.join('\n')}</pre>`;
  (window as unknown as { __spike: unknown }).__spike = { ...d, workerReadyMs, result: { ...r, mesh: undefined } };
};

function render(mesh: MeshData) {
  const view = document.getElementById('view') as HTMLElement;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(view.clientWidth, view.clientHeight);
  view.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1419);
  const camera = new THREE.PerspectiveCamera(40, view.clientWidth / view.clientHeight, 0.1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(70, -60, 55);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(20, 15, 10);
  controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(50, -40, 80);
  scene.add(sun);

  // One merged geometry; colour per B-rep face from faceRanges (shows the
  // triangle → face mapping that picking will use).
  const g = new THREE.BufferGeometry();
  const colors = new Float32Array(mesh.positions.length);
  const palette = [0x6ea8fe, 0x7ee787, 0xf2cc60, 0xff9bce, 0xa5d6ff, 0xffa657, 0xd2a8ff, 0x56d4dd];
  const c = new THREE.Color();
  for (let f = 0; f < mesh.faceRanges.length / 2; f++) {
    c.setHex(palette[f % palette.length]);
    const first = mesh.faceRanges[f * 2];
    const count = mesh.faceRanges[f * 2 + 1];
    for (let t = first; t < first + count; t++)
      for (let k = 0; k < 3; k++) {
        const v = mesh.indices[t * 3 + k];
        colors.set([c.r, c.g, c.b], v * 3);
      }
  }
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));

  const seg: number[] = [];
  for (const line of mesh.edges)
    for (let i = 0; i + 5 < line.length; i += 3) seg.push(...line.slice(i, i + 6));
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x0b0e12 })));

  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}
