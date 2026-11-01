/**
 * The `trim` widget in the browser (ADR-0116 §1): pointing at or focusing a piece
 * marks it, a click, Enter or Space trims it, Reset puts the pieces back.
 */
import {
  type Gone,
  HOVER_CLASS,
  PIECE_CLASS,
  result,
  START,
  trimMarkup,
  trimPiece,
} from './trim-model';

export function enhanceTrim(root: HTMLElement): void {
  const stage = root.querySelector<SVGSVGElement>('svg.widget-stage');
  const line = root.querySelector<HTMLElement>('.widget-result');
  const reset = root.querySelector<HTMLButtonElement>('button[data-key="reset"]');
  if (!stage || !line || !reset) return;

  let gone: Gone = START;
  /** Marking is a class swap on the visible curve, so a focused hit path is never replaced. */
  const mark = (id: string, on: boolean) => {
    const curve = stage.querySelector(`[data-vis="${id}"]`);
    curve?.classList.toggle(HOVER_CLASS, on);
    curve?.classList.toggle(PIECE_CLASS, !on);
  };
  const draw = () => {
    stage.innerHTML = trimMarkup(gone, true);
    for (const hit of stage.querySelectorAll<SVGElement>('[data-piece]')) {
      const id = hit.dataset.piece ?? '';
      const on = () => mark(id, true);
      const off = () => mark(id, false);
      hit.addEventListener('pointerenter', on);
      hit.addEventListener('pointerleave', off);
      hit.addEventListener('focus', on);
      hit.addEventListener('blur', off);
      const cut = () => {
        gone = trimPiece(gone, id);
        line.textContent = result(id);
        draw();
        reset.focus();
      };
      hit.addEventListener('click', cut);
      hit.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        cut();
      });
    }
  };

  reset.disabled = false;
  reset.addEventListener('click', () => {
    gone = START;
    line.textContent = result(undefined);
    draw();
  });
  draw();
}
