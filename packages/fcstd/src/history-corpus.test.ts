/**
 * The history import over a folder of real `.FCStd` files, when one is given
 * (P6-25 S5): every file through `importFcstd` with the kernel in Node and
 * the real solver, as numbers only. The files are other people's designs, so
 * none are checked in; `FCSTD_REPORT=<file>` writes a line per stop (file,
 * feature, why, the measures) to look into, outside the repository.
 *
 *   FCSTD_SAMPLES=<dir> pnpm vitest run packages/fcstd/src/history-corpus.test.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { describe, expect, it } from 'vitest';
import { mapModeOf } from './attach';
import { bodyChain } from './bodies';
import type { ReferenceTally } from './dressups';
import { decodeFeature, FEATURE_TYPES } from './features';
import { finalShapes } from './final-shapes';
import { importFcstd } from './import';
import type { ShapeElements } from './import-kernel';
import { edgeDistance, toleranceAt } from './match';
import { floatList, readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import { parameterCounts } from './parameters-report';
import { containerChain, fitsOriginPlane, frameIsSound, sketchFrame } from './sketch-place';

const PAD_TYPE_NAMES = ['Length', 'UpToLast', 'UpToFirst', 'UpToFace', 'TwoLengths', 'UpToShape'];
const POCKET_TYPE_NAMES = [
  'Length',
  'ThroughAll',
  'UpToFirst',
  'UpToFace',
  'TwoLengths',
  'UpToShape',
];

const root = process.env.FCSTD_SAMPLES;
const reportFile = process.env.FCSTD_REPORT;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.toLowerCase().endsWith('.fcstd')) yield path;
  }
}

const kindOf = (type: string) => FEATURE_TYPES[type] ?? 'other';
const bump = (r: Record<string, number>, k: string, by = 1) => {
  r[k] = (r[k] ?? 0) + by;
};
/** The counts of `kind`, made when first needed. */
const of = (r: Record<string, Record<string, number>>, kind: string) => {
  r[kind] ??= {};
  return r[kind];
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.min(s.length - 1, Math.floor(q * s.length))] as number);
};

describe.skipIf(!root)('the history import over a library (FCSTD_SAMPLES)', () => {
  it('reports, as numbers, what came in with its history and where it stopped', async () => {
    const files = [...walk(root as string)];
    const solver = new SketchSolver(await loadPlanegcs());
    const node = nodeImportKernel();
    // S6: how large the rebuilt bodies a dress-up describes are, and how long that takes.
    const described = { bodies: 0, mostEdges: 0, slowestMs: 0, storedCalls: 0 };
    // The report's own diagnosis, outside the importer: for each stored edge asked, every rebuilt
    // edge of the same kind compared (all pairs, the library is small), the match and the nearest other.
    const near = {
      matched: 0,
      furthestMatch: 0,
      nearestOther: Infinity,
      nearestOtherAnyKind: Infinity,
    };
    let lastStored: ShapeElements | undefined;
    const kernel: typeof node = {
      ...node,
      storedShapeToStep: (...a) => node.storedShapeToStep(...a),
      measureStoredShape: (...a) => node.measureStoredShape(...a),
      rebuild: (...a) => node.rebuild(...a),
      references: (i) => node.references(i),
      restart: () => node.restart(),
      describeStoredShape: async (...a) => {
        described.storedCalls++;
        lastStored = await node.describeStoredShape(...a);
        return lastStored;
      },
      describeBodies: async (b, n) => {
        const t = performance.now();
        const out = await node.describeBodies(b, n);
        described.slowestMs = Math.max(described.slowestMs, performance.now() - t);
        for (const d of Object.values(out)) {
          described.bodies++;
          described.mostEdges = Math.max(described.mostEdges, d.edgeCount);
        }
        const asked = new Set(lastStored?.edges.map((e) => e.index));
        for (const e of lastStored?.edges ?? []) {
          if (!asked.has(e.index)) continue;
          const ds = Object.values(out)
            .flatMap((d) => d.edges)
            .map((r) => ({
              d: edgeDistance(r, e),
              mid: Math.hypot(...r.midpoint.map((v, i) => v - (e.midpoint[i] as number))),
            }))
            .sort((x, y) => x.d - y.d);
          const best = ds[0];
          if (best && best.d <= toleranceAt(e.midpoint)) {
            near.matched++;
            near.furthestMatch = Math.max(near.furthestMatch, best.d);
            if (ds[1]) near.nearestOther = Math.min(near.nearestOther, ds[1].d);
            const others = ds.slice(1).map((x) => x.mid);
            if (others.length > 0)
              near.nearestOtherAnyKind = Math.min(near.nearestOtherAnyKind, ...others);
          }
        }
        return out;
      },
    };
    const refs = { found: 0, none: 0, several: 0, furthest: 0, nearestMiss: Infinity };
    const tally = (t: ReferenceTally | undefined) => {
      if (!t) return;
      refs.found += t.found;
      refs.none += t.none;
      refs.several += t.several;
      refs.furthest = Math.max(refs.furthest, t.furthest);
      if (t.nearestMiss !== undefined) refs.nearestMiss = Math.min(refs.nearestMiss, t.nearestMiss);
    };
    const dressUps = {
      useAllEdges: 0,
      mostElements: 0,
      elementKinds: {} as Record<string, number>,
    };
    const byDrift: Record<string, { volume: number[]; area: number[]; centre: number[] }> = {};
    const byKind: Record<string, Record<string, number>> = {};
    const bodies: Record<string, number> = {};
    const fellBackAt: Record<string, number> = {};
    const equal: { volume: number[]; area: number[]; box: number[]; centre: number[] } = {
      volume: [],
      area: [],
      box: [],
      centre: [],
    };
    const differed: {
      volume: number;
      area: number;
      box: number;
      centre: number;
      solids: boolean;
    }[] = [];
    const times: number[] = [];
    let restarts = 0;
    let longestChain = 0;
    let mostFeatures = 0;
    let importsS3 = 0;
    let importsS5 = 0;
    let otherSame = 0;
    let otherDiffer = 0;
    const lines: string[] = [];
    const census: Record<string, number> = {};
    // S10: the parameters and every expression's outcome, as counts.
    const s10 = {
      parameters: {} as Record<string, Record<string, number>>,
      parametersLeftOut: {} as Record<string, number>,
      expressions: {} as Record<string, Record<string, number>>,
      renames: {} as Record<string, number>,
      rounds: 0,
      /** The expressions that came in as numbers on what came in, by reason and their shape. */
      numbers: {} as Record<string, Record<string, number>>,
    };
    // S7: how far another FreeCAD body's Extrudo body moved between two rebuilds it wasn't part of.
    const untouched = {
      checks: 0,
      volume: 0,
      area: 0,
      corner: 0,
      centre: 0,
      each: [] as number[][],
    };
    // S7: what the transforms and holes in the files hold, and what the walk did with them.
    const s7 = {
      secondAttempts: 0,
      heldAtSecond: 0,
      threadsLost: 0,
      constructions: 0,
      multiTransformSteps: 0,
      wholeShape: 0,
      customGaps: 0,
      suppressedPositions: 0,
      holeCut: {} as Record<string, number>,
      references: {} as Record<string, number>,
    };
    // S8: the stored-shape steps, what holds after them, and what they cost.
    const s8 = {
      steps: {} as Record<string, number>,
      longerRuns: 0,
      mostSteps: 0,
      bodiesWithSteps: 0,
      heldAfterStep: {} as Record<string, number>,
      notHeldAfterStep: {} as Record<string, number>,
      /** Attachment bytes with steps, and with steps turned off (every body ends as before S8). */
      bytes: 0,
      bytesWithoutSteps: 0,
      largestStepFile: 0,
    };
    // S9: up-to extents, datums, tilted sketches and projected geometry: in the files and as they came in.
    const s9 = {
      upToInFiles: {} as Record<string, number>,
      upTo: {} as Record<string, number>,
      upToTries: 0,
      axesInFiles: {} as Record<string, number>,
      datumsInFiles: {} as Record<string, number>,
      datums: {} as Record<string, number>,
      tiltedInFiles: 0,
      tilted: {} as Record<string, number>,
      externalLinks: {} as Record<string, number>,
      external: {
        sketches: 0,
        named: 0,
        projected: 0,
        constraints: 0,
        leftOutExternal: 0,
        out: {} as Record<string, number>,
      },
    };
    const verdict = (x: { reason?: string }) =>
      x.reason === undefined
        ? 'not tried'
        : x.reason === 'differs'
          ? 'differed'
          : `stop:${x.reason}`;
    const bytesOf = (d: {
      doc: { attachments?: Record<string, { sha256: string; size: number }> };
    }) => {
      const seen = new Map<string, number>();
      for (const a of Object.values(d.doc.attachments ?? {})) seen.set(a.sha256, a.size);
      return [...seen.values()].reduce((n, b) => n + b, 0);
    };
    for (const file of files) {
      const bytes = new Uint8Array(readFileSync(file));
      const doc = readFcstd(bytes);
      let walked = 0;
      for (const o of doc.objects) {
        if (FEATURE_TYPES[o.type]) bump(census, `${kindOf(o.type)} in the file`);
        // S9's census.
        if (o.type === 'PartDesign::Line' || o.type === 'PartDesign::Plane')
          bump(s9.datumsInFiles, `${o.type.slice('PartDesign::'.length)} ${mapModeOf(o)}`);
        if (o.type === 'PartDesign::Pad' || o.type === 'PartDesign::Pocket') {
          const t = o.properties.Type?.value;
          const names = o.type === 'PartDesign::Pad' ? PAD_TYPE_NAMES : POCKET_TYPE_NAMES;
          const i = t?.kind === 'enum' ? t.index : t?.kind === 'integer' ? t.value : 0;
          const name = t?.kind === 'enum' && t.values ? t.values[i] : names[i];
          if (name?.startsWith('UpTo')) bump(s9.upToInFiles, `${kindOf(o.type)} ${name}`);
        }
        if (o.type === 'PartDesign::Revolution' || o.type === 'PartDesign::Groove') {
          const v = o.properties.ReferenceAxis?.value;
          const target = v?.kind === 'linkSub' && v.object ? doc.byName.get(v.object) : undefined;
          const sub = v?.kind === 'linkSub' ? (v.subs[0]?.name ?? '') : '';
          bump(
            s9.axesInFiles,
            `${target?.type.startsWith('Sketcher') ? 'sketch' : (target?.type ?? 'none')} ${sub.replace(/\d+$/, 'N') || '(whole)'}`,
          );
        }
        if (o.type.startsWith('Sketcher::SketchObject')) {
          const ext = o.properties.ExternalGeometry?.value;
          if (ext?.kind === 'linkSubList')
            for (const item of ext.items) {
              const target = doc.byName.get(item.object);
              bump(
                s9.externalLinks,
                `${target?.type ?? 'missing'} ${item.sub.name.replace(/\d+$/, 'N') || '(whole)'}`,
              );
            }
          const g = sketchFrame(doc, o).global;
          if (frameIsSound(g) && !fitsOriginPlane(g)) s9.tiltedInFiles++;
        }
        const kind = FEATURE_TYPES[o.type];
        if (kind === 'multi') {
          const t = o.properties.Transformations?.value;
          if (t?.kind === 'linkList') s7.multiTransformSteps += t.objects.length;
        }
        if (kind === 'linear' || kind === 'polar' || kind === 'mirrored' || kind === 'multi') {
          const mode = o.properties.TransformMode?.value;
          if (
            (mode?.kind === 'enum' || mode?.kind === 'integer') &&
            (mode.kind === 'enum' ? mode.index : mode.value) === 1
          )
            s7.wholeShape++;
          for (const name of ['Spacings', 'Spacings2']) {
            if (!o.properties[name]) continue;
            const list = floatList(doc, o, name);
            if (list?.some((g) => g > 0)) s7.customGaps++;
          }
          for (const name of ['SuppressedIndices', 'SuppressedPositions']) {
            const v = o.properties[name]?.value;
            if (v && !(v.kind === 'integerList' && v.values.length === 0)) s7.suppressedPositions++;
          }
          for (const name of ['Direction', 'Direction2', 'Axis', 'MirrorPlane']) {
            const v = o.properties[name]?.value;
            if (v?.kind !== 'linkSub' || !v.object) continue;
            const target = doc.byName.get(v.object);
            const sub = v.subs[0]?.name ?? '';
            bump(
              s7.references,
              `${name}: ${target?.type.startsWith('Sketcher') ? 'sketch' : (target?.type ?? 'missing')} ${sub.replace(/\d+$/, 'N') || '(whole)'}`,
            );
          }
        }
        if (kind === 'hole') {
          const v = o.properties.HoleCutType?.value;
          bump(
            s7.holeCut,
            v?.kind === 'enum'
              ? `${v.values ? (v.values[v.index] ?? '?') : `index ${v.index}`}`
              : `index ${v?.kind === 'integer' ? v.value : '?'}`,
          );
        }
        if (o.type !== 'PartDesign::Fillet' && o.type !== 'PartDesign::Chamfer') continue;
        const all = o.properties.UseAllEdges?.value;
        if (all?.kind === 'bool' && all.value) dressUps.useAllEdges++;
        const b = o.properties.Base?.value;
        if (b?.kind === 'linkSub') {
          dressUps.mostElements = Math.max(dressUps.mostElements, b.subs.length);
          for (const sub of b.subs) bump(dressUps.elementKinds, sub.name.replace(/\d+$/, ''));
        }
      }
      for (const s of finalShapes(doc)) {
        if (s.kind !== 'body') continue;
        const chain = bodyChain(doc, s.object);
        for (const f of 'features' in chain ? chain.features : [])
          if (FEATURE_TYPES[f.type]) bump(census, `${kindOf(f.type)} in a body's chain`);
        const n = 'features' in chain ? chain.features.length : 0;
        longestChain = Math.max(longestChain, n);
        walked += n;
      }
      mostFeatures = Math.max(mostFeatures, walked);
      // S3's way first, for what is not a body.
      const s3 = await importFcstd(bytes, 'X', { kernel, maxFileFeatures: 0 });
      const withoutSteps = await importFcstd(bytes, 'X', { kernel, solver, maxSteps: 0 });
      s8.bytesWithoutSteps += bytesOf(withoutSteps.design);
      const t = performance.now();
      const { report, design } = await importFcstd(bytes, 'X', {
        kernel,
        solver,
        onUntouched: (d) => {
          untouched.checks++;
          untouched.each.push([d.volume, d.area, d.corner, d.centre]);
          untouched.volume = Math.max(untouched.volume, d.volume);
          untouched.area = Math.max(untouched.area, d.area);
          const of = (v: number) => (d.diagonal > 0 ? v / d.diagonal : v);
          untouched.corner = Math.max(untouched.corner, of(d.corner));
          untouched.centre = Math.max(untouched.centre, of(d.centre));
        },
      });
      times.push(performance.now() - t);
      {
        const p = parameterCounts(report.parameters);
        for (const [source, kinds] of Object.entries(p.parameters))
          for (const [kind, n] of Object.entries(kinds)) bump(of(s10.parameters, source), kind, n);
        for (const x of report.parameters.leftOut) bump(s10.parametersLeftOut, x.reason);
        for (const [target, outs] of Object.entries(p.expressions))
          for (const [o, n] of Object.entries(outs)) bump(of(s10.expressions, target), o, n);
        for (const c of report.parameters.renames) bump(s10.renames, `${c.what} ${c.why}`);
        s10.rounds += report.parameters.rounds;
        for (const e of report.parameters.expressions) {
          if (e.outcome === 'kept' || e.outcome === 'unmapped') continue;
          // The expression's shape only: names as X, quoted labels as <<L>>, numbers as N.
          const shape = e.expression
            .replace(/<<[^>]*>>/g, '<<L>>')
            .replace(/[0-9]+(?:[.,][0-9]+)?(?:e-?[0-9]+)?/g, 'N')
            .replace(/[A-Za-z_][A-Za-z0-9_]*/g, (w) =>
              /^(sin|cos|tan|asin|acos|atan|atan2|sqrt|abs|min|max|round|floor|ceil|trunc|exp|log|log10|mod|pow|hypot|cath|sum|average|count|Constraints|Length|Length2|Value|Placement|Base|Shape|hiddenref|href|tuple|str|mm|deg|in|ft|cm|m|rad)$/.test(
                w,
              )
                ? w
                : 'X',
            );
          bump(of(s10.numbers, `${e.outcome} on ${e.target}`), shape);
          lines.push(
            JSON.stringify({
              file,
              s10: e.outcome,
              target: e.target,
              object: e.object,
              path: e.path,
              expression: e.expression,
              detail: e.detail,
            }),
          );
        }
      }
      s8.bytes += bytesOf(design);
      restarts += report.restarts;
      importsS3 += s3.report.shapes.length;
      importsS5 += report.shapes.length;
      const bodyNames = new Set(report.bodies.map((b) => b.object));
      const outcome = (r: typeof report) =>
        new Map([
          ...r.shapes.map((x) => [x.object, `in ${x.solids} ${x.drift.toPrecision(3)}`] as const),
          ...r.leftOut.map((x) => [x.object, `out ${x.reason}`] as const),
        ]);
      const before = outcome(s3.report);
      const after = outcome(report);
      for (const [object, o] of before) {
        if (bodyNames.has(object)) continue;
        if (after.get(object) === o) otherSame++;
        else otherDiffer++;
      }
      for (const b of report.bodies) {
        bump(bodies, b.outcome);
        s7.secondAttempts += b.secondAttempts;
        s9.upToTries += b.upToTries;
        for (const m of b.mapped) {
          if (m.references && m.references.none + m.references.several > 0)
            lines.push(
              JSON.stringify({ file, feature: m.object, kind: m.kind, references: m.references }),
            );
          if (m.upTo)
            bump(s9.upTo, `${m.kind} ${m.upTo.method} → ${m.upTo.target} (try ${m.upTo.tries})`);
          for (const d of m.datums ?? []) bump(s9.datums, `${d.mode} → ${d.how}`);
        }
        for (const sk of b.sketches) {
          if (sk.plane === 'datum' || sk.plane === 'points') bump(s9.tilted, sk.plane);
          if (sk.external) {
            lines.push(
              JSON.stringify({
                file,
                sketch: sk.sketch,
                external: sk.external,
                leftOut: sk.constraints.leftOut,
                links: doc.byName.get(sk.sketch)?.properties.ExternalGeometry?.value,
              }),
            );
            s9.external.sketches++;
            s9.external.named += sk.external.named;
            s9.external.projected += sk.external.projected;
            s9.external.constraints += sk.external.constraints;
            for (const [why, k] of Object.entries(sk.external.out ?? {}))
              bump(s9.external.out, why, k as number);
          }
          s9.external.leftOutExternal += sk.constraints.leftOut.external ?? 0;
        }
        for (const m of b.mapped) {
          if (m.secondAttempt) s7.heldAtSecond++;
          if (m.threadLost) s7.threadsLost++;
          s7.constructions += m.constructions ?? 0;
        }
        const body = doc.byName.get(b.object);
        const chain = body ? bodyChain(doc, body) : { broken: '' };
        const features = 'features' in chain ? chain.features : [];
        // S8: each step's run, and what held after the first step.
        s8.mostSteps = Math.max(s8.mostSteps, b.steps.length);
        if (b.steps.length > 0) s8.bodiesWithSteps++;
        b.steps.forEach((st, k) => {
          const [head] = st.features;
          bump(s8.steps, `${kindOf(head?.type ?? '')} (${st.reason})`);
          if (st.features.length > 1) s8.longerRuns++;
          bump(
            of(byKind, kindOf(head?.type ?? '')),
            st.reason === 'differs' ? 'differed' : `stop:${st.reason}`,
          );
          st.features.forEach((x, j) => {
            if (j > 0) bump(of(byKind, kindOf(x.type)), verdict(x));
            if (k > 0 || j > 0) {
              bump(s8.notHeldAfterStep, `${kindOf(x.type)} ${verdict(x)}`);
              lines.push(JSON.stringify({ file, body: b.object, afterStep: x }));
            }
          });
          const imp = design.doc.features.find((f) => f.id === st.feature);
          const fileId = (imp?.inputs as { file?: { id?: string } } | undefined)?.file?.id;
          const size = fileId ? design.doc.attachments?.[fileId as never]?.size : undefined;
          s8.largestStepFile = Math.max(s8.largestStepFile, size ?? 0);
        });
        if (b.stop || b.steps.length > 0)
          lines.push(
            JSON.stringify({
              file,
              body: b.object,
              outcome: b.outcome,
              features: b.features,
              mapped: b.mapped.map((m) => m.kind),
              steps: b.steps.map((st) => ({ after: st.after, run: st.features })),
              stop: b.stop && {
                ...b.stop,
                at: features.findIndex((f) => f.name === b.stop?.object),
              },
              chain: features.map((f) => kindOf(f.type)),
            }),
          );
        const firstStep = b.steps[0]?.after;
        if (firstStep !== undefined)
          for (const m of b.mapped.slice(firstStep)) bump(s8.heldAfterStep, m.kind);
        if (b.steps.length > 0 && b.stop) {
          for (const x of [
            { type: b.stop.type, reason: b.stop.reason, detail: b.stop.detail },
            ...(b.stop.run ?? []),
          ]) {
            bump(s8.notHeldAfterStep, `${kindOf(x.type)} ${verdict(x)}`);
            lines.push(JSON.stringify({ file, body: b.object, afterStep: x }));
          }
        }
        for (const m of b.mapped) {
          bump(of(byKind, m.kind), 'equal');
          tally(m.references);
          byDrift[m.kind] ??= { volume: [], area: [], centre: [] };
          byDrift[m.kind]?.volume.push(m.drift.volume);
          byDrift[m.kind]?.area.push(m.drift.area);
          byDrift[m.kind]?.centre.push(
            m.drift.diagonal > 0 ? m.drift.centre / m.drift.diagonal : 0,
          );
          equal.volume.push(m.drift.volume);
          equal.area.push(m.drift.area);
          equal.box.push(m.drift.diagonal > 0 ? m.drift.corner / m.drift.diagonal : m.drift.corner);
          equal.centre.push(
            m.drift.diagonal > 0 ? m.drift.centre / m.drift.diagonal : m.drift.centre,
          );
        }
        if (!b.stop) continue;
        tally(b.stop.references);
        const at = features.findIndex((f) => f.name === b.stop?.object);
        const kind = kindOf(b.stop.type);
        bump(fellBackAt, `${kind} (${b.stop.reason})`);
        bump(of(byKind, kind), b.stop.reason === 'differs' ? 'differed' : `stop:${b.stop.reason}`);
        // The rest of a run that reached the tip was tried, or not (S8); what follows a stop that ends the body wasn't reached.
        for (const x of b.stop.run ?? []) bump(of(byKind, kindOf(x.type)), verdict(x));
        for (const f of features.slice(at + 1 + (b.stop.run?.length ?? 0)))
          bump(of(byKind, kindOf(f.type)), 'not reached');
        if (b.stop.drift)
          differed.push({
            volume: b.stop.drift.volume,
            area: b.stop.drift.area,
            box:
              b.stop.drift.diagonal > 0
                ? b.stop.drift.corner / b.stop.drift.diagonal
                : b.stop.drift.corner,
            centre:
              b.stop.drift.diagonal > 0
                ? b.stop.drift.centre / b.stop.drift.diagonal
                : b.stop.drift.centre,
            solids: /solid/.test(b.stop.detail ?? ''),
          });
        const f = features[at];
        const frame = f ? containerChain(doc, f) : undefined;
        const decoded =
          f && body
            ? decodeFeature(doc, f, {
                body,
                moved: frame?.moved ?? false,
                ...(features[at - 1]
                  ? { previous: (features[at - 1] as { name: string }).name }
                  : {}),
              })
            : undefined;
        lines.push(
          JSON.stringify({
            file,
            body: b.object,
            feature: b.stop.object,
            type: b.stop.type,
            reason: b.stop.reason,
            detail: b.stop.detail,
            drift: b.stop.drift,
            references: b.stop.references,
            mapped: b.mapped.length,
            decoded: decoded?.ok ? decoded.feature : decoded,
          }),
        );
      }
    }
    const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
    const min = (xs: number[]) => xs.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
    const summary = {
      files: files.length,
      census,
      byKind,
      bodies,
      fellBackAt,
      equalDrift: {
        volume: {
          max: max(equal.volume),
          p99: quantile(equal.volume, 0.99),
          p50: quantile(equal.volume, 0.5),
        },
        area: {
          max: max(equal.area),
          p99: quantile(equal.area, 0.99),
          p50: quantile(equal.area, 0.5),
        },
        box: { max: max(equal.box), p99: quantile(equal.box, 0.99), p50: quantile(equal.box, 0.5) },
        centre: {
          max: max(equal.centre),
          p99: quantile(equal.centre, 0.99),
          p50: quantile(equal.centre, 0.5),
        },
      },
      nearestDiffered: {
        sameSolids: differed.filter((d) => !d.solids).length,
        volume: min(differed.filter((d) => !d.solids).map((d) => d.volume)),
        area: min(differed.filter((d) => !d.solids).map((d) => d.area)),
        box: min(differed.filter((d) => !d.solids).map((d) => d.box)),
        centre: min(differed.filter((d) => !d.solids).map((d) => d.centre)),
        largestOfThree: min(
          differed.filter((d) => !d.solids).map((d) => Math.max(d.volume, d.area, d.box)),
        ),
      },
      timeMs: { median: Math.round(quantile(times, 0.5)), slowest: Math.round(max(times)) },
      restarts,
      longestChain,
      mostFeaturesInAFile: mostFeatures,
      imports: { s3: importsS3, s5: importsS5 },
      references: refs,
      nearMisses: near,
      dressUps,
      described,
      equalDriftByKind: Object.fromEntries(
        Object.entries(byDrift).map(([k, d]) => [
          k,
          { volume: max(d.volume), area: max(d.area), centre: max(d.centre), n: d.volume.length },
        ]),
      ),
      notBodies: { same: otherSame, differ: otherDiffer },
      s7,
      untouched,
      s8,
      s9,
      s10,
    };
    console.log(JSON.stringify(summary, null, 1));
    if (reportFile) writeFileSync(reportFile, `${JSON.stringify(summary)}\n${lines.join('\n')}\n`);
    expect(otherDiffer).toBe(0);
  }, 3_600_000);
});
