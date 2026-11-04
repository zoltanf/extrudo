import { describe, expect, it } from 'vitest';
import { WIDGETS } from './index';
import {
  formatArea,
  type ProfilesState,
  profilesMarkup,
  regions,
  result,
  resultMarkup,
  START,
  setSwitch,
  togglePick,
} from './profiles-model';

const ids = (state: ProfilesState) => regions(state).map((r) => r.id);
const region = (state: ProfilesState, id: string) => regions(state).find((r) => r.id === id);

describe('the profiles model', () => {
  it('finds seven profiles at the start: the plate has the hole and the slot as holes', () => {
    expect(ids(START)).toEqual(['plate', 'hole', 'island', 'slot', 'left', 'lens', 'right']);
    expect(region(START, 'plate')?.holes).toBe(2);
    expect(region(START, 'hole')?.holes).toBe(1);
  });

  it('measures in mm², a stage unit being 0.25 mm', () => {
    const bare = { ...START, island: false, slotEnd: false, construction: true };
    expect(ids(bare)).toEqual(['plate', 'left', 'lens', 'right']);
    expect(formatArea(region(bare, 'plate')?.area ?? 0)).toBe('2925.0 mm²');
    const circle = Math.PI * 42 ** 2;
    const left = region(START, 'left')?.area ?? 0;
    const lens = region(START, 'lens')?.area ?? 0;
    expect(left + lens).toBeCloseTo(circle, 6);
    const plate = region(START, 'plate')?.area ?? 0;
    const parts = ['hole', 'slot'].map((id) => region(START, id)?.area ?? 0);
    const island = region(START, 'island')?.area ?? 0;
    expect(plate + (parts[0] ?? 0) + island + (parts[1] ?? 0)).toBeCloseTo(260 * 180, 6);
  });

  it('drops the slot when its end is gone, and the plate loses that hole', () => {
    const open = setSwitch(START, 'slotEnd', false);
    expect(ids(open)).not.toContain('slot');
    expect(region(open, 'plate')?.holes).toBe(1);
  });

  it('makes no profile of a construction circle: the island becomes a hole in the plate', () => {
    const state = setSwitch(START, 'construction', true);
    expect(ids(state)).toEqual(['plate', 'island', 'slot', 'left', 'lens', 'right']);
    expect(region(state, 'plate')?.holes).toBe(2);
    expect(region(state, 'island')?.note).toBe(
      'With the hole construction, the island is a hole in the plate.',
    );
  });

  it('picks and lets go, and drops a pick whose region a switch removes', () => {
    const one = togglePick(START, 'slot');
    expect(one.picked).toEqual(['slot']);
    expect(togglePick(one, 'slot').picked).toEqual([]);
    expect(togglePick(one, 'nope')).toBe(one);
    expect(setSwitch(one, 'slotEnd', false).picked).toEqual([]);
    expect(setSwitch(one, 'show', false).picked).toEqual(['slot']);
  });

  it('says what is under the pointer, else what is picked, else the count', () => {
    expect(result(START)).toEqual({
      word: 'Seven profiles',
      rest: 'Click a region to select it and see its area.',
    });
    expect(result(START, 'dangle')).toEqual({
      word: 'Line with a free end',
      rest: 'One end touches nothing, so it bounds no profile and changes none.',
    });
    expect(result(START, 'plate')).toEqual({
      word: `Plate, ${formatArea(region(START, 'plate')?.area ?? 0)}`,
      rest: 'A profile: an outer loop and 2 holes.',
    });
    const slot = togglePick(START, 'slot');
    expect(result(slot).rest).toBe('Slot: one loop, no holes. Click it again to let go.');
    const two = togglePick(slot, 'lens');
    expect(result(two).rest).toBe('2 profiles: Slot, Overlap.');
    expect(resultMarkup(START)).toBe(
      '<strong>Seven profiles</strong><br>Click a region to select it and see its area.',
    );
  });

  it('draws the shading, hides it with Show profiles off, and makes regions checkboxes only when live', () => {
    const still = profilesMarkup(START, false);
    expect(still.match(/class="sk-profile"/g)).toHaveLength(7);
    expect(still).not.toMatch(/role=|tabindex|widget-hit|style/);
    const hidden = profilesMarkup(setSwitch(START, 'show', false), false);
    expect(hidden.match(/class="sk-profile-off"/g)).toHaveLength(7);
    const live = profilesMarkup(togglePick(START, 'plate'), true);
    expect(live.match(/role="checkbox"/g)).toHaveLength(7);
    expect(live).toContain('class="sk-profile sk-profile-picked"');
    expect(live).toContain('aria-checked="true"');
    expect(live.match(/data-extra=/g)).toHaveLength(2);
    expect(profilesMarkup(setSwitch(START, 'construction', true), false)).toContain(
      'class="sk-construction"',
    );
  });

  it('renders the figure with the switches disabled', () => {
    const html = WIDGETS.profiles?.render('Click.') ?? '';
    expect(html).toContain(profilesMarkup(START, false));
    expect(html).toContain('data-key="construction" disabled');
    expect(html).toContain('data-key="show" checked disabled');
    expect(html).toContain(resultMarkup(START));
    expect(html).toContain('<figcaption>Click.</figcaption>');
  });
});
