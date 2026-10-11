/** Every record decoder, keyed by the type GUID it reads. */
import type { RecordDecoder } from './common';
import { PARAMETER_VALUE, parameterValue } from './parameters';
import { readScope } from './scope';
import {
  POINT_INCIDENCE,
  pointIncidence,
  SKETCH_CIRCULAR,
  SKETCH_LINE,
  SKETCH_POINT,
  sketchCircular,
  sketchLine,
  sketchPoint,
} from './sketch-geometry';
import { TIMELINE, timeline } from './timeline';

/** Feature record types (parameter scopes), with the kind they store. */
export const FEATURE_TYPES: Record<string, string> = {
  '8DA771B7-52ED-42FC-94E2-2353FE141373': 'Sketch',
  'DD405BC2-D673-44F0-8833-5CB2A1C186C7': 'Extrude',
  'A07D5F17-68CB-464D-9935-BF68E98A865F': 'Fillet',
  'F757D611-217B-4B72-9C41-B617BDCE43DA': 'Chamfer',
  'D869265F-F339-4751-A066-91D30F81FF08': 'WorkPlane',
  'E3849A15-2FC6-42A0-AF3A-2F1D7273B406': 'Revolve',
  '1C037A07-4A15-43F6-ABFC-BBF61B9038D4': 'Hole',
  '11F1A5CE-2B57-4476-8480-6994621493C9': 'CircularPattern',
  'D087EFE5-2D28-42E6-BB45-61739E7D0204': 'OffsetFaces',
};

const scopeDecoder: RecordDecoder<unknown> = { name: 'feature scope', decode: readScope };

export const DECODERS: Record<string, RecordDecoder<unknown>> = {
  ...Object.fromEntries(Object.keys(FEATURE_TYPES).map((g) => [g, scopeDecoder])),
  [PARAMETER_VALUE]: parameterValue,
  [TIMELINE]: timeline,
  [SKETCH_POINT]: sketchPoint,
  [SKETCH_LINE]: sketchLine,
  [SKETCH_CIRCULAR]: sketchCircular,
  [POINT_INCIDENCE]: pointIncidence,
};
