// The OpenSCAD export's printer, names and polyhedra (P6-09, ADR-0088):
// every IR node printed as OpenSCAD reads it (the file below is rendered by
// OpenSCAD's real WASM), module names that are identifiers, and a mesh turned
// clockwise with its points rounded and merged.
import type { BodyId } from '@extrudo/core';
import { read3mf } from '@extrudo/io';
import type { ScadCompiler } from '@extrudo/openscad';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fragmentSize, scadIdentifier } from './file';
import { boolean, type CsgNode, matrixOf, torus } from './ir';
import { polyhedronOf } from './mesh';
import { type PrintRefs, printModule, printNode } from './print';

const NODE_ENTRY = '@extrudo/openscad/node';
let compiler: ScadCompiler;

beforeAll(async () => {
  const { createNodeCompiler } = (await import(/* @vite-ignore */ NODE_ENTRY)) as {
    createNodeCompiler(): ScadCompiler;
  };
  compiler = createNodeCompiler();
});

afterAll(() => compiler.dispose());

const refs: PrintRefs = {
  version: (body, n) => `${body.replace(':', '_')}_v${n}`,
  tool: (tool) => (tool === 0 ? 'Cutter_tool' : { kind: 'sphere', r: 1 }),
};

const print = (node: CsgNode) => printNode(node, refs).join('\n');

describe('printNode', () => {
  it('writes each kind of node', () => {
    expect(print({ kind: 'cube', size: [1, 2, 3] })).toBe('cube([1, 2, 3]);');
    expect(print({ kind: 'cube', size: [1, 2, 3], center: true })).toBe(
      'cube(size = [1, 2, 3], center = true);',
    );
    expect(print({ kind: 'cylinder', h: 10, r1: 2, r2: 1, center: true })).toBe(
      'cylinder(h = 10, r1 = 2, r2 = 1, center = true);',
    );
    expect(print({ kind: 'sphere', r: { expr: 'd / 2', value: 5, refs: ['d'] } })).toBe(
      'sphere(r = d / 2);',
    );
    expect(
      print({ kind: 'rotate', a: 90, v: [0, 0, 1], children: [{ kind: 'sphere', r: 1 }] }),
    ).toBe('rotate(a = 90, v = [0, 0, 1])\n  sphere(r = 1);');
    expect(print({ kind: 'rotate', a: [0, 90, 0], children: [{ kind: 'sphere', r: 1 }] })).toBe(
      'rotate([0, 90, 0])\n  sphere(r = 1);',
    );
    expect(
      print({
        kind: 'multmatrix',
        m: matrixOf([1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, -0.1 - 0.2, 0, 0, 0, 1]),
        children: [{ kind: 'version', body: 'B:0' as BodyId, version: 3 }],
      }),
    ).toBe('multmatrix([[1, 0, 0, 5], [0, 1, 0, 0], [0, 0, 1, -0.3], [0, 0, 0, 1]])\n  B_0_v3();');
    expect(
      print({
        kind: 'difference',
        children: [
          { kind: 'tool', tool: 0 },
          { kind: 'tool', tool: 1 },
        ],
      }),
    ).toBe('difference() {\n  Cutter_tool();\n  sphere(r = 1);\n}');
    expect(
      print({
        kind: 'linear_extrude',
        height: 5,
        center: true,
        children: [
          {
            kind: 'polygon',
            points: [
              [0, 0],
              [1, 0],
              [0, 1],
            ],
          },
        ],
      }),
    ).toBe(
      'linear_extrude(height = 5, center = true)\n  polygon(points = [\n    [0, 0], [1, 0], [0, 1]\n  ]);',
    );
    expect(print({ kind: 'rotate_extrude', angle: 90, children: [{ kind: 'circle', r: 1 }] })).toBe(
      'rotate_extrude(angle = 90)\n  circle(r = 1);',
    );
    expect(
      print({ kind: 'color', color: '#ff0000', alpha: 0.5, children: [{ kind: 'sphere', r: 1 }] }),
    ).toBe('color("#ff0000", 0.5)\n  sphere(r = 1);');
  });

  it('writes a module around a node', () => {
    expect(
      printModule('Body1_v2', boolean('union', [{ kind: 'sphere', r: 1 }]), refs).join('\n'),
    ).toBe('module Body1_v2() {\n  sphere(r = 1);\n}');
  });

  it('writes what OpenSCAD renders', async () => {
    const square: CsgNode = {
      kind: 'polygon',
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
      ],
      paths: [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ],
    };
    const parts: CsgNode[] = [
      { kind: 'linear_extrude', height: 2, center: true, children: [square] },
      { kind: 'translate', v: [30, 0, 0], children: [torus(8, 2)] },
      {
        kind: 'translate',
        v: [0, 30, 0],
        children: [
          {
            kind: 'rotate_extrude',
            angle: 180,
            children: [
              { kind: 'translate', v: [5, 0, 0], children: [{ kind: 'square', size: [2, 4] }] },
            ],
          },
        ],
      },
      {
        kind: 'multmatrix',
        m: matrixOf([1, 0, 0, -30, 0, 1, 0, 0, 0, 0, 1, 0]),
        children: [
          {
            kind: 'difference',
            children: [
              { kind: 'cube', size: [10, 10, 10], center: true },
              { kind: 'cylinder', h: 20, r1: 2, r2: 2, center: true },
            ],
          },
        ],
      },
      {
        kind: 'intersection',
        children: [
          {
            kind: 'mirror',
            v: [1, 0, 0],
            children: [{ kind: 'translate', v: [30, 30, 0], children: [{ kind: 'sphere', r: 5 }] }],
          },
          {
            kind: 'scale',
            v: [1, 1, 0.5],
            children: [
              {
                kind: 'translate',
                v: [-30, 30, 0],
                children: [{ kind: 'cube', size: [20, 20, 20], center: true }],
              },
            ],
          },
        ],
      },
      {
        kind: 'color',
        color: '#336699',
        children: [
          {
            kind: 'rotate',
            a: 45,
            v: [0, 0, 1],
            children: [
              { kind: 'translate', v: [0, -30, 0], children: [{ kind: 'cube', size: [4, 4, 4] }] },
            ],
          },
        ],
      },
    ];
    const source = ['$fa = 15;', '$fs = 0.4;', ...parts.flatMap((p) => printNode(p, refs))].join(
      '\n',
    );
    const result = await compiler.compile({
      fileName: 'nodes.scad',
      source: new TextEncoder().encode(source),
    });
    if (!result.ok) throw new Error(`${result.error}\n${source}`);
    expect(result.warnings).toEqual([]);
    expect(read3mf(result.model).objects.length).toBeGreaterThan(0);
  });
});

describe('scadIdentifier', () => {
  it('makes an OpenSCAD identifier of any name', () => {
    expect(scadIdentifier('Bracket')).toBe('Bracket');
    expect(scadIdentifier('Lid (top) – v2')).toBe('Lid_top_v2');
    expect(scadIdentifier('3D part')).toBe('_3D_part');
    expect(scadIdentifier('Größe')).toBe('Gro_e');
    expect(scadIdentifier('…')).toBe('Body');
    expect(scadIdentifier('module')).toBe('module_');
  });
});

describe('fragmentSize', () => {
  it('gives the chord the deflection allows on a 1 mm radius', () => {
    expect(fragmentSize(0.02)).toBe(0.4);
    expect(fragmentSize(0.1)).toBe(0.89);
    expect(fragmentSize(0.005)).toBe(0.2);
  });
});

describe('polyhedronOf', () => {
  it('rounds, merges, drops collapsed triangles and turns faces clockwise', () => {
    const node = polyhedronOf({
      // Two nodes 1e-6 apart become one point; a sliver collapses.
      positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1.000001, 0, 0, 0, 0, -0.00000001]),
      indices: new Uint32Array([0, 1, 2, 3, 2, 4, 0, 3, 1]),
    });
    expect(node.points).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    // (0 1 2) is written (0 2 1); (3 2 4) is (1 2 0) → (1 0 2); (0 3 1) collapses.
    expect(node.faces).toEqual([
      [0, 2, 1],
      [1, 0, 2],
    ]);
    expect(Object.is(node.points[0]?.[2], -0)).toBe(false);
  });
});
