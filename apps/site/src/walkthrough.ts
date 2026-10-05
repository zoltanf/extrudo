/**
 * The landing page's scroll walkthrough (ADR-0057 amendment, 2026-10-05): the
 * nine pictures of a PCB enclosure built in the app, shown one at a time as the
 * visitor scrolls the captions. Without JavaScript the ordered list is the whole
 * experience; `enhance` adds a sticky stage beside it, follows the scroll and
 * sweeps the stage to each step's picture. It is small and dependency-free.
 */

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
    // Decoded before it is painted: with `async`, Chrome may paint a picture's area
    // empty while it decodes it (again), which is exactly what a sweep would show.
    copy.decoding = 'sync';
    pictures.append(copy);
  }

  // The step counter is a badge on the picture, so the stage is just the picture.
  const counter = document.createElement('p');
  counter.className = 'walkthrough-counter';
  counter.setAttribute('data-walkthrough-counter', '');
  counter.textContent = `Step 1 of ${steps.length}`;
  pictures.append(counter);
  stage.append(pictures);
  list.before(stage);

  const images = Array.from(pictures.querySelectorAll<HTMLImageElement>('img[data-step]'));
  const imageOf = (step: number) => images.find((image) => Number(image.dataset.step) === step);

  // A sweep that starts on a picture the browser hasn't fetched or decoded yet
  // reveals the empty stage behind it (and Chrome doesn't decode a picture it
  // isn't showing). So every picture is fetched and decoded as the section comes
  // within a screen of the viewport, before the reader reaches it.
  const decoded = new Set<HTMLImageElement>();
  const prepare = (image: HTMLImageElement) => {
    image.loading = 'eager';
    return image
      .decode()
      .then(() => void decoded.add(image))
      .catch(() => {});
  };
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      near.disconnect();
      for (const image of images) void prepare(image);
    },
    { rootMargin: '100% 0px' },
  );
  near.observe(section);

  // The step on the stage, and the one the reader is at: they differ only while a
  // picture that isn't ready yet is being decoded.
  let shown = 0;
  let wanted = 0;
  const sweepTo = (step: number) => {
    const previous = shown;
    shown = step;
    // The sweep runs the way the reader scrolls: up from the bottom edge going
    // forward, down from the top edge going back (the CSS picks the keyframes).
    pictures.dataset.direction = step > previous ? 'forward' : 'back';
    for (const image of images) {
      const n = Number(image.dataset.step);
      image.toggleAttribute('data-leaving', n === previous);
      image.toggleAttribute('data-active', n === step);
    }
  };
  const setActive = (step: number) => {
    if (step === wanted) return;
    wanted = step;
    section.setAttribute('data-active-step', String(step));
    for (const [index, item] of steps.entries()) {
      if (index + 1 === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
    counter.textContent = `Step ${step} of ${steps.length}`;
    // The stage keeps the picture it has until the new one can be painted.
    const incoming = imageOf(step);
    if (!incoming || decoded.has(incoming) || shown === 0) sweepTo(step);
    else
      void prepare(incoming).then(() => {
        if (wanted === step && shown !== step) sweepTo(step);
      });
  };
  setActive(1);
  // Once the incoming picture has covered it, the one it replaced can go.
  pictures.addEventListener('animationend', (event) => {
    if ((event.target as HTMLElement).hasAttribute('data-active')) {
      for (const image of images) image.removeAttribute('data-leaving');
    }
  });
  // The first picture is simply there; the sweeps start after the first paint.
  requestAnimationFrame(() => requestAnimationFrame(() => pictures.setAttribute('data-ready', '')));

  // The current step is the last one whose top has passed the reading line (step 1
  // before any has): the middle of the viewport beside the stage, or, where the
  // stage is pinned above the captions (a phone), the middle of the space below
  // it, where the captions are read. Read on every scrolled frame rather than from
  // an observer on that line: a fast scroll can carry a step across it between two
  // checks, and on a phone the line often sits in the gap between two steps, so an
  // observer would leave the stage on an old step.
  const follow = () => {
    const box = stage.getBoundingClientRect();
    const above = box.right > list.getBoundingClientRect().left;
    const top = above ? Math.max(0, box.bottom) : 0;
    const line = top + (window.innerHeight - top) / 2;
    let step = 1;
    for (const [index, item] of steps.entries()) {
      if (item.getBoundingClientRect().top <= line) step = index + 1;
    }
    setActive(step);
  };
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      follow();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  follow();
}
