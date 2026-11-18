/** Finding an object by the string a script gives: name first, then ID. */
import { describe, expect, it } from 'vitest';
import { byNameThenId } from './lookup';

const items = [
  { id: 'a1', name: 'lid' },
  { id: 'a2', name: 'Lid' },
  { id: 'a3', name: 'a1' },
];

describe('byNameThenId', () => {
  it('takes an exact-case name, then a name in another case, then an ID', () => {
    expect(byNameThenId(items, 'Lid', true)?.id).toBe('a2');
    expect(byNameThenId(items, 'lid', true)?.id).toBe('a1');
    expect(byNameThenId(items, 'LID', true)?.id).toBe('a1');
    expect(byNameThenId(items, 'a1', true)?.id).toBe('a3');
    expect(byNameThenId(items, 'a2', true)?.id).toBe('a2');
    expect(byNameThenId(items, 'none', true)).toBeUndefined();
  });

  it('compares names in exact case when told to', () => {
    expect(byNameThenId(items, 'LID', false)).toBeUndefined();
    expect(byNameThenId(items, 'a1', false)?.id).toBe('a3');
  });
});
