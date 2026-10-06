/**
 * The landing page's scroll stage (ADR-0057 amendment, 2026-10-05): the nine
 * pictures of a PCB enclosure built in the app, in the app's window, which leans
 * back below the hero and pins as it comes up. The scroll position deals the
 * pictures over each other like a deck; the caption sits under the window and
 * the app's timeline under that, a chip per step with the amber marker after the
 * current one (a chip jumps to its step).
 *
 * Without JavaScript the ordered list of nine figures is the whole experience.
 * `enhance` hides the list from sight (screen readers still read it: it keeps
 * the pictures' alt texts) and adds the stage, which is `aria-hidden`. It is
 * small and dependency-free.
 */

/** The category colour class (site.css `.cat-*`) of each step's icon. */
const CATEGORY: Record<string, string> = {
  plus: 'neutral',
  'sketch-plane': 'sketch',
  sketch: 'sketch',
  extrude: 'solid',
  pattern: 'solid',
  shell: 'param',
  fillet: 'param',
  customizer: 'param',
};

/**
 * Part of each step's stretch in which its picture rests before the next is dealt.
 * The scroll is `n - 0.4` stretches long, so the last picture is dealt a little before
 * the end of the page's pin and rests there.
 */
const REST = 0.4;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Turns the plain list into the scroll stage. Called for `[data-walkthrough]`. */
export function enhance(section: HTMLElement): void {
  const list = section.querySelector<HTMLOListElement>('ol');
  const steps = Array.from(section.querySelectorAll<HTMLLIElement>('li.step'));
  if (!list || steps.length === 0) return;
  if (section.hasAttribute('data-enhanced')) return;
  section.setAttribute('data-enhanced', '');
  const n = steps.length;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const track = document.createElement('div');
  track.className = 'scrolly-track';
  track.style.setProperty('--steps', String(n));
  // The list keeps the real pictures and their alt text; the stage is decoration.
  track.innerHTML = `<div class="scrolly-pin" data-walkthrough-stage aria-hidden="true">
    <div class="hero-shot"><div class="frame">
      <div class="frame-bar"><i></i><i></i><i></i><b></b></div>
      <div class="deck"></div>
    </div></div>
    <div class="caption-area">
      <p class="walkthrough-counter" data-walkthrough-counter></p>
      <div class="captions"></div>
    </div>
    <div class="rail"><i class="marker"></i></div>
  </div>`;
  const pin = track.querySelector<HTMLElement>('.scrolly-pin') as HTMLElement;
  const shot = track.querySelector<HTMLElement>('.hero-shot') as HTMLElement;
  const deck = track.querySelector<HTMLElement>('.deck') as HTMLElement;
  const captions = track.querySelector<HTMLElement>('.captions') as HTMLElement;
  const counter = track.querySelector<HTMLElement>('.walkthrough-counter') as HTMLElement;
  const rail = track.querySelector<HTMLElement>('.rail') as HTMLElement;
  const marker = rail.querySelector<HTMLElement>('.marker') as HTMLElement;
  const barLabel = track.querySelector<HTMLElement>('.frame-bar b');
  if (barLabel) barLabel.textContent = new URL(__APP_URL__).host;

  const images: HTMLImageElement[] = [];
  const texts: HTMLElement[] = [];
  const chips: HTMLButtonElement[] = [];
  for (const [index, step] of steps.entries()) {
    const source = step.querySelector<HTMLImageElement>('img.shot');
    if (!source) continue;
    const picture = source.cloneNode() as HTMLImageElement;
    picture.alt = '';
    picture.setAttribute('data-step', String(index + 1));
    // Fetched once the section is near (below), not at page load.
    picture.loading = 'lazy';
    picture.sizes = '(min-width: 1100px) 1040px, 100vw';
    // Decoded before it is painted: with `async`, Chrome may paint a picture's area
    // empty while it decodes it (again), which is what a dealt picture would show.
    picture.decoding = 'sync';
    picture.style.zIndex = String(index);
    deck.append(picture);
    images.push(picture);

    const text = document.createElement('div');
    text.className = 'caption';
    const caption = step.querySelector('figcaption');
    if (caption) text.append(...Array.from(caption.cloneNode(true).childNodes));
    captions.append(text);
    texts.push(text);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.tabIndex = -1;
    const icon = step.dataset.icon ?? 'plus';
    chip.className = `chip cat-${CATEGORY[icon] ?? 'neutral'}`;
    chip.innerHTML = `<svg viewBox="0 0 24 24"><use href="#i-${icon}"></use></svg>`;
    chip.addEventListener('click', () => {
      // The scroll position where this step's picture rests.
      const span = track.offsetHeight - pin.offsetHeight;
      const top = window.scrollY + track.getBoundingClientRect().top;
      window.scrollTo({
        top: top + ((index + REST / 2) / (n - 0.4)) * span,
        behavior: reduced.matches ? 'auto' : 'smooth',
      });
    });
    marker.before(chip);
    chips.push(chip);
  }
  list.before(track);
  list.classList.add('sr-only');
  if (images.length !== n) return;

  // A dealt picture the browser hasn't fetched or decoded yet would show the empty
  // window (and Chrome doesn't decode a picture it isn't showing). So every picture
  // is fetched and decoded as the section comes within a screen of the viewport,
  // and the deck never deals past the first one that isn't ready.
  const settled = new Set<number>();
  const prepare = (index: number) => {
    const image = images[index] as HTMLImageElement;
    image.loading = 'eager';
    return image
      .decode()
      .catch(() => {})
      .then(() => {
        settled.add(index);
        follow();
      });
  };
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      near.disconnect();
      for (let i = 0; i < n; i++) void prepare(i);
    },
    { rootMargin: '100% 0px' },
  );
  near.observe(section);

  let shown = -1;
  let positions: number[] = [];
  const measure = () => {
    // Where the marker sits after each chip: in the gap, on the rail's own scale.
    positions = chips.map((chip) => chip.offsetLeft + chip.offsetWidth + 2.5);
  };

  function follow() {
    const box = track.getBoundingClientRect();
    const span = box.height - pin.offsetHeight;
    let raw = Math.min(n - 1, Math.max(0, (-box.top / span) * (n - 0.4)));
    let ready = 0;
    while (ready < n && settled.has(ready)) ready++;
    raw = Math.min(raw, Math.max(0, ready - 1));
    // Each picture rests for the first part of its stretch, then the next one is dealt.
    const whole = Math.floor(raw);
    const e = reduced.matches ? Math.round(raw) : whole + smooth((raw - whole - REST) / (1 - REST));
    for (const [i, picture] of images.entries()) {
      const d = Math.max(-1, Math.min(1, i - e));
      // A picture still waiting below the window casts no shadow into it.
      picture.style.boxShadow = d >= 1 ? 'none' : '';
      if (d > 0) {
        picture.style.transform = `translateY(${d * 104}%) rotate(${d * 5}deg) scale(${1 + d * 0.06})`;
        picture.style.filter = '';
      } else {
        picture.style.transform = d === 0 ? '' : `translateY(${d * 5}%) scale(${1 + d * 0.1})`;
        picture.style.filter = d === 0 ? '' : `brightness(${1 + d * 0.7})`;
      }
    }
    const active = Math.round(e);
    if (active !== shown) {
      shown = active;
      const step = active + 1;
      section.setAttribute('data-active-step', String(step));
      counter.textContent = `Step ${step} of ${n}`;
      for (const [i, item] of steps.entries()) {
        if (i === active) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      }
      for (const [i, picture] of images.entries())
        picture.toggleAttribute('data-active', i === active);
      for (const [i, text] of texts.entries()) text.toggleAttribute('data-active', i === active);
      for (const [i, chip] of chips.entries()) {
        chip.toggleAttribute('data-done', i <= active);
        chip.toggleAttribute('data-active', i === active);
      }
    }
    const lo = Math.floor(e);
    const a = positions[lo] ?? 0;
    const b = positions[Math.min(n - 1, lo + 1)] ?? a;
    marker.style.transform = `translateX(${a + (b - a) * (e - lo)}px)`;
    // The window leans back while it is still below the hero and stands up as it pins.
    const lean = reduced.matches
      ? 0
      : Math.min(12, Math.max(0, (box.top / window.innerHeight) * 22));
    shot.style.setProperty('--tilt', String(lean));
  }

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      follow();
    });
  };
  const onResize = () => {
    measure();
    onScroll();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  reduced.addEventListener('change', onScroll);
  measure();
  follow();
  // The chips are laid out once the fonts and the rail have settled.
  void document.fonts?.ready.then(onResize);
}
