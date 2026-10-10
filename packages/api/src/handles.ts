/**
 * Handles: what a call that made something returns. A `FeatureHandle` names one
 * timeline feature and builds the references that point at its geometry
 * (ADR-0068 §4); a `ParameterHandle` names one parameter and its name is what
 * expressions use.
 *
 * Handles read the live document, so a name they report follows a later rename
 * and an undo removes what they pointed at.
 */
import type {
  BodyId,
  Component,
  ComponentId,
  ConstructionType,
  ExtrudoDocument,
  Feature,
  FeatureId,
  GeomFingerprint,
  GeomRef,
  GeomRefKind,
  Joint,
  JointId,
  Parameter,
  ParameterId,
} from '@extrudo/core';
import {
  constructionKindOf,
  evaluateParameters,
  isConstructionType,
  originPointRef,
} from '@extrudo/core';
import type { FaceRoleName } from './generated/features';
import { createdName, edgeName, indexedName, splitName, vertexName } from './names';

/** What a handle reads the document through (`Design`). */
export interface HandleContext {
  /** The document as it is now. */
  readonly doc: ExtrudoDocument;
  /** The feature, or `undefined` when it is gone (deleted, undone). */
  find(id: FeatureId): Feature | undefined;
}

/** What a `ComponentHandle` adds to the handle context: putting bodies into it. */
export interface ComponentHandleContext extends HandleContext {
  /** Puts bodies into the component (`setBodyComponent`, ADR-0081 §2). */
  setComponentBodies(component: ComponentId, bodies: readonly (GeomRef | string)[]): void;
}

/**
 * One feature of the timeline, by its ID. `T` is its type, so
 * `handle.face('cap:end')` on an `FeatureHandle<'extrude'>` is checked against
 * extrude's own face roles (the generated reference, ADR-0068 §4).
 */
export class FeatureHandle<T extends string = string> {
  readonly id: FeatureId;
  /** The feature's type, as the registry spells it. */
  readonly type: T;
  readonly #design: HandleContext;

  constructor(design: HandleContext, id: FeatureId, type: T) {
    this.#design = design;
    this.id = id;
    this.type = type;
  }

  /** The feature's name, as the timeline shows it ("Extrude1"). */
  get name(): string {
    return this.#design.find(this.id)?.name ?? this.id;
  }

  /** The feature itself, or `undefined` when it is gone. */
  get feature(): Feature | undefined {
    return this.#design.find(this.id);
  }

  /** The feature as a reference, for a pattern's `features` or a mirror's. */
  ref(): GeomRef {
    return { kind: 'feature', id: this.id };
  }

  /**
   * The plane, axis or point a construction feature makes, to put in a later
   * feature's inputs (ADR-0040). `undefined` for any other feature: only the
   * nine construction types make one.
   */
  constructionRef(): GeomRef | undefined {
    if (!isConstructionType(this.type)) return undefined;
    return { kind: constructionKindOf(this.type as ConstructionType), id: this.id };
  }

  /** This feature's own body (`<feature>`), the one a new solid feature makes. */
  body(): GeomRef {
    return { kind: 'body', id: this.id };
  }

  /**
   * The bodies this feature made, as the document knows them: its own and any
   * `<feature>:<n>` of a feature that made several (ADR-0030). Without a
   * recompute this is the bodies stored for it, which is every body the
   * document has ever had; the kernel's `splitSolids` names the rest.
   */
  bodies(): GeomRef[] {
    const prefix = `${this.id}:`;
    const ids = [
      this.id,
      ...Object.keys(this.#design.doc.bodies).filter((b) => b.startsWith(prefix)),
    ];
    return ids.map((id) => ({ kind: 'body', id }));
  }

  /**
   * The face's persistent name: `<type>:<id>:<role>` (ADR-0005). The second
   * argument says which of the faces with that role: a number is the piece
   * (`#n`, as the kernel numbers pieces in geometric order), a string is the
   * source it came from (`:<source>`, a sweep's `side:l3`).
   *
   * The role is the feature type's own (ADR-0068 §4), so `handle.face('cap:end')`
   * checks on an extrude and not on a box, and the generated reference says what
   * each one is.
   */
  faceName(role: FaceRoleName<T>, which?: string | number): string {
    const source = typeof which === 'string' ? which : undefined;
    const name = createdName(this.type, this.id, role, source);
    return typeof which === 'number' ? splitName(name, which) : name;
  }

  /** The face's persistent name, as a `face` reference (ADR-0005). */
  face(role: FaceRoleName<T>, which?: string | number): GeomRef {
    return { kind: 'face', id: this.faceName(role, which) };
  }

  /**
   * The edge between the faces named (`e[face|face]`, sorted, with `@n` when
   * several edges run between the same faces). Each face is a full name, from
   * `faceName` or another feature's.
   */
  edge(faces: string | readonly string[], index?: number): GeomRef {
    return { kind: 'edge', id: withIndex(edgeName(faceList(faces)), index) };
  }

  /** The vertex where the faces named meet (`v[face|face]`, sorted). */
  vertex(faces: string | readonly string[], index?: number): GeomRef {
    return { kind: 'vertex', id: withIndex(vertexName(faceList(faces)), index) };
  }
}

function faceList(faces: string | readonly string[]): readonly string[] {
  return typeof faces === 'string' ? [faces] : faces;
}

function withIndex(name: string, index?: number): string {
  return index === undefined ? name : indexedName(name, index);
}

/**
 * One component of the design (ADR-0081 §2), by its ID. Its `name` is what the
 * browser shows and a later rename follows; `add` puts bodies into it and
 * `bodies` reads the ones stored in it. A component holds no geometry, so a
 * handle changes nothing but metadata.
 */
export class ComponentHandle {
  readonly id: ComponentId;
  readonly #design: ComponentHandleContext;

  constructor(design: ComponentHandleContext, id: ComponentId) {
    this.#design = design;
    this.id = id;
  }

  /** The component's name, as the browser shows it ("Lid"). */
  get name(): string {
    return this.component?.name ?? this.id;
  }

  /** The stored component, or `undefined` when it is gone (deleted, undone). */
  get component(): Component | undefined {
    return (this.#design.doc.components ?? []).find((c) => c.id === this.id);
  }

  /**
   * Puts bodies into this component (`BodyMeta.component`), as "Move to
   * Component" does (ADR-0081 §2). Bodies are a reference (a `FeatureHandle`'s
   * `body()`) or an ID.
   */
  add(...bodies: (GeomRef | string)[]): this {
    this.#design.setComponentBodies(this.id, bodies);
    return this;
  }

  /** The IDs of the bodies stored in this component (`BodyMeta.component`). */
  bodies(): BodyId[] {
    return Object.entries(this.#design.doc.bodies)
      .filter(([, meta]) => meta.component === this.id)
      .map(([id]) => id as BodyId);
  }

  /** The name, so a message reads as the component's name. */
  toString(): string {
    return this.name;
  }
}

/**
 * One as-built joint of the design (ADR-0081 §4), by its ID. A joint change
 * goes through `Design.joint`/its own commands; the handle names it and reads
 * its live name.
 */
export class JointHandle {
  readonly id: JointId;
  readonly #design: HandleContext;

  constructor(design: HandleContext, id: JointId) {
    this.#design = design;
    this.id = id;
  }

  /** The joint's name, as the browser shows it ("Hinge"). */
  get name(): string {
    return this.joint?.name ?? this.id;
  }

  /** The stored joint, or `undefined` when it is gone. */
  get joint(): Joint | undefined {
    return (this.#design.doc.joints ?? []).find((j) => j.id === this.id);
  }

  /** The name, so a message reads as the joint's name. */
  toString(): string {
    return this.name;
  }
}

/** One parameter, by its name or ID. */
export class ParameterHandle {
  readonly id: ParameterId;
  readonly #design: HandleContext;

  constructor(design: HandleContext, id: ParameterId) {
    this.#design = design;
    this.id = id;
  }

  /** The parameter's name, which is what expressions use. */
  get name(): string {
    return this.parameter?.name ?? this.id;
  }

  /** The parameter's expression as stored, e.g. `'wall * 2'`. */
  get expression(): string {
    return this.parameter?.expression ?? '';
  }

  /** What it measures: `length`, `angle` or `unitless`. */
  get unit(): Parameter['unit'] {
    return this.parameter?.unit ?? 'length';
  }

  /** The stored parameter, or `undefined` when it is gone. */
  get parameter(): Parameter | undefined {
    return this.#design.doc.parameters.find((p) => p.id === this.id);
  }

  /** Its value in mm, degrees or plain, or `undefined` without one. */
  value(): number | undefined {
    if (!this.parameter) return undefined;
    const result = evaluateParameters(this.#design.doc).evaluate(this.expression, this.unit);
    return result.ok ? result.value : undefined;
  }

  /**
   * The name, so `${width}` reads as the parameter's name in an expression or
   * a message (ADR-0068 §2).
   */
  toString(): string {
    return this.name;
  }
}

/**
 * The origin planes, axes and point as references (ADR-0068 §4): what a
 * feature takes when nothing else was picked.
 */
export interface OriginRefs {
  /** The XY plane. */
  xy: GeomRef;
  xz: GeomRef;
  yz: GeomRef;
  /** The world X, Y and Z axes. */
  x: GeomRef;
  y: GeomRef;
  z: GeomRef;
  /** The world origin, for the inputs that take a point. */
  point: GeomRef;
}

/** The origin reference of each plane, axis and the point. */
export function originRefs(): OriginRefs {
  const plane = (id: 'origin:xy' | 'origin:xz' | 'origin:yz'): GeomRef => ({ kind: 'plane', id });
  const axis = (id: 'origin:x' | 'origin:y' | 'origin:z'): GeomRef => ({ kind: 'axis', id });
  return {
    xy: plane('origin:xy'),
    xz: plane('origin:xz'),
    yz: plane('origin:yz'),
    x: axis('origin:x'),
    y: axis('origin:y'),
    z: axis('origin:z'),
    point: originPointRef(),
  };
}

/** A reference of any kind, for what the helpers don't build (ADR-0068 §4). */
export function ref(kind: GeomRefKind, id: string, fingerprint?: GeomFingerprint): GeomRef {
  return { kind, id, ...(fingerprint ? { fingerprint } : {}) };
}
