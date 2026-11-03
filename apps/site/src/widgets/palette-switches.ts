/**
 * The `palette-switches` widget in the browser (ADR-0116 §1): the switches are
 * turned on, and each flip redraws the stage from the model.
 */
import { LAYERS, type PaletteState, paletteMarkup } from './palette-switches-model';

export function enhancePaletteSwitches(root: HTMLElement): void {
  const stage = root.querySelector<SVGSVGElement>('svg.widget-stage');
  const inputs = new Map<string, HTMLInputElement>();
  for (const input of root.querySelectorAll<HTMLInputElement>('input[data-key]')) {
    inputs.set(input.dataset.key ?? '', input);
  }
  if (!stage || LAYERS.some((layer) => !inputs.has(layer))) return;
  const draw = () => {
    const state = Object.fromEntries(
      LAYERS.map((layer) => [layer, inputs.get(layer)?.checked ?? true]),
    ) as PaletteState;
    stage.innerHTML = paletteMarkup(state);
  };
  for (const input of inputs.values()) {
    input.disabled = false;
    input.addEventListener('change', draw);
  }
  draw();
}
