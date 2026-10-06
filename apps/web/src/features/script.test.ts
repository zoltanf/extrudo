import { type FeatureStatus, scriptInputs } from '@extrudo/core';
import { describe, expect, it, vi } from 'vitest';
import { scriptChipHint } from '../shell/featureStatus';
import { scriptDialog } from './script';
import { scriptCompletions, scriptDiagnostics } from './scriptSupport';
import { setupDialogs } from './testing';
import { EMPTY_VALUES } from './values';

describe('Script dialog', () => {
  it('round trips code and both languages without expression parameters', () => {
    const t = setupDialogs([scriptDialog]);
    t.controller.start('script');
    const ctx = t.controller.context();
    if (!ctx) throw new Error('Missing context');
    for (const language of ['ts', 'js'] as const) {
      const inputs = scriptInputs({ code: '// hello\ndesign.box({});', language });
      const values = { ...EMPTY_VALUES, ...scriptDialog.fromInputs?.(inputs, ctx) };
      expect(scriptDialog.toInputs?.(values, ctx)).toEqual(inputs);
    }
    t.controller.dispose();
  });

  it('debounces changes, rejects stale answers and cancels the timer on close', async () => {
    vi.useFakeTimers();
    const t = setupDialogs([scriptDialog]);
    try {
      t.controller.start('script');
      t.controller.setChoice('code', 'design.box({});');
      await vi.advanceTimersByTimeAsync(499);
      expect(t.kernel.previews).toHaveLength(0);
      expect(t.controller.ok()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.kernel.previews).toHaveLength(1);
      t.controller.setChoice('code', 'design.sphere({});');
      t.kernel.previews[0]?.resolve({
        features: { [t.open()?.id ?? '']: { status: 'error' as const, message: 'old' } },
        bodies: {},
        tools: [],
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.open()?.preview.status).toBeUndefined();
      t.controller.cancel();
      await vi.advanceTimersByTimeAsync(500);
      expect(t.kernel.previews).toHaveLength(1);
    } finally {
      t.controller.dispose();
      vi.useRealTimers();
    }
  });
});

describe('Script editor support', () => {
  it('completes only the sandbox’s allowed methods, parameters and console', () => {
    const methods = scriptCompletions('const x = design.', {})?.options.map((o) => o.label) ?? [];
    expect(methods).toContain('box');
    expect(methods).toContain('sketch');
    expect(methods).not.toContain('remove');
    expect(methods).not.toContain('script');
    expect(scriptCompletions('params.co', { count: 4, width: 20 })).toEqual({
      from: 7,
      options: [{ label: 'count', type: 'property', detail: '4' }],
    });
    expect(scriptCompletions('console.', {})?.options[0]?.label).toBe('log');
    expect(scriptCompletions('mydesign.', {})).toBeUndefined();
  });

  it('maps line and column to a diagnostic and strips QuickJS’s prefix', () => {
    const status: FeatureStatus = {
      status: 'error',
      message: 'Line 3: Error: no luck',
      script: { line: 3, column: 2, log: [], generated: [] },
    };
    expect(scriptDiagnostics('one\ntwo\nthrow new Error()', status)).toEqual([
      { from: 9, to: 25, severity: 'error', message: 'Line 3: no luck' },
    ]);
    expect(scriptDiagnostics('', status)[0]?.from).toBe(0);
    expect(scriptDiagnostics('ok', { ...status, status: 'ok' })).toEqual([]);
    expect(scriptChipHint(status)).toBe('made 0 features');
    expect(scriptChipHint()).toBeUndefined();
  });
});
