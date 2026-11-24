// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { StrictMode, useLayoutEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useLatest } from './latest';

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
});
