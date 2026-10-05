// The page: start a "kernel" module worker, which starts the compiler worker.
const t0 = performance.now();
const kernel = new Worker('./kernel.js', { type: 'module' });
window.__log = [];
kernel.onmessage = (e) => { window.__log.push(e.data); if (e.data.done) window.__done = true; };
kernel.onerror = (e) => { window.__log.push({ error: e.message }); window.__done = true; };
kernel.postMessage({ crossOriginIsolated: self.crossOriginIsolated, t0 });
