/**
 * Tools that act on picked geometry (P1-10, FR-SK-10): Mirror, Move, Copy,
 * Rectangular Pattern, Circular Pattern and Scale.
 *
 * Each starts with the objects: the selection if there is one (P1-09), or
 * else clicks that pick and unpick points and curves, then Enter. Then the
 * tool's own steps place the result with a preview, snapping like the
 * drawing tools; heads-up fields take typed values (counts, spacing, angle,
 * scale). Esc steps back. The geometry is `@extrudo/sketch/modify`; Move
 * drags with the solver so the moved geometry keeps its constraints.
 */
import type { SketchEntityId, Vec2 } from '@extrudo/core';
import { typedEnd } from '@extrudo/sketch/build';
import type { Inference } from '@extrudo/sketch/inference';
import {
  axisOf,
  circularAngles,
  circularPattern,
  copy,
  ModifyError,
  type ModifyResult,
  mirror,
  objectsOf,
  placedPolylines,
  rectangularOffsets,
  rectangularPattern,
  reflect,
  rotation,
  scale,
} from '@extrudo/sketch/modify';
import { toEdit } from './split';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
  type Typed,
} from './tool';

export const MIRROR_TOOL = 'sketchMirror';
export const MOVE_TOOL = 'sketchMove';
export const COPY_TOOL = 'sketchCopy';
export const RECTANGULAR_PATTERN_TOOL = 'sketchRectangularPattern';
export const CIRCULAR_PATTERN_TOOL = 'sketchCircularPattern';
export const SCALE_TOOL = 'sketchScale';

const DEG = Math.PI / 180;

/** The first step every one of these tools shares: which points and curves it acts on. */
class Objects {
  ids: SketchEntityId[];
  hover: SketchEntityId | undefined;

  constructor(private readonly context: ToolContext) {
    this.ids = objectsOf(context.sketch(), context.selection());
  }

  get empty(): boolean {
    return this.ids.length === 0;
  }

  move(cursor: Vec2): void {
    this.hover = this.context.pick(cursor);
  }

  /** Picks or unpicks what is under the cursor. */
  click(cursor: Vec2): void {
    const id = this.context.pick(cursor);
    if (!id) return;
    this.ids = this.ids.includes(id) ? this.ids.filter((x) => x !== id) : [...this.ids, id];
  }

  /** Drops the picks; false if there were none. */
  clear(): boolean {
    if (this.empty) return false;
    this.ids = [];
    return true;
  }

  /** The picks as objects (a picked curve's own points aren't separate). */
  resolved(): SketchEntityId[] {
    const sketch = this.context.sketch();
    return objectsOf(
      sketch,
      this.ids.filter((id) => id in sketch.entities),
    );
  }

  preview(): ToolPreview {
    return { ...EMPTY_PREVIEW, picked: this.ids, hover: this.hover };
  }

  /** The middle of the objects' bounding box. */
  center(): Vec2 {
    const points = placedPolylines(this.context.sketch(), this.resolved(), (p) => p).flat();
    if (points.length === 0) return [0, 0];
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
}

const OBJECTS_PROMPT = 'Pick points and curves, then press Enter.';

function attempt(run: () => SketchEdit): SketchEdit {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof ModifyError)) throw error;
    return { ...emptyEdit(), error: error.message };
  }
}

// Mirror ------------------------------------------------------------------------

export class MirrorTool implements SketchTool {
  readonly id = MIRROR_TOOL;
  readonly picks = true;
  readonly #objects: Objects;
  #axis = false;
  #hover: SketchEntityId | undefined;

  constructor(private readonly context: ToolContext) {
    this.#objects = new Objects(context);
    this.#axis = !this.#objects.empty;
  }

  prompt(): string {
    return this.#axis ? 'Pick the line to mirror about.' : OBJECTS_PROMPT;
  }

  anchor(): Vec2 | undefined {
    return undefined;
  }

  move(pointer: Inference): void {
    if (this.#axis) this.#hover = this.#pickAxis(pointer.cursor);
    else this.#objects.move(pointer.cursor);
  }

  click(pointer: Inference): SketchEdit | undefined {
    if (!this.#axis) {
      this.#objects.click(pointer.cursor);
      return undefined;
    }
    const axis = this.#pickAxis(pointer.cursor);
    if (!axis) return undefined;
    const objects = this.#objects.resolved();
    this.#axis = false;
    this.#hover = undefined;
    this.#objects.clear();
    return attempt(() =>
      toEdit(
        mirror(this.context.sketch(), objects, axis, () => this.context.newId()),
        'Mirror',
      ),
    );
  }

  enter(): undefined {
    if (!this.#axis && !this.#objects.empty) this.#axis = true;
    return undefined;
  }

  fields(): HeadsUpField[] {
    return [];
  }

  lock(): void {}

  escape(): boolean {
    if (this.#axis) {
      this.#axis = false;
      return false;
    }
    return !this.#objects.clear();
  }

  preview(): ToolPreview {
    if (!this.#axis) return this.#objects.preview();
    const picked = this.#objects.ids;
    const sketch = this.context.sketch();
    const ends = this.#hover && axisOf(sketch, this.#hover);
    if (!ends) return { ...EMPTY_PREVIEW, picked };
    const accent = placedPolylines(sketch, this.#objects.resolved(), (p) =>
      reflect(ends[0], ends[1], p),
    );
    return { ...EMPTY_PREVIEW, picked, hover: this.#hover, accent };
  }

  #pickAxis(cursor: Vec2): SketchEntityId | undefined {
    return this.context.pick(
      cursor,
      (e, id) => e.type === 'line' && !this.#objects.ids.includes(id),
    );
  }
}

// Move and Copy -------------------------------------------------------------------

type Step = 'objects' | 'base' | 'target';

/** Move (the solver drags the objects) and Copy (copies them, again and again). */
export class TranslateTool implements SketchTool {
  readonly id: string;
  readonly #objects: Objects;
  #step: Step;
  #base: Vec2 | undefined;
  #pointer: Inference | undefined;
  #length: Typed | undefined;
  #angle: Typed | undefined;

  constructor(
    private readonly context: ToolContext,
    private readonly mode: 'move' | 'copy',
  ) {
    this.id = mode === 'move' ? MOVE_TOOL : COPY_TOOL;
    this.#objects = new Objects(context);
    this.#step = this.#objects.empty ? 'objects' : 'base';
  }

  get picks(): boolean {
    return this.#step === 'objects';
  }

  prompt(): string {
    if (this.#step === 'objects') return OBJECTS_PROMPT;
    if (this.#step === 'base') return 'Click the point to move from.';
    return this.mode === 'move'
      ? 'Click where it goes. Type a distance, Tab to the angle.'
      : 'Click where each copy goes. Esc when done.';
  }

  anchor(): Vec2 | undefined {
    return this.#step === 'target' ? this.#base : undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
    if (this.#step === 'objects') this.#objects.move(pointer.cursor);
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    if (this.#step === 'objects') {
      this.#objects.click(pointer.cursor);
      return undefined;
    }
    if (this.#step === 'base') {
      this.#base = pointer.point;
      this.#step = 'target';
      return undefined;
    }
    return this.#place();
  }

  enter(): SketchEdit | undefined {
    if (this.#step === 'objects') {
      if (!this.#objects.empty) this.#step = 'base';
      return undefined;
    }
    return this.#step === 'target' ? this.#place() : undefined;
  }

  fields(): HeadsUpField[] {
    if (this.#step !== 'target') return [];
    const by = this.#by();
    return [
      {
        name: 'length',
        label: 'Distance',
        kind: 'length',
        value: by ? Math.hypot(by[0], by[1]) : 0,
        ...(this.#length ? { locked: this.#length } : {}),
      },
      {
        name: 'angle',
        label: 'Angle',
        kind: 'angle',
        value: by ? Math.atan2(by[1], by[0]) / DEG : 0,
        ...(this.#angle ? { locked: this.#angle } : {}),
      },
    ];
  }

  lock(name: string, typed: Typed | undefined): void {
    if (name === 'length') this.#length = typed;
    else if (name === 'angle') this.#angle = typed;
  }

  escape(): boolean {
    if (this.#step === 'target') {
      this.#step = 'base';
      this.#length = undefined;
      this.#angle = undefined;
      return false;
    }
    if (this.#step === 'base') {
      this.#step = 'objects';
      return false;
    }
    return !this.#objects.clear();
  }

  preview(): ToolPreview {
    if (this.#step === 'objects') return this.#objects.preview();
    const picked = this.#objects.ids;
    const by = this.#by();
    if (!by || !this.#base) return { ...EMPTY_PREVIEW, picked };
    const accent = placedPolylines(this.context.sketch(), this.#objects.resolved(), (p) => [
      p[0] + by[0],
      p[1] + by[1],
    ]);
    const end: Vec2 = [this.#base[0] + by[0], this.#base[1] + by[1]];
    return { ...EMPTY_PREVIEW, picked, accent, guides: [[this.#base, end]], points: [end] };
  }

  #by(): Vec2 | undefined {
    const base = this.#base;
    const pointer = this.#pointer;
    if (!base || !pointer) return undefined;
    const end = typedEnd(base, pointer, this.#length, this.#angle).point;
    return [end[0] - base[0], end[1] - base[1]];
  }

  #place(): SketchEdit | undefined {
    const by = this.#by();
    if (!by || (by[0] === 0 && by[1] === 0)) return undefined;
    const objects = this.#objects.resolved();
    this.#length = undefined;
    this.#angle = undefined;
    if (this.mode === 'move') {
      this.#step = 'base';
      return { ...emptyEdit(), move: { entities: objects, by }, label: 'Move' };
    }
    return attempt(() =>
      toEdit(
        copy(this.context.sketch(), objects, by, () => this.context.newId()),
        'Copy',
      ),
    );
  }
}

// Patterns ------------------------------------------------------------------------

/** A typed count, as a whole number of at least `min`. */
const count = (typed: Typed | undefined, fallback: number, min = 1) =>
  typed ? Math.max(min, Math.round(typed.value)) : fallback;

export class RectangularPatternTool implements SketchTool {
  readonly id = RECTANGULAR_PATTERN_TOOL;
  readonly #objects: Objects;
  #placing: boolean;
  #pointer: Inference | undefined;
  readonly #locked = new Map<string, Typed>();

  constructor(private readonly context: ToolContext) {
    this.#objects = new Objects(context);
    this.#placing = !this.#objects.empty;
  }

  get picks(): boolean {
    return !this.#placing;
  }

  prompt(): string {
    return this.#placing
      ? 'Click where the last copy goes. Type the columns, rows and spacing to set them.'
      : OBJECTS_PROMPT;
  }

  anchor(): Vec2 | undefined {
    return this.#placing ? this.#objects.center() : undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
    if (!this.#placing) this.#objects.move(pointer.cursor);
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    if (!this.#placing) {
      this.#objects.click(pointer.cursor);
      return undefined;
    }
    return this.#place();
  }

  enter(): SketchEdit | undefined {
    if (!this.#placing) {
      if (!this.#objects.empty) this.#placing = true;
      return undefined;
    }
    return this.#place();
  }

  fields(): HeadsUpField[] {
    if (!this.#placing) return [];
    const { columns, rows, spacing } = this.#layout();
    const field = (name: string, label: string, kind: HeadsUpField['kind'], value: number) => {
      const locked = this.#locked.get(name);
      return { name, label, kind, value, ...(locked ? { locked } : {}) };
    };
    return [
      field('columns', 'Columns', 'unitless', columns),
      field('rows', 'Rows', 'unitless', rows),
      field('spacingX', 'X spacing', 'length', spacing[0]),
      field('spacingY', 'Y spacing', 'length', spacing[1]),
    ];
  }

  lock(name: string, typed: Typed | undefined): void {
    if (typed) this.#locked.set(name, typed);
    else this.#locked.delete(name);
  }

  escape(): boolean {
    if (this.#placing) {
      this.#placing = false;
      this.#locked.clear();
      return false;
    }
    return !this.#objects.clear();
  }

  preview(): ToolPreview {
    if (!this.#placing) return this.#objects.preview();
    const { columns, rows, spacing } = this.#layout();
    const sketch = this.context.sketch();
    const objects = this.#objects.resolved();
    const accent = rectangularOffsets(columns, rows, spacing).flatMap((by) =>
      placedPolylines(sketch, objects, (p) => [p[0] + by[0], p[1] + by[1]]),
    );
    return { ...EMPTY_PREVIEW, picked: this.#objects.ids, accent };
  }

  /** Columns and rows (typed, or 3 × 1), and the spacing: typed, or what reaches the pointer. */
  #layout(): { columns: number; rows: number; spacing: Vec2 } {
    const columns = count(this.#locked.get('columns'), 3);
    const rows = count(this.#locked.get('rows'), 1);
    const from = this.#objects.center();
    const to = this.#pointer?.point ?? from;
    const along = (axis: 0 | 1, n: number, name: string) =>
      this.#locked.get(name)?.value ?? (n > 1 ? (to[axis] - from[axis]) / (n - 1) : 0);
    return {
      columns,
      rows,
      spacing: [along(0, columns, 'spacingX'), along(1, rows, 'spacingY')],
    };
  }

  #place(): SketchEdit {
    const { columns, rows, spacing } = this.#layout();
    const objects = this.#objects.resolved();
    this.#placing = false;
    this.#objects.clear();
    this.#locked.clear();
    return attempt(() =>
      toEdit(
        rectangularPattern(this.context.sketch(), objects, columns, rows, spacing, () =>
          this.context.newId(),
        ),
        'Rectangular pattern',
      ),
    );
  }
}

export class CircularPatternTool implements SketchTool {
  readonly id = CIRCULAR_PATTERN_TOOL;
  readonly #objects: Objects;
  #placing: boolean;
  #pointer: Inference | undefined;
  #count: Typed | undefined;
  #angle: Typed | undefined;

  constructor(private readonly context: ToolContext) {
    this.#objects = new Objects(context);
    this.#placing = !this.#objects.empty;
  }

  get picks(): boolean {
    return !this.#placing;
  }

  prompt(): string {
    return this.#placing
      ? 'Click the center to pattern around. Type the count, Tab to the angle.'
      : OBJECTS_PROMPT;
  }

  anchor(): Vec2 | undefined {
    return undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
    if (!this.#placing) this.#objects.move(pointer.cursor);
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    if (!this.#placing) {
      this.#objects.click(pointer.cursor);
      return undefined;
    }
    const objects = this.#objects.resolved();
    const { n, total } = this.#settings();
    this.#placing = false;
    this.#objects.clear();
    return attempt(() =>
      toEdit(
        circularPattern(this.context.sketch(), objects, pointer.point, n, total, () =>
          this.context.newId(),
        ),
        'Circular pattern',
      ),
    );
  }

  enter(): undefined {
    if (!this.#placing && !this.#objects.empty) this.#placing = true;
    return undefined;
  }

  fields(): HeadsUpField[] {
    if (!this.#placing) return [];
    const { n, total } = this.#settings();
    return [
      {
        name: 'count',
        label: 'Count',
        kind: 'unitless',
        value: n,
        ...(this.#count ? { locked: this.#count } : {}),
      },
      {
        name: 'angle',
        label: 'Angle',
        kind: 'angle',
        value: total / DEG,
        ...(this.#angle ? { locked: this.#angle } : {}),
      },
    ];
  }

  lock(name: string, typed: Typed | undefined): void {
    if (name === 'count') this.#count = typed;
    else if (name === 'angle') this.#angle = typed;
  }

  escape(): boolean {
    if (this.#placing) {
      this.#placing = false;
      return false;
    }
    return !this.#objects.clear();
  }

  preview(): ToolPreview {
    if (!this.#placing) return this.#objects.preview();
    const center = this.#pointer?.point;
    if (!center) return { ...EMPTY_PREVIEW, picked: this.#objects.ids };
    const { n, total } = this.#settings();
    const sketch = this.context.sketch();
    const objects = this.#objects.resolved();
    const accent = circularAngles(n, total).flatMap((angle) =>
      placedPolylines(sketch, objects, rotation(center, angle).map),
    );
    return { ...EMPTY_PREVIEW, picked: this.#objects.ids, accent, points: [center] };
  }

  /** The number of instances (typed, or 6) and the angle they spread over (typed, or a full turn). */
  #settings(): { n: number; total: number } {
    return { n: count(this.#count, 6, 2), total: (this.#angle?.value ?? 360) * DEG };
  }
}

// Scale ---------------------------------------------------------------------------

export class ScaleTool implements SketchTool {
  readonly id = SCALE_TOOL;
  readonly #objects: Objects;
  #step: 'objects' | 'base' | 'factor';
  #base: Vec2 | undefined;
  /** The pointer's distance from the base that means "as it is" (factor 1). */
  #unit = 1;
  #pointer: Inference | undefined;
  #factor: Typed | undefined;

  constructor(private readonly context: ToolContext) {
    this.#objects = new Objects(context);
    this.#step = this.#objects.empty ? 'objects' : 'base';
  }

  get picks(): boolean {
    return this.#step === 'objects';
  }

  prompt(): string {
    if (this.#step === 'objects') return OBJECTS_PROMPT;
    if (this.#step === 'base') return 'Click the point to scale about.';
    return 'Move to size it and click, or type the scale.';
  }

  anchor(): Vec2 | undefined {
    return this.#step === 'factor' ? this.#base : undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
    if (this.#step === 'objects') this.#objects.move(pointer.cursor);
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    if (this.#step === 'objects') {
      this.#objects.click(pointer.cursor);
      return undefined;
    }
    if (this.#step === 'base') {
      this.#base = pointer.point;
      const center = this.#objects.center();
      this.#unit = Math.hypot(center[0] - pointer.point[0], center[1] - pointer.point[1]) || 10;
      this.#step = 'factor';
      return undefined;
    }
    return this.#place();
  }

  enter(): SketchEdit | undefined {
    if (this.#step === 'objects') {
      if (!this.#objects.empty) this.#step = 'base';
      return undefined;
    }
    return this.#step === 'factor' ? this.#place() : undefined;
  }

  fields(): HeadsUpField[] {
    if (this.#step !== 'factor') return [];
    return [
      {
        name: 'factor',
        label: 'Scale',
        kind: 'unitless',
        value: this.#scale(),
        ...(this.#factor ? { locked: this.#factor } : {}),
      },
    ];
  }

  lock(_name: string, typed: Typed | undefined): void {
    this.#factor = typed;
  }

  escape(): boolean {
    if (this.#step === 'factor') {
      this.#step = 'base';
      this.#factor = undefined;
      return false;
    }
    if (this.#step === 'base') {
      this.#step = 'objects';
      return false;
    }
    return !this.#objects.clear();
  }

  preview(): ToolPreview {
    if (this.#step === 'objects') return this.#objects.preview();
    const picked = this.#objects.ids;
    const base = this.#base;
    if (this.#step !== 'factor' || !base) return { ...EMPTY_PREVIEW, picked };
    const f = this.#scale();
    const accent = placedPolylines(
      this.context.sketch(),
      this.#objects.resolved(),
      (p) => [base[0] + (p[0] - base[0]) * f, base[1] + (p[1] - base[1]) * f],
      (r) => r * f,
    );
    return { ...EMPTY_PREVIEW, picked, accent, points: [base] };
  }

  /** Typed, or the pointer's distance from the base against the objects' (two decimals). */
  #scale(): number {
    if (this.#factor) return this.#factor.value;
    const base = this.#base;
    const p = this.#pointer?.point;
    if (!base || !p) return 1;
    return Math.max(
      0.01,
      Math.round((Math.hypot(p[0] - base[0], p[1] - base[1]) / this.#unit) * 100) / 100,
    );
  }

  #place(): SketchEdit {
    const base = this.#base;
    const objects = this.#objects.resolved();
    const f = this.#scale();
    this.#step = 'objects';
    this.#objects.clear();
    this.#factor = undefined;
    if (!base) return emptyEdit();
    return attempt(() => {
      const { result, moved } = scale(this.context.sketch(), objects, base, f, () =>
        this.context.newId(),
      );
      return { ...toEdit(result as ModifyResult, 'Scale'), hold: moved };
    });
  }
}
