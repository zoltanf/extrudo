/**
 * Handles and the references they build (ADR-0068 §4): origin planes, axes and
 * the world origin, a feature as a reference, a construction feature's plane,
 * axis or point, its bodies, and the persistent names of its faces, edges and
 * vertices.
 *
 * The name tests are the point: they are the exact strings the kernel's naming
 * service writes into a body (`packages/kernel/src/naming/`), so a reference the
 * API builds resolves there instead of being a lost reference.
 */
import { describe, expect, it } from 'vitest';
import { Design, originRefs } from './index';
import { createdName, edgeName, indexedName, sourceToken, splitName, vertexName } from './names';

const d = () => Design.create({ now: '2026-10-05T00:00:00.000Z' });

describe('origin references', () => {
  it('has the three planes, the three axes and the origin', () => {
    const design = d();
    expect(design.origin).toEqual({
      xy: { kind: 'plane', id: 'origin:xy' },
      xz: { kind: 'plane', id: 'origin:xz' },
      yz: { kind: 'plane', id: 'origin:yz' },
      x: { kind: 'axis', id: 'origin:x' },
      y: { kind: 'axis', id: 'origin:y' },
      z: { kind: 'axis', id: 'origin:z' },
      point: { kind: 'point', id: 'origin:point' },
    });
    expect(originRefs()).toEqual(design.origin);
  });

  it('puts the origin point in a construction point feature', () => {
    const design = d();
    const at = design.constructionPoint({ at: design.origin.point, x: '5 mm' });
    expect(at.feature?.inputs.at).toEqual({
      kind: 'ref',
      refs: [{ kind: 'point', id: 'origin:point' }],
    });
    expect(design.validate()).toEqual([]);
  });
});

describe('feature handles', () => {
  it('name a feature and follow its later rename', () => {
    const design = d();
    const box = design.box();
    expect(box.name).toBe('Box1');
    design.rename(box, 'Base');
    expect(box.name).toBe('Base');
    expect(box.type).toBe('box');
    expect(box.id).toBe('f1');
  });

  it('become a feature reference, for a pattern or a mirror', () => {
    const design = d();
    const hole = design.hole({ diameter: '5 mm' });
    expect(hole.ref()).toEqual({ kind: 'feature', id: hole.id });
    const pattern = design.rectangularPattern({ features: [hole.ref()], count1: 3 });
    expect(pattern.feature?.inputs.features).toEqual({
      kind: 'ref',
      refs: [{ kind: 'feature', id: 'f1' }],
    });
  });

  it('are gone after an undo, and come back after a redo', () => {
    const design = d();
    const box = design.box();
    design.state.undo();
    expect(box.feature).toBeUndefined();
    design.state.redo();
    expect(box.feature?.type).toBe('box');
  });

  it('give a construction feature its plane, axis or point', () => {
    const design = d();
    const plane = design.offsetPlane({ plane: design.origin.xy, distance: '10 mm' });
    const axis = design.axisThroughPoints({
      points: [design.origin.point, design.ref('vertex', 'e1')],
    });
    const point = design.constructionPoint({ at: design.origin.point });
    expect(plane.constructionRef()).toEqual({ kind: 'plane', id: plane.id });
    expect(axis.constructionRef()).toEqual({ kind: 'axis', id: axis.id });
    expect(point.constructionRef()).toEqual({ kind: 'point', id: point.id });
    // A sketch or a box makes none of the three.
    expect(design.box().constructionRef()).toBeUndefined();
  });

  it('put a construction feature into a later feature as a plane', () => {
    const design = d();
    const plane = design.offsetPlane({ plane: design.origin.xy, distance: '10 mm' });
    const cut = design.box({ plane: plane.constructionRef(), length: '5 mm', height: '2 mm' });
    expect(cut.feature?.inputs.plane).toEqual({
      kind: 'ref',
      refs: [{ kind: 'plane', id: plane.id }],
    });
  });

  it('name their own body and the bodies they made', () => {
    const design = d();
    const box = design.box();
    expect(box.body()).toEqual({ kind: 'body', id: 'f1' });
    expect(box.bodies()).toEqual([{ kind: 'body', id: 'f1' }]);
    // A feature the kernel split into several named its bodies `f1:1`, `f1:2`;
    // those come from the document's own body metadata, as far as they are known.
    const split = design.splitBody({ bodies: [box.body()], plane: design.origin.yz });
    expect(split.body()).toEqual({ kind: 'body', id: 'f2' });
    expect(box.bodies()).toEqual([{ kind: 'body', id: 'f1' }]);
  });
});

describe('names of a box', () => {
  // A box's faces are named for the sides they are (`box:<id>:side:top` and so
  // on, ADR-0032), and its edges and vertices after the faces around them
  // (ADR-0005). The roles come from the definition (ADR-0068 §4).
  const box = () => d().box({ length: '20 mm', width: '30 mm', height: '10 mm' });

  it('names the faces box:<id>:side:…, as the kernel does', () => {
    const b = box();
    expect(b.faceName('cap:start')).toBe('box:f1:cap:start');
    expect(b.faceName('side:front')).toBe('box:f1:side:front');
    // A face an operation split in two is `#n`, as the kernel numbers pieces.
    expect(b.faceName('side:front', 1)).toBe('box:f1:side:front#1');
    expect(b.face('cap:end')).toEqual({ kind: 'face', id: 'box:f1:cap:end' });
  });

  it('names the edges e[face|face], sorted, with @n where they repeat', () => {
    const b = box();
    // The far face and the front meet along one edge.
    const edge = b.edge([b.faceName('cap:end'), b.faceName('side:front')]);
    expect(edge).toEqual({ kind: 'edge', id: 'e[box:f1:cap:end|box:f1:side:front]' });
    // One name, however it is written in.
    expect(b.edge(b.faceName('side:back'))).toEqual({ kind: 'edge', id: 'e[box:f1:side:back]' });
    // Several edges run between the same two faces: the first is @1.
    expect(b.edge([b.faceName('side:back'), b.faceName('side:right')], 1)).toEqual({
      kind: 'edge',
      id: 'e[box:f1:side:back|box:f1:side:right]@1',
    });
  });

  it('names the vertices v[face|face|face] where the faces meet', () => {
    const b = box();
    const corner = b.vertex([
      b.faceName('cap:end'),
      b.faceName('side:front'),
      b.faceName('side:right'),
    ]);
    expect(corner).toEqual({
      kind: 'vertex',
      id: 'v[box:f1:cap:end|box:f1:side:front|box:f1:side:right]',
    });
  });

  it('is the kernel grammar, spelled the same way', () => {
    const b = box();
    expect(b.faceName('side:front', 1)).toBe(splitName(createdName('box', 'f1', 'side:front'), 1));
    expect(edgeName(['b', 'a'])).toBe('e[a|b]');
    expect(vertexName(['a', 'a', 'b'])).toBe('v[a|b]');
    expect(indexedName('e[a|b]', 2)).toBe('e[a|b]@2');
    // A source that isn't a plain token is wrapped, so names nest.
    expect(sourceToken('l3')).toBe('l3');
    expect(sourceToken('extrude:f1:side:l3')).toBe('(extrude:f1:side:l3)');
    expect(createdName('fillet', 'f2', 'from', 'box:f1:side:front')).toBe(
      'fillet:f2:from:(box:f1:side:front)',
    );
  });
});

describe('names of an extrude', () => {
  // An extrude's start and end caps are `extrude:<id>:cap:start` and
  // `…:cap:end`, and the face each edge sweeps into is `…:side:<sketch curve>`
  // (`nameSweep`).
  it('names its caps and its sides', () => {
    const design = d();
    const ext = design.extrude({ distance: '10 mm' });
    expect(ext.faceName('cap:start')).toBe('extrude:f1:cap:start');
    expect(ext.faceName('cap:end')).toBe('extrude:f1:cap:end');
    expect(ext.faceName('side:l3', 1)).toBe('extrude:f1:side:l3#1');
    expect(ext.face('side:l3')).toEqual({ kind: 'face', id: 'extrude:f1:side:l3' });
    // The edge between the two caps, as the ADR's example builds it.
    expect(ext.edge(['extrude:f1:cap:start', 'extrude:f1:cap:end'])).toEqual({
      kind: 'edge',
      id: 'e[extrude:f1:cap:end|extrude:f1:cap:start]',
    });
  });

  it('names what the other creation features make', () => {
    const design = d();
    const revolve = design.revolve();
    expect(revolve.faceName('cap:start')).toBe('revolve:f1:cap:start');
    const cyl = design.cylinder();
    expect(cyl.faceName('side:wall')).toBe('cylinder:f2:side:wall');
    const torus = design.torus();
    expect(torus.faceName('side:surface')).toBe('torus:f3:side:surface');
    const fillet = design.fillet({
      edges: cyl.edge([cyl.faceName('side:wall'), cyl.faceName('cap:end')]),
    });
    expect(fillet.faceName('from:(cylinder:f2:side:wall)')).toBe(
      'fillet:f4:from:(cylinder:f2:side:wall)',
    );
  });
});

describe('ref', () => {
  it('builds anything the helpers do not', () => {
    const design = d();
    expect(design.ref('face', 'box:f1:face#2')).toEqual({ kind: 'face', id: 'box:f1:face#2' });
    expect(design.ref('vertex', 'v[a]', { type: 'point', at: [0, 0, 0], size: 0 })).toEqual({
      kind: 'vertex',
      id: 'v[a]',
      fingerprint: { type: 'point', at: [0, 0, 0], size: 0 },
    });
  });
});
