/**
 * The `snap-explorer` widget in the browser (ADR-0116 §1): the pointer follows the
 * mouse or a finger over the stage, or takes arrow keys on its handle (4 units,
 * Shift 20); the switches are turned on; each change redraws the stage and the
 * result line from the model.
 */
import { arrowStep, stagePoint } from './drag';
import {
  moveTo,
  nudge,
  result,
  type SnapState,
  START,
  SWITCH_KEYS,
  snapMarkup,
} from './snap-explorer-model';

export function enhanceSnapExplorer(root: HTMLElement): void {
  const stage = root.querySelector<SVGSVGElement>('svg.widget-stage');
  const line = root.querySelector<HTMLElement>('.widget-result');
  const inputs = SWITCH_KEYS.map((key) =>
    root.querySelector<HTMLInputElement>(`input[data-key="${key}"]`),
  );
  if (!stage || !line || inputs.some((input) => !input)) return;

  let state: SnapState = START;
  const draw = (refocus = false) => {
    stage.innerHTML = snapMarkup(state, true);
    // The snap's name is bold; built as nodes, never as markup.
    const { word, rest } = result(state);
    const strong = document.createElement('strong');
    strong.textContent = word;
    line.replaceChildren(strong, document.createElement('br'), rest);
    if (refocus) stage.querySelector<SVGElement>('[role="slider"]')?.focus();
  };

  SWITCH_KEYS.forEach((key, i) => {
    const input = inputs[i];
    if (!input) return;
    input.disabled = false;
    input.addEventListener('change', () => {
      state = { ...state, [key]: input.checked };
      draw();
    });
  });

  // No press needed: the pointer is where the mouse is, as it is while drawing.
  const follow = (e: PointerEvent) => {
    const { x, y } = stagePoint(stage, e);
    state = moveTo(state, x, y);
    draw();
  };
  stage.addEventListener('pointermove', follow);
  stage.addEventListener('pointerdown', follow);
  stage.addEventListener('keydown', (e) => {
    const step = arrowStep(e.key);
    if (!step || !(e.target instanceof Element) || !e.target.closest('[role="slider"]')) return;
    e.preventDefault();
    state = nudge(state, step.dx, step.dy, e.shiftKey ? 20 : 4);
    draw(true);
  });
  draw();
}
