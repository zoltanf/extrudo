import type { EvaluateResult } from '@extrudo/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExpressionInput } from './ExpressionInput';

/** Only "5" is a valid expression here. */
const evaluate = (expression: string): EvaluateResult =>
  expression.trim() === '5'
    ? ({ ok: true, value: 5 } as EvaluateResult)
    : ({
        ok: false,
        error: { message: 'Expected a number.', span: { start: 0, end: 1 } },
      } as unknown as EvaluateResult);

const field = (value: string, allowEmpty?: boolean) =>
  renderToStaticMarkup(
    <ExpressionInput
      value={value}
      label="Limit"
      evaluate={evaluate}
      format={() => '5 mm'}
      onCommit={() => {}}
      {...(allowEmpty && { allowEmpty })}
    />,
  );

describe('ExpressionInput with allowEmpty', () => {
  it('a blank draft, spaces too, is a value of its own: no error', () => {
    for (const value of ['', '   ']) {
      const html = field(value, true);
      expect(html).not.toContain('has-error');
      expect(html).not.toContain('aria-invalid');
      expect(html).not.toContain('Expected a number.');
    }
  });

  it('without it, spaces are an error', () => {
    const html = field('   ');
    expect(html).toContain('has-error');
    expect(html).toContain('Expected a number.');
  });
});
