import {
  createDocument,
  createDocumentStore,
  type ExtrudoDocument,
  type FeatureId,
  newId,
  type ParameterId,
} from '@extrudo/core';
import { useMemo, useState } from 'react';
import { ParametersDialog } from './ParametersDialog';

/** A small bracket: user parameters plus one feature with model parameters. */
function sampleDocument(): ExtrudoDocument {
  const param = (
    name: string,
    expression: string,
    unit: 'length' | 'angle' | 'unitless',
    comment?: string,
  ) => ({
    id: newId<ParameterId>(),
    name,
    expression,
    unit,
    ...(comment ? { comment } : {}),
  });
  return {
    ...createDocument({ name: 'Wall bracket' }),
    parameters: [
      param('width', '80 mm', 'length', 'Along the wall'),
      param('wall', '2.4 mm', 'length', 'Six perimeters of a 0.4 mm nozzle'),
      param('inner', 'width - 2 * wall', 'length'),
      param('tilt', '15 deg', 'angle'),
      param('holes', '2', 'unitless'),
    ],
    features: [
      {
        id: newId<FeatureId>(),
        type: 'extrude',
        name: 'Extrude1',
        suppressed: false,
        inputs: {
          distance: { kind: 'expr', expr: 'inner / 4', paramName: 'd1', unit: 'length' },
          taper: { kind: 'expr', expr: 'tilt / 3', paramName: 'd2', unit: 'angle' },
        },
      },
    ],
    timelineMarker: 1,
  };
}

/**
 * Parameters debug page (P0-07), at `#/debug/parameters`: the Parameters
 * dialog on a sample document, until the app shell (P0-04) has a place for it.
 */
export function ParametersDebug() {
  const store = useMemo(() => createDocumentStore(sampleDocument()), []);
  const [open, setOpen] = useState(true);
  return (
    <main className="parameters-debug">
      <h1>Parameters</h1>
      <p>The Parameters dialog on a sample document. Changes are kept until you reload.</p>
      <button type="button" onClick={() => setOpen(true)}>
        Open parameters
      </button>
      <ParametersDialog store={store} open={open} onClose={() => setOpen(false)} />
    </main>
  );
}
