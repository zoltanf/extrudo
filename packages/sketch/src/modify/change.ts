/**
 * Building a sketch change for the modify tools (P1-10, ADR-0019): new
 * entities, replaced entities, removals and new constraints and dimensions,
 * collected against the sketch as it is, with a view of the result.
 */
import type {
  ConstraintId,
  DimensionId,
  SketchChange,
  SketchConstraint,
  SketchData,
  SketchDimension,
  SketchEntity,
  SketchEntityId,
  Vec2,
} from '@extrudo/core';

/**
 * What a modify operation returns: a `SketchChange`, plus new driving
 * dimensions whose expression is another new dimension's parameter (an
 * offset's other distances follow its first). The tool host names the
 * parameters and writes the links in.
 */
export interface ModifyResult extends SketchChange {
  links?: Record<DimensionId, DimensionId>;
  /**
   * New constraints and dimensions to keep only if they neither conflict
   * nor are redundant (the host test-solves them in order, like inferred
   * constraints): an offset's later distances, which tangent joints may
   * already imply; a mirrored point held on the mirror line.
   */
  auto?: string[];
}

/** An operation that can't be done, with the message for the prompt. */
export class ModifyError extends Error {
  override readonly name = 'ModifyError';
}

export class ChangeBuilder {
  readonly entities: Record<SketchEntityId, SketchEntity> = {};
  readonly constraints: Record<ConstraintId, SketchConstraint> = {};
  readonly dimensions: Record<DimensionId, SketchDimension> = {};
  readonly update: Record<SketchEntityId, SketchEntity> = {};
  readonly replacedConstraints: Record<ConstraintId, SketchConstraint> = {};
  readonly replacedDimensions: Record<DimensionId, SketchDimension> = {};
  readonly links: Record<DimensionId, DimensionId> = {};
  readonly auto: string[] = [];
  readonly removedEntities = new Set<SketchEntityId>();
  readonly removedConstraints = new Set<ConstraintId>();
  readonly removedDimensions = new Set<DimensionId>();

  constructor(
    readonly data: SketchData,
    readonly newId: () => string,
  ) {}

  /** An entity as it will be: new, replaced or as it is; undefined once removed. */
  entity(id: SketchEntityId): SketchEntity | undefined {
    if (this.removedEntities.has(id)) return undefined;
    return this.entities[id] ?? this.update[id] ?? this.data.entities[id];
  }

  point(id: SketchEntityId): Vec2 {
    const p = this.entity(id);
    if (p?.type !== 'point') throw new Error(`${id} is not a point`);
    return [p.x, p.y];
  }

  add(entity: SketchEntity): SketchEntityId {
    const id = this.newId() as SketchEntityId;
    this.entities[id] = entity;
    return id;
  }

  addPoint(p: Vec2): SketchEntityId {
    return this.add({ type: 'point', x: p[0], y: p[1] });
  }

  /** Replaces an entity: an existing one through `update`, a new one in place. */
  set(id: SketchEntityId, entity: SketchEntity): void {
    if (id in this.entities) this.entities[id] = entity;
    else this.update[id] = entity;
  }

  /** Moves a point (existing or new). */
  move(id: SketchEntityId, p: Vec2): void {
    this.set(id, { type: 'point', x: p[0], y: p[1] });
  }

  constrain(c: SketchConstraint): ConstraintId {
    const id = this.newId() as ConstraintId;
    this.constraints[id] = c;
    return id;
  }

  dimension(d: SketchDimension): DimensionId {
    const id = this.newId() as DimensionId;
    this.dimensions[id] = d;
    return id;
  }

  removeEntity(id: SketchEntityId): void {
    if (id in this.entities) delete this.entities[id];
    else {
      delete this.update[id];
      this.removedEntities.add(id);
    }
  }

  removeConstraint(id: ConstraintId): void {
    if (id in this.constraints) delete this.constraints[id];
    else {
      delete this.replacedConstraints[id];
      this.removedConstraints.add(id);
    }
  }

  removeDimension(id: DimensionId): void {
    if (id in this.dimensions) delete this.dimensions[id];
    else {
      delete this.replacedDimensions[id];
      this.removedDimensions.add(id);
    }
  }

  /** Changes a constraint in place, keeping its ID. */
  replaceConstraint(id: ConstraintId, c: SketchConstraint): void {
    if (id in this.constraints) this.constraints[id] = c;
    else this.replacedConstraints[id] = c;
  }

  /** Changes a dimension in place, keeping its ID and parameter. */
  replaceDimension(id: DimensionId, d: SketchDimension): void {
    if (id in this.dimensions) this.dimensions[id] = d;
    else this.replacedDimensions[id] = d;
  }

  /** A constraint as it will be; undefined once removed. */
  constraint(id: ConstraintId): SketchConstraint | undefined {
    if (this.removedConstraints.has(id)) return undefined;
    return this.constraints[id] ?? this.replacedConstraints[id] ?? this.data.constraints[id];
  }

  /** The sketch with the change applied (what a solve or a preview sees). */
  view(): SketchData {
    const entities = { ...this.data.entities, ...this.update, ...this.entities };
    for (const id of this.removedEntities) delete entities[id];
    const constraints = {
      ...this.data.constraints,
      ...this.replacedConstraints,
      ...this.constraints,
    };
    for (const id of this.removedConstraints) delete constraints[id];
    const dimensions = { ...this.data.dimensions, ...this.replacedDimensions, ...this.dimensions };
    for (const id of this.removedDimensions) delete dimensions[id];
    return { entities, constraints, dimensions };
  }

  result(): ModifyResult {
    return {
      entities: { ...this.entities },
      constraints: { ...this.constraints },
      dimensions: { ...this.dimensions },
      update: { ...this.update },
      replace: {
        constraints: { ...this.replacedConstraints },
        dimensions: { ...this.replacedDimensions },
      },
      remove: {
        entities: [...this.removedEntities],
        constraints: [...this.removedConstraints],
        dimensions: [...this.removedDimensions],
      },
      ...(Object.keys(this.links).length > 0 ? { links: { ...this.links } } : {}),
      ...(this.auto.length > 0 ? { auto: [...this.auto] } : {}),
    };
  }
}

/** The position of a point entity in `data`. */
export function pointOf(data: SketchData, id: SketchEntityId): Vec2 | undefined {
  const p = data.entities[id];
  return p?.type === 'point' ? [p.x, p.y] : undefined;
}
