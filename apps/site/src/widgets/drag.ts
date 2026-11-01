/**
 * Pointer helpers shared by the docs widgets that drag something on their stage
 * (ADR-0116 §1): a stage point in `viewBox` units, and a drag of whatever element
 * matches `selector`, captured on the stage so it follows the pointer off the handle.
 */

/** Where a pointer event is on the stage, in the stage's `viewBox` units. */
export function stagePoint(stage: SVGSVGElement, e: PointerEvent): { x: number; y: number } {
  const matrix = stage.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

/**
 * Starts a drag on a press of `selector` (when `allowed()`), reports each move in
 * stage units, and ends it on release or cancel.
 */
export function onDrag(
  stage: SVGSVGElement,
  selector: string,
  allowed: () => boolean,
  move: (x: number, y: number) => void,
): void {
  let dragging = false;
  stage.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest(selector) || !allowed()) return;
    dragging = true;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const { x, y } = stagePoint(stage, e);
    move(x, y);
  });
  const stop = () => {
    dragging = false;
  };
  stage.addEventListener('pointerup', stop);
  stage.addEventListener('pointercancel', stop);
}

/** The arrow-key step of a key press, or undefined for any other key. */
export function arrowStep(key: string): { dx: number; dy: number } | undefined {
  const steps: Record<string, { dx: number; dy: number }> = {
    ArrowLeft: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 },
    ArrowUp: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 },
  };
  return Object.hasOwn(steps, key) ? steps[key] : undefined;
}
