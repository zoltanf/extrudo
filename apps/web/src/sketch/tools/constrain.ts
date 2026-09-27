/**
 * The constraint tools (P1-06, FR-SK-07): one tool per constraint type in
 * the Constraints group. A tool picks the entities its constraint needs, one
 * click each, hovering shows what a click would pick, and the last pick adds
 * the constraint. The host test-solves it first (`SketchEdit.verify`) and
 * refuses one that conflicts or is redundant. The tool stays on for the
 * next constraint; Esc drops the last pick, then leaves.
 *
 * Coincident makes `coincident` (two points) or `pointOnCurve` (a point and
 * a curve, either order). Fix on something already fixed frees it.
 */
import type {
  ConstraintId,
  SketchConstraint,
  SketchEntity,
  SketchEntityId,
  SketchEntityType,
  Vec2,
} from '@extrudo/core';
import { type Inference, tangentReversed } from '@extrudo/sketch/inference';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
} from './tool';

/** The constraint tools' IDs, as in the toolbar catalogue (`shell/tools.ts`). */
export const CONSTRAINT_TOOLS = [
  'coincident',
  'collinear',
  'concentric',
  'midpoint',
  'fix',
  'parallel',
  'perpendicular',
  'horizontal',
  'vertical',
  'tangent',
  'smooth',
  'equal',
  'symmetric',
] as const;
export type ConstraintToolId = (typeof CONSTRAINT_TOOLS)[number];

interface Pick {
  id: SketchEntityId;
  entity: SketchEntity;
}

/** What a tool accepts and makes. */
interface Rule {
  /** The status prompt for the next pick. */
  prompt(picked: readonly Pick[]): string;
  /** Whether `next` can be the next pick (never one already picked). */
  accepts(picked: readonly Pick[], next: SketchEntity): boolean;
  /** The constraint once the picks are complete; undefined while more are needed. */
  make(picked: readonly Pick[], context: ToolContext): SketchConstraint | undefined;
}

const is =
  (...types: SketchEntityType[]) =>
  (e: SketchEntity | undefined) =>
    e !== undefined && types.includes(e.type);
const point = is('point');
const line = is('line');
const round = is('circle', 'arc');
/** What a point can lie on (`pointOnCurve`). */
const onCurve = is('line', 'circle', 'arc', 'ellipse');
/** What tangent and smooth join. */
const smoothCurve = is('line', 'circle', 'arc');
const mirrorable = is('point', 'line', 'circle', 'arc');

/** Two picks of one kind (two lines, two circles or arcs). */
function pair(
  type: 'collinear' | 'concentric' | 'parallel' | 'perpendicular',
  kind: (e: SketchEntity | undefined) => boolean,
  first: string,
  second: string,
): Rule {
  return {
    prompt: (p) => (p.length === 0 ? first : second),
    accepts: (_, next) => kind(next),
    make: ([a, b]) => (a && b ? { type, a: a.id, b: b.id } : undefined),
  };
}

/** Horizontal or vertical: a line, or two points. */
function axis(type: 'horizontal' | 'vertical'): Rule {
  return {
    prompt: (p) =>
      p.length === 0
        ? `Pick a line to make ${type}, or two points to line up.`
        : 'Pick the second point.',
    accepts: (p, next) => (p.length === 0 ? line(next) || point(next) : point(next)),
    make: ([a, b]) => {
      if (a && line(a.entity)) return { type, a: a.id };
      return a && b ? { type, a: a.id, b: b.id } : undefined;
    },
  };
}

/** Tangent or smooth: two lines, circles or arcs, not two lines. */
function joint(type: 'tangent' | 'smooth'): Rule {
  const word = type === 'tangent' ? 'tangent' : 'smooth (G2)';
  return {
    prompt: (p) =>
      p.length === 0 ? 'Pick a line, circle or arc.' : `Pick a curve to make ${word} with it.`,
    accepts: (p, next) => smoothCurve(next) && !(p[0] && line(p[0].entity) && line(next)),
    make: ([a, b], context) => {
      if (!a || !b) return undefined;
      const reversed = tangentReversed(context.sketch(), a.id, b.id);
      return reversed === undefined
        ? { type, a: a.id, b: b.id }
        : { type, a: a.id, b: b.id, reversed };
    },
  };
}

const RULES: Record<ConstraintToolId, Rule> = {
  coincident: {
    prompt: (p) =>
      p.length === 0
        ? 'Pick a point, or a curve to put a point on.'
        : point(p[0]?.entity)
          ? 'Pick a point or a curve to join it to.'
          : 'Pick a point to put on the curve.',
    accepts: (p, next) => {
      const first = p[0]?.entity;
      if (!first) return point(next) || onCurve(next);
      return point(first) ? point(next) || onCurve(next) : point(next);
    },
    make: ([a, b]) => {
      if (!a || !b) return undefined;
      if (point(a.entity) && point(b.entity)) return { type: 'coincident', a: a.id, b: b.id };
      const [p, curve] = point(a.entity) ? [a, b] : [b, a];
      return { type: 'pointOnCurve', point: p.id, curve: curve.id };
    },
  },
  collinear: pair('collinear', line, 'Pick a line.', 'Pick a line to make collinear with it.'),
  concentric: pair(
    'concentric',
    round,
    'Pick a circle or an arc.',
    'Pick a circle or an arc to share its center.',
  ),
  midpoint: {
    prompt: (p) =>
      p.length === 0
        ? 'Pick a point, or the line or arc to put one at the middle of.'
        : point(p[0]?.entity)
          ? 'Pick the line or arc to put it at the middle of.'
          : 'Pick the point to put at its middle.',
    accepts: (p, next) => {
      const first = p[0]?.entity;
      if (!first) return point(next) || is('line', 'arc')(next);
      return point(first) ? is('line', 'arc')(next) : point(next);
    },
    make: ([a, b]) => {
      if (!a || !b) return undefined;
      const [p, of] = point(a.entity) ? [a, b] : [b, a];
      return { type: 'midpoint', point: p.id, of: of.id };
    },
  },
  fix: {
    prompt: () => 'Pick something to fix in place, or something fixed to free it.',
    accepts: () => true,
    make: ([a]) => (a ? { type: 'fix', entity: a.id } : undefined),
  },
  parallel: pair('parallel', line, 'Pick a line.', 'Pick a line to make parallel to it.'),
  perpendicular: pair(
    'perpendicular',
    line,
    'Pick a line.',
    'Pick a line to make perpendicular to it.',
  ),
  horizontal: axis('horizontal'),
  vertical: axis('vertical'),
  tangent: joint('tangent'),
  smooth: joint('smooth'),
  equal: {
    prompt: (p) =>
      p.length === 0
        ? 'Pick a line, circle or arc.'
        : line(p[0]?.entity)
          ? 'Pick a line to make the same length.'
          : 'Pick a circle or an arc to give the same radius.',
    accepts: (p, next) => {
      const first = p[0]?.entity;
      if (!first) return line(next) || round(next);
      return line(first) ? line(next) : round(next);
    },
    make: ([a, b]) => (a && b ? { type: 'equal', a: a.id, b: b.id } : undefined),
  },
  symmetric: {
    prompt: (p) =>
      p.length === 0
        ? 'Pick a point, line, circle or arc.'
        : p.length === 1
          ? 'Pick its mirror image.'
          : 'Pick the line to mirror about.',
    accepts: (p, next) => {
      const first = p[0]?.entity;
      if (!first) return mirrorable(next);
      if (p.length === 1)
        return point(first) ? point(next) : line(first) ? line(next) : round(next);
      return line(next);
    },
    make: ([a, b, axisLine]) =>
      a && b && axisLine ? { type: 'symmetric', a: a.id, b: b.id, axis: axisLine.id } : undefined,
  },
};

export class ConstraintTool implements SketchTool {
  readonly picks = true;
  readonly #rule: Rule;
  #picked: Pick[] = [];
  #hover: SketchEntityId | undefined;

  constructor(
    private readonly context: ToolContext,
    readonly id: ConstraintToolId,
  ) {
    this.#rule = RULES[id];
  }

  prompt(): string {
    return this.#rule.prompt(this.#picked);
  }

  anchor(): Vec2 | undefined {
    return undefined;
  }

  move(pointer: Inference): void {
    this.#hover = this.#pickAt(pointer.cursor);
  }

  click(pointer: Inference): SketchEdit | undefined {
    const id = this.#pickAt(pointer.cursor);
    const entity = id && this.context.sketch().entities[id];
    if (!id || !entity) return undefined;
    this.#picked.push({ id, entity });
    const constraint = this.#rule.make(this.#picked, this.context);
    if (!constraint) {
      this.#hover = undefined;
      return undefined;
    }
    this.#picked = [];
    this.#hover = undefined;
    return this.#edit(constraint);
  }

  enter(): undefined {
    return undefined;
  }

  fields(): HeadsUpField[] {
    return [];
  }

  lock(): void {}

  escape(): boolean {
    if (this.#picked.length === 0) return true;
    this.#picked.pop();
    return false;
  }

  preview(): ToolPreview {
    if (this.#picked.length === 0 && !this.#hover) return EMPTY_PREVIEW;
    return { ...EMPTY_PREVIEW, picked: this.#picked.map((p) => p.id), hover: this.#hover };
  }

  #pickAt(cursor: Vec2): SketchEntityId | undefined {
    const taken = new Set(this.#picked.map((p) => p.id));
    return this.context.pick(
      cursor,
      (entity, id) => !taken.has(id) && this.#rule.accepts(this.#picked, entity),
    );
  }

  #edit(constraint: SketchConstraint): SketchEdit {
    const edit = emptyEdit();
    if (constraint.type === 'fix') {
      const existing = Object.entries(this.context.sketch().constraints).find(
        ([, c]) => c.type === 'fix' && c.entity === constraint.entity,
      );
      if (existing) {
        edit.remove = { constraints: [existing[0] as ConstraintId] };
        edit.label = 'Unfix';
        return edit;
      }
    }
    const id = this.context.newId() as ConstraintId;
    edit.constraints[id] = constraint;
    edit.verify = [id];
    return edit;
  }
}
