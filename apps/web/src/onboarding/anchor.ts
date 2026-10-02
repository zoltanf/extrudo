import { useEffect, useState } from 'react';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The selector of a toolbar tool's button (`data-tool` is on every tile). */
export const toolSelector = (id: string) => `[data-tool="${id}"]`;

const same = (a: Box | undefined, b: Box | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height);

/**
 * Where an element is on the page (its viewport box), kept up to date: the
 * toolbar swaps tabs, panels slide and the window resizes, so the tutorial's
 * pointer and the empty-design hint look again a few times a second. `undefined`
 * while there is no such element, or it isn't shown.
 */
export function useTargetBox(selector: string | undefined): Box | undefined {
  const [box, setBox] = useState<Box>();
  useEffect(() => {
    if (!selector) {
      setBox(undefined);
      return;
    }
    const measure = () => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      const next =
        rect && rect.width > 0 && rect.height > 0
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : undefined;
      setBox((previous) => (same(previous, next) ? previous : next));
    };
    measure();
    const timer = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, [selector]);
  return box;
}
