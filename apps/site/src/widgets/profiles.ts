/**
 * The `profiles` widget in the browser (ADR-0116 §1): pointing at or focusing a
 * region or a curve that makes no profile says what it is; a click, Enter or Space
 * picks a region or lets it go; the switches change the sketch and redraw it.
 */
import {
  HOVER_CLASS,
  type ProfilesState,
  profilesMarkup,
  result,
  START,
  SWITCH_KEYS,
  setSwitch,
  togglePick,
} from './profiles-model';

export function enhanceProfiles(root: HTMLElement): void {
  const stage = root.querySelector<SVGSVGElement>('svg.widget-stage');
  const line = root.querySelector<HTMLElement>('.widget-result');
  const inputs = SWITCH_KEYS.map((key) =>
    root.querySelector<HTMLInputElement>(`input[data-key="${key}"]`),
  );
  if (!stage || !line || inputs.some((input) => !input)) return;

  let state: ProfilesState = START;
  let over: string | undefined;
  const say = () => {
    // The first part is bold; built as nodes, never as markup.
    const { word, rest } = result(state, over);
    const strong = document.createElement('strong');
    strong.textContent = word;
    line.replaceChildren(strong, document.createElement('br'), rest);
  };
  /** Pointing is a class swap, so a focused region is never replaced. */
  const point = (target: SVGElement, id: string | undefined) => {
    over = id;
    if (target.dataset.region) target.classList.toggle(HOVER_CLASS, id !== undefined);
    say();
  };
  const draw = (refocus?: string) => {
    stage.innerHTML = profilesMarkup(state, true);
    for (const target of stage.querySelectorAll<SVGElement>('[data-region], [data-extra]')) {
      const id = target.dataset.region ?? target.dataset.extra ?? '';
      const on = () => point(target, id);
      const off = () => point(target, undefined);
      target.addEventListener('pointerenter', on);
      target.addEventListener('pointerleave', off);
      if (!target.dataset.region) continue;
      target.addEventListener('focus', on);
      target.addEventListener('blur', off);
      const pick = () => {
        state = togglePick(state, id);
        draw(id);
      };
      target.addEventListener('click', pick);
      target.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        pick();
      });
    }
    if (refocus) stage.querySelector<SVGElement>(`[data-region="${refocus}"]`)?.focus();
    // After a pick the line shows the selection, not the region it just focused.
    over = undefined;
    say();
  };

  SWITCH_KEYS.forEach((key, i) => {
    const input = inputs[i];
    if (!input) return;
    input.disabled = false;
    input.addEventListener('change', () => {
      state = setSwitch(state, key, input.checked);
      draw();
    });
  });
  draw();
}
