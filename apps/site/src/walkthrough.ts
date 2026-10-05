/**
 * The landing page's scroll walkthrough (ADR-0057 amendment, 2026-10-05): the
 * nine pictures of a PCB enclosure built in the app, shown one at a time as the
 * visitor scrolls the captions. Without JavaScript the ordered list is the whole
 * experience; `enhance` adds a sticky stage beside it and follows the scroll with
 * an `IntersectionObserver`, so it is small and dependency-free.
 */

/** The middle-of-the-viewport line a step's own box has to cross to become current. */
const LINE = '-50% 0px -50% 0px';

/** Turns the plain list into the scroll walkthrough. Called for `[data-walkthrough]`. */
export function enhance(section: HTMLElement): void {
  const list = section.querySelector('ol');
  const steps = Array.from(section.querySelectorAll<HTMLLIElement>('li.step'));
  if (!list || steps.length === 0) return;
  if (section.hasAttribute('data-enhanced')) return;
  section.setAttribute('data-enhanced', '');

  const stage = document.createElement('div');
  stage.className = 'stage';
  stage.setAttribute('data-walkthrough-stage', '');
  // The list keeps the real pictures and their alt text; the stage is decoration.
  stage.setAttribute('aria-hidden', 'true');

  const pictures = document.createElement('div');
  pictures.className = 'stage-pictures';
  for (const [index, step] of steps.entries()) {
    const source = step.querySelector<HTMLImageElement>('img.shot');
    if (!source) continue;
    const copy = source.cloneNode() as HTMLImageElement;
    copy.alt = '';
    copy.setAttribute('data-step', String(index + 1));
    // The first two are in view as the section arrives; the rest load as they are reached.
    copy.loading = index < 2 ? 'eager' : 'lazy';
    copy.decoding = 'async';
    pictures.append(copy);
  }

  const counter = document.createElement('p');
  counter.className = 'walkthrough-counter';
  counter.setAttribute('data-walkthrough-counter', '');
  counter.textContent = `Step 1 of ${steps.length}`;

  const progress = document.createElement('div');
  progress.className = 'progress';
  const bar = document.createElement('span');
  progress.append(bar);

  const controls = document.createElement('div');
  controls.className = 'walkthrough-controls';
  controls.append(counter, progress);
  stage.append(pictures, controls);
  list.before(stage);

  const setActive = (step: number) => {
    section.setAttribute('data-active-step', String(step));
    for (const [index, item] of steps.entries()) {
      if (index + 1 === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
    for (const image of pictures.querySelectorAll<HTMLImageElement>('img[data-step]')) {
      image.toggleAttribute('data-active', Number(image.dataset.step) === step);
    }
    counter.textContent = `Step ${step} of ${steps.length}`;
    bar.style.setProperty('width', `${(step / steps.length) * 100}%`);
  };
  setActive(1);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = steps.indexOf(entry.target as HTMLLIElement);
        if (index >= 0) setActive(index + 1);
      }
    },
    { rootMargin: LINE },
  );
  for (const step of steps) observer.observe(step);
}
