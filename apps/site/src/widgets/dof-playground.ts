/**
 * The `dof-playground` widget in the browser (ADR-0116 §1): the switches and Reset
 * are turned on, the top-right corner drags or takes arrow keys (2 units, Shift
 * 10), and each change redraws the stage and the result line from the model.
 */

import {
  canMove,
  type DofState,
  dofMarkup,
  dragTo,
  nudge,
  result,
  START,
  SWITCH_KEYS,
} from './dof-playground-model';
import { arrowStep, onDrag } from './drag';

export function enhanceDofPlayground(root: HTMLElement): void {
  const stage = root.querySelector<SVGSVGElement>('svg.widget-stage');
  const line = root.querySelector<HTMLElement>('.widget-result');
  const reset = root.querySelector<HTMLButtonElement>('button[data-key="reset"]');
  const inputs = SWITCH_KEYS.map((key) =>
    root.querySelector<HTMLInputElement>(`input[data-key="${key}"]`),
  );
  if (!stage || !line || !reset || inputs.some((input) => !input)) return;

  let state: DofState = START;
  const draw = (refocus = false) => {
    stage.innerHTML = dofMarkup(state, true);
    const { text, tone } = result(state);
    line.textContent = text;
    line.className = `widget-result is-${tone}`;
    if (refocus) stage.querySelector<SVGElement>('[role="slider"]')?.focus();
  };
  const readSwitches = () => {
    const flags = Object.fromEntries(
      SWITCH_KEYS.map((key, i) => [key, inputs[i]?.checked ?? false]),
    );
    state = { ...state, ...flags };
  };

  for (const input of inputs) {
    if (!input) continue;
    input.disabled = false;
    input.addEventListener('change', () => {
      readSwitches();
      draw();
    });
  }
  reset.disabled = false;
  reset.addEventListener('click', () => {
    state = START;
    for (const input of inputs) if (input) input.checked = false;
    draw();
  });

  onDrag(
    stage,
    '[role="slider"]',
    () => canMove(state),
    (x, y) => {
      state = dragTo(state, x, y);
      draw();
    },
  );
  stage.addEventListener('keydown', (e) => {
    const step = arrowStep(e.key);
    if (!step || !(e.target instanceof Element) || !e.target.closest('[role="slider"]')) return;
    e.preventDefault();
    state = nudge(state, step.dx, step.dy, e.shiftKey ? 10 : 2);
    draw(true);
  });
  draw();
}
