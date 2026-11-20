/**
 * What the app says about loose chains (P6-25 S12a, ADR-0144), from real imports of the package's
 * fixtures: the reason is the failing feature's, and what is no loose chain reads as it always did.
 */
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { describe, expect, it } from 'vitest';
import { chainBrep, chainFile } from '../../../../packages/fcstd/src/chain-parts';
import { importFcstd } from '../../../../packages/fcstd/src/import';
import { nodeImportKernel } from '../../../../packages/fcstd/src/node-kernel-test-support';
import { fcstdNotices } from './actions';

const notices = async (bytes: Uint8Array) => {
  const solver = new SketchSolver(await loadPlanegcs());
  const { report } = await importFcstd(bytes, 'Chains', { kernel: nodeImportKernel(), solver });
  return fcstdNotices(report);
};
const setLength = (value: number) => (xml: string) =>
  xml.replace(/(<Property name="Length"[^>]*><Float value=")[^"]*/, `$1${value}`);

describe('loose chains in the import notices', () => {
  it('a chain on a foreign base gives its own feature as the reason', {
    timeout: 60_000,
  }, async () => {
    const said = await notices(
      chainFile('on_part_cut', {
        edit: (name, xml) => (name === 'Pad' ? setLength(5)(xml) : xml),
      }),
    );
    expect(said).toEqual([
      'Imported from the FreeCAD file: 1 of 1 shape, as a body without history.',
      "Taken from the file's own shapes, without their whole history: Pad, because a rebuilt feature didn't match the file's shape.",
    ]);
  });

  it('a binder at the top is a shape, not a row of features', { timeout: 60_000 }, async () => {
    const said = await notices(
      chainFile('pad_only', {
        extra: [
          {
            name: 'Binder',
            type: 'PartDesign::SubShapeBinder',
            xml: '<Object name="Binder"><Properties Count="1" TransientCount="0"><Property name="Shape" type="Part::PropertyPartShape"><Part file="Binder.Shape.brp"/></Property></Properties></Object>',
          },
        ],
        entries: { 'Binder.Shape.brp': chainBrep('pad_only', 'Pad') },
      }),
    );
    expect(said).toEqual([
      'Imported from the FreeCAD file: 2 of 2 shapes, 1 with its history and 1 as a body without history.',
    ]);
  });

  it('a row of features under a tree that doesn’t come in is named for what it is', {
    timeout: 60_000,
  }, async () => {
    const said = await notices(
      chainFile('tip_in_tree', {
        edit: (name, xml) => (name === 'Pocket' ? setLength(4)(xml) : xml),
      }),
    );
    expect(said.join(' ')).toContain(
      "because a body or a row of features it uses didn't come in with its history",
    );
  });
});
