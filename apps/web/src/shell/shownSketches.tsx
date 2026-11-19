/**
 * The shown sketches with their profile results (ADR-0154), out of the shell's
 * render (ADR-0156's amendment of 2026-11-19). The shell builds the drawings
 * from the document (`ShownSketchBase`: what doesn't change when a result
 * arrives); `ShownSketchesProvider` adds each closed sketch's regions, fill
 * and verdict and hands them to the two places that show them, the viewport
 * and the status bar's note, through `ShownSketchesContext`. A batch of
 * results then renders those, not the shell: the shell is too large for the
 * React Compiler to memoise (it bails out of it), so every render of it made
 * new callbacks for the app bar, the toolbar, the timeline and the browser.
 */
import type { SketchData } from '@extrudo/core';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { uiFontBytes } from '../sketch/fonts';
import { hasText } from '../sketch/profiles';
import {
  closedSketchShows,
  idleRegions,
  type RegionsClient,
  type RegionsEntry,
  type RegionsJob,
} from '../sketch/regionsClient';
import {
  grantedBytes,
  type RegionClaim,
  type RegionVerdict,
  regionBudget,
  regionVerdicts,
  unbuiltFills,
} from '../viewport/profileFills';
import type { SketchDrawing } from '../viewport/sketchGeometry';

/** One shown sketch as the shell sees it: its drawing, and its claim or job when profiles show. */
export type ShownSketchItem =
  | { drawing: SketchDrawing; kind: 'plain' }
  /** The open sketch: found synchronously by the shell, only its claim on the budget is kept. */
  | { drawing: SketchDrawing; kind: 'open'; claim: RegionClaim }
  /** A closed sketch: its regions come from the worker. */
  | { drawing: SketchDrawing; kind: 'closed'; job: RegionsJob };

/** The drawings from the document, in timeline order; never written to afterwards. */
export interface ShownSketchBase {
  items: readonly ShownSketchItem[];
  /** The fonts' version the jobs were made for. */
  fontsVersion: number;
  activeSketchId: string | undefined;
}

export interface ShownSketches {
  drawings: readonly SketchDrawing[];
  unshaded: number;
  unpickable: number;
}

/** How many shown sketches go unshaded, and how many of those can't be picked either. */
export interface SketchShading {
  unshaded: number;
  unpickable: number;
}

const NO_DRAWINGS: readonly SketchDrawing[] = [];
const NO_SHADING: SketchShading = { unshaded: 0, unpickable: 0 };

/** Two contexts, so a result that changes no count doesn't render the status bar's note. */
const DrawingsContext = createContext<readonly SketchDrawing[]>(NO_DRAWINGS);
const ShadingContext = createContext<SketchShading>(NO_SHADING);

/** The shown sketches with their results, for the viewport. */
export function useShownDrawings(): readonly SketchDrawing[] {
  return useContext(DrawingsContext);
}

/** The counts the status bar's note shows. */
export function useSketchShading(): SketchShading {
  return useContext(ShadingContext);
}

/** What a drawing becomes with its results; the same object while they don't change. */
interface Dressed {
  regions: SketchDrawing['regions'];
  fill: SketchDrawing['fill'];
  unshaded: boolean;
  drawing: SketchDrawing;
}

function dressed(
  memo: WeakMap<SketchDrawing, Dressed>,
  base: SketchDrawing,
  regions: SketchDrawing['regions'],
  fill: SketchDrawing['fill'],
  unshaded: boolean,
): SketchDrawing {
  if (!regions && !fill && !unshaded) return base;
  const known = memo.get(base);
  if (known && known.regions === regions && known.fill === fill && known.unshaded === unshaded) {
    return known.drawing;
  }
  const drawing: SketchDrawing = {
    ...base,
    ...(regions && { regions }),
    ...(fill && { fill }),
    ...(unshaded && { unshaded: true }),
  };
  memo.set(base, { regions, fill, unshaded, drawing });
  return drawing;
}

/**
 * The results' part of the shown sketches: which closed sketches have regions,
 * a fill or a verdict, the budget's verdicts, and the jobs the worker is asked
 * for. `held` is what the open sketch was granted when it was opened; the
 * returned `held` is what to keep for the next call.
 */
export function withResults(
  base: ShownSketchBase,
  client: RegionsClient | undefined,
  held: { id: string; bytes: number } | undefined,
  memo: WeakMap<SketchDrawing, Dressed>,
): ShownSketches & {
  jobs: RegionsJob[];
  granted: Map<SketchData, RegionVerdict>;
  held: { id: string; bytes: number } | undefined;
} {
  const { items, fontsVersion, activeSketchId } = base;
  const claims: RegionClaim[] = [];
  const jobs: RegionsJob[] = [];
  const entries = new Map<string, RegionsEntry>();
  for (const item of items) {
    if (item.kind === 'open') claims.push(item.claim);
    if (item.kind !== 'closed') continue;
    const entry = client?.get(item.job.data, fontsVersion);
    if (!entry) {
      jobs.push({ ...item.job });
      continue;
    }
    entries.set(item.drawing.id, entry);
    if (entry.state === 'done') {
      claims.push({
        id: item.drawing.id,
        active: false,
        regionBytes: entry.regionBytes,
        fillBytes: entry.fillBytes,
        fillable: entry.fillable,
      });
    }
  }
  const heldBytes = activeSketchId && held?.id === activeSketchId ? held.bytes : undefined;
  const budget = regionBudget();
  const verdicts = regionVerdicts(claims, budget, heldBytes);
  // What the budget has left, for the worker: arrays that wouldn't fit aren't even made.
  const grantedTo = new Map(claims.map((c) => [c.id, grantedBytes(c, verdicts.get(c.id))]));
  const left = Math.max(0, budget - [...grantedTo.values()].reduce((n, b) => n + b, 0));
  const openClaim = claims.find((c) => c.active);
  const nextHeld =
    openClaim === undefined
      ? undefined
      : heldBytes !== undefined
        ? held
        : { id: openClaim.id, bytes: grantedBytes(openClaim, verdicts.get(openClaim.id)) };
  const granted = new Map<SketchData, RegionVerdict>();
  let unshaded = 0;
  let unpickable = 0;
  const drawings = items.map((item) => {
    const { drawing } = item;
    const verdict = verdicts.get(drawing.id);
    if (item.kind === 'open') {
      // The open sketch's regions stay in the profile cache, looked up by its data where
      // they are drawn: a drawing an old render keeps must not keep them too.
      if (verdict === 'shaded') return drawing;
      unshaded++;
      return dressed(memo, drawing, undefined, undefined, true);
    }
    const entry = entries.get(drawing.id);
    if (!entry) return drawing;
    const shows = closedSketchShows(entry, verdict);
    // Every shown sketch's entry stays, refused, stopped or failed too: only others are spare.
    granted.set(drawing.data, shows.keep);
    if (shows.unshaded) unshaded++;
    if (shows.unpickable) unpickable++;
    // What the budget grants but was let go of before is asked for again.
    if (shows.ask) {
      jobs.push({
        key: drawing.id,
        data: drawing.data,
        version: fontsVersion,
        text: hasText(drawing.data),
      });
    }
    return dressed(memo, drawing, shows.regions, shows.fill, !!shows.unshaded);
  });
  for (const job of jobs) job.allowance = left + (grantedTo.get(job.key) ?? 0);
  return { drawings, unshaded, unpickable, jobs, granted, held: nextHeld };
}

/**
 * Asks the worker for the shown sketches' regions and gives the drawings with
 * their results to its subtree. Only this and the context's readers render
 * when results arrive: `children` is the shell's, the same elements then.
 */
export function ShownSketchesProvider({
  base,
  client,
  children,
}: {
  base: ShownSketchBase;
  client: RegionsClient | undefined;
  children: ReactNode;
}) {
  // Its memos are by hand and keep what the next batch needs in refs (the open sketch's grant,
  // the drawings kept): the compiler would skip it for those refs anyway.
  'use no memo';
  // A fill that could not be built takes its sketch out of the budget.
  const unbuiltFill = useStore(unbuiltFills, (s) => s.version);
  const regionsVersion = useStore(client?.store ?? idleRegions, (s) => s.version);
  // What the open sketch was granted when it was opened (`regionVerdicts`' `held`).
  const held = useRef<{ id: string; bytes: number } | undefined>(undefined);
  const memo = useRef(new WeakMap<SketchDrawing, Dressed>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: `unbuiltFill` and `regionsVersion` say when to ask again.
  const shown = useMemo(() => {
    const next = withResults(base, client, held.current, memo.current);
    held.current = next.held;
    return next;
  }, [base, client, unbuiltFill, regionsVersion]);
  // Fonts reach the worker before the jobs that need them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new fonts' version means new fonts.
  useEffect(() => {
    for (const [id, bytes] of uiFontBytes()) client?.addFont(id, bytes);
  }, [base.fontsVersion, client]);
  // The effects take the small parts: a closure that keeps the drawings would keep their arrays.
  const jobs = shown.jobs;
  const granted = shown.granted;
  useEffect(() => client?.want(jobs), [jobs, client]);
  useEffect(() => client?.keep(granted), [granted, client]);
  // The same list while every drawing is the same object: a result for a sketch that isn't
  // shown, or one that changes nothing drawn, renders nothing.
  const last = useRef<readonly SketchDrawing[]>(NO_DRAWINGS);
  const drawings = sameItems(last.current, shown.drawings) ? last.current : shown.drawings;
  last.current = drawings;
  const { unshaded, unpickable } = shown;
  const shading = useMemo(() => ({ unshaded, unpickable }), [unshaded, unpickable]);
  return (
    <DrawingsContext.Provider value={drawings}>
      <ShadingContext.Provider value={shading}>{children}</ShadingContext.Provider>
    </DrawingsContext.Provider>
  );
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
