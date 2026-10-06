/**
 * The hero's parametric toy (ADR-0057 amendment, 2026-10-05): three sliders drive
 * an isometric tray. The markup, with the default tray drawn, is in index.html
 * (`[data-toy]`); this redraws it as the sliders move and lets the width breathe
 * until someone touches it, so the page says "parametric" by itself. The drawing
 * and the weight are `toy-model.ts`.
 */
import { grams, type TrayParams, trayMarkup } from './toy-model';

const NAMES = ['width', 'height', 'fillet'] as const;

export function enhanceToy(toy: HTMLElement): void {
  const drawing = toy.querySelector<SVGGElement>('[data-toy-drawing]');
  const weight = toy.querySelector<HTMLOutputElement>('[data-toy-weight]');
  const inputs = new Map<string, HTMLInputElement>();
  for (const input of toy.querySelectorAll<HTMLInputElement>('input[data-p]')) {
    inputs.set(input.dataset.p ?? '', input);
  }
  if (!drawing || !weight || NAMES.some((name) => !inputs.has(name))) return;
  const read = (): TrayParams => {
    const value = (name: (typeof NAMES)[number]) => Number(inputs.get(name)?.value);
    return { width: value('width'), height: value('height'), fillet: value('fillet') };
  };

  let drawn = '';
  const draw = () => {
    const params = read();
    const key = `${params.width} ${params.height} ${params.fillet}`;
    if (key === drawn) return;
    drawn = key;
    drawing.innerHTML = trayMarkup(params);
    for (const input of inputs.values()) {
      const text = `${input.value} mm`;
      input.setAttribute('aria-valuetext', text);
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = text;
    }
    weight.textContent = `≈ ${grams(params).toFixed(1)} g of PLA`;
  };
  draw();

  // Until someone touches it, the width and the fillet breathe. A real `input`
  // event only comes from a person: the breathing sets values without one.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let idle = !reduced.matches;
  let visible = true;
  const stop = () => {
    idle = false;
  };
  toy.addEventListener('pointerdown', stop);
  toy.addEventListener('keydown', stop);
  toy.addEventListener('input', stop);
  reduced.addEventListener('change', () => {
    if (reduced.matches) stop();
  });
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
  }).observe(toy);
  const width = inputs.get('width');
  const fillet = inputs.get('fillet');
  const start = performance.now();
  const breathe = (now: number) => {
    if (!idle) return;
    if (visible && !document.hidden && width && fillet) {
      const t = (now - start) / 1000;
      width.value = String(Math.round(80 + 26 * Math.sin(t * 0.9)));
      fillet.value = String(Math.round(12 + 8 * Math.sin(t * 0.55 - 0.5)));
      draw();
    }
    requestAnimationFrame(breathe);
  };
  requestAnimationFrame(breathe);
  for (const input of inputs.values()) input.addEventListener('input', draw);
}
