/**
 * The `dimension-label` widget in the browser (ADR-0116 §1): the label drags or
 * takes arrow keys, and each move redraws the stage and the result line.
 */

import {
  clampLabel,
  labelMarkup,
  moveLabel,
  type Point,
  result,
  START,
  STEP,
} from './dimension-label-model';
import { arrowStep, onDrag } from './drag';

export function enhanceDimensionLabel(root: HTMLElement): void {
  const stage = root.querySelector<SVGSVGElement>('svg.widget-stage');
  const line = root.querySelector<HTMLElement>('.widget-result');
  if (!stage || !line) return;

  let label: Point = START;
  const draw = (refocus = false) => {
    stage.innerHTML = labelMarkup(label, true);
    // The kind word is bold; built as nodes, never as markup.
    const { word, rest } = result(label);
    const strong = document.createElement('strong');
    strong.textContent = word;
    line.replaceChildren(strong, rest);
    if (refocus) stage.querySelector<SVGElement>('[role="slider"]')?.focus();
  };

  onDrag(
    stage,
    '[role="slider"]',
    () => true,
    (x, y) => {
      label = clampLabel(x, y);
      draw();
    },
  );
  stage.addEventListener('keydown', (e) => {
    const step = arrowStep(e.key);
    if (!step || !(e.target instanceof Element) || !e.target.closest('[role="slider"]')) return;
    e.preventDefault();
    label = moveLabel(label, step.dx * STEP, step.dy * STEP);
    draw(true);
  });
  draw();
}
