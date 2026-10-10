/**
 * Parameters. Every number a design is driven by — a sketch dimension, a
 * feature's distance, a user parameter — is one value record: its expression
 * as typed ("4.2 mm", "height / 4"), its name (`d1`, `wall`), its kind
 * ("Diameter Dimension-2", "AlongDistance", "User Parameter"), its unit and its
 * evaluated value in internal units (cm, radians). A feature's or dimension's
 * parameter has an owner record; a user parameter has none.
 */
import type { Segment } from '../segment';
import { decodeLevel, type RecordDecoder, unsupported } from './common';

export const PARAMETER_VALUE = '7A6A3D31-BE74-4E19-9115-20642944C2E4';
/** The owner of a feature's or dimension's parameter (the feature-side record). */
export const PARAMETER_OWNER = 'D91D429C-1BB5-4640-B49F-69AF14F463E9';

export interface ParameterValue {
  id: number;
  /** The n of `dn`, or the user parameter's own ordinal. */
  number: number;
  /** The owner record (absent for a user parameter). */
  owner?: number;
  name: string;
  expression: string;
  /** "User Parameter", "Linear Dimension-2", "AlongDistance", "TaperAngle", … */
  kind: string;
  comment: string;
  /** A user parameter (the Parameters dialog's own list). */
  user: boolean;
  /** A text parameter's value (its unit is "Text"). */
  text?: string;
  /** "mm", "deg", "" (unitless), … */
  unit: string;
  /** Evaluated value in internal units: cm for lengths, radians for angles. */
  value: number;
  /** The parameter table this value is listed in. */
  table?: number;
}

export const parameterValue: RecordDecoder<ParameterValue> = {
  name: 'parameter value',
  decode: (seg: Segment, id: number) =>
    decodeLevel(seg, id, 'parameter value', (r, _props, version) => {
      if (version < 5 || version > 7) unsupported('parameter value', version);
      r.u8();
      if (version >= 6) r.u32(); // 4 or 5 for a dimension's or feature's parameter, 0 for a user parameter
      const comment = r.wstr();
      if (version >= 7) r.u8();
      const number = r.u32();
      const owner = r.ref();
      const expression = r.wstr();
      // Since version 7: 0 for a number, 1 for a text parameter.
      const text = version >= 7 && r.u32() === 1;
      // Five flags; the last is set on user parameters.
      const flags = r.take(5);
      const kind = r.wstr();
      const textValue = version >= 7 ? r.wstr() : '';
      const unit = r.wstr();
      const name = r.wstr();
      const value = r.f64();
      r.u8();
      const table = r.ref();
      return {
        id,
        number,
        ...(owner ? { owner: owner.id } : {}),
        name,
        expression,
        kind,
        user: flags[4] === 1,
        comment,
        ...(text ? { text: textValue } : {}),
        unit,
        value,
        ...(table ? { table: table.id } : {}),
      };
    }),
};
