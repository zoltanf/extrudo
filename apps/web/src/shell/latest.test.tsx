// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { StrictMode, useEffect, useLayoutEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { type Later, useLater, useLaterValue, useLatest } from './latest';

afterEach(cleanup);

describe('useLatest', () => {
  it('stays the same function and calls the latest one', () => {
    const calls: string[] = [];
    const { result, rerender } = renderHook(
      ({ n }) => useLatest((tool: string) => calls.push(`${tool}@${n}`)),
      { initialProps: { n: 0 }, wrapper: StrictMode },
    );
    const first = result.current;
    for (let n = 1; n <= 5; n++) rerender({ n });
    expect(result.current).toBe(first);
    first('extrude');
    expect(calls).toEqual(['extrude@5']);
  });

  it("a child's layout effect already calls this render's function", () => {
    const seen: number[] = [];
    function Child({ run }: { run: () => void }) {
      useLayoutEffect(() => {
        run();
      });
      return null;
    }
    function Parent() {
      const [n, setN] = useState(0);
      (globalThis as { bump?: () => void }).bump = () => setN((x) => x + 1);
      return <Child run={useLatest(() => seen.push(n))} />;
    }
    render(<Parent />);
    act(() => (globalThis as { bump?: () => void }).bump?.());
    act(() => (globalThis as { bump?: () => void }).bump?.());
    expect(seen).toEqual([0, 1, 2]);
  });

  it('useLater: one box for good, set after each render before every effect (ADR-0159 §6)', () => {
    const seen: { layout: number; passive: number; render: number }[] = [];
    let box: Later<number> | undefined;
    function Child({ later }: { later: Later<number> }) {
      const render = later.get();
      useLayoutEffect(() => {
        seen.push({ layout: later.get(), passive: -1, render });
      });
      useEffect(() => {
        const last = seen[seen.length - 1];
        if (last) last.passive = later.get();
      });
      return null;
    }
    function Parent() {
      const [n, setN] = useState(1);
      (globalThis as { bump?: () => void }).bump = () => setN((x) => x + 1);
      const later = useLater(0);
      box ??= later;
      expect(later).toBe(box);
      useLaterValue(later, n * 10);
      return <Child later={later} />;
    }
    render(
      <StrictMode>
        <Parent />
      </StrictMode>,
    );
    act(() => (globalThis as { bump?: () => void }).bump?.());
    const last = seen[seen.length - 1];
    // Effects of the commit see this render's value; a child's render doesn't (an earlier
    // commit's, or what the compiler memoised): never read a `Later` during a render.
    expect(last?.layout).toBe(20);
    expect(last?.passive).toBe(20);
    expect(last?.render).not.toBe(20);
    expect(box?.get()).toBe(20);
  });
});
