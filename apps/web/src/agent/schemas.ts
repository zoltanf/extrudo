/**
 * The agent tools' inputs (P6-08, ADR-0087 §5): one zod schema per tool, the
 * same object both checking a call and giving the MCP `inputSchema`
 * (`z.toJSONSchema`). Descriptions are what an agent reads, so they say what
 * the tool does and what it answers, in the app's own words.
 */
import { z } from '@extrudo/core';
import type { AgentToolDefinition } from '../platform/agent';

const id = (what: string) => z.string().min(1).describe(what);
const vec2 = z
  .tuple([z.number(), z.number()])
  .describe('A point in the sketch plane, [x, y] in mm.');
const expr = (what: string) =>
  z
    .union([z.string(), z.number()])
    .describe(`${what}: an expression ('20 mm', 'width / 2') or a number of mm.`);
const geomRef = z
  .object({ kind: z.string(), id: z.string() })
  .describe("A reference: { kind, id }, e.g. { kind: 'face', id: 'extrude:<feature>:cap:end' }.");

const shape = z.discriminatedUnion('shape', [
  z
    .object({
      shape: z.literal('rectangle'),
      from: vec2,
      to: vec2,
      width: expr('A width dimension on the bottom edge').optional(),
      height: expr('A height dimension on the side edge').optional(),
    })
    .describe('A rectangle from two opposite corners, optionally dimensioned.'),
  z
    .object({
      shape: z.literal('centeredRectangle'),
      center: vec2,
      corner: vec2,
      width: expr('A width dimension').optional(),
      height: expr('A height dimension').optional(),
    })
    .describe('A rectangle from its centre and one corner, optionally dimensioned.'),
  z
    .object({
      shape: z.literal('circle'),
      center: vec2,
      diameter: expr('Its diameter, kept as a dimension'),
    })
    .describe('A circle with a diameter dimension.'),
  z.object({ shape: z.literal('line'), from: vec2, to: vec2 }).describe('A line.'),
  z
    .object({
      shape: z.literal('polyline'),
      points: z.array(vec2).min(2),
      closed: z.boolean().optional(),
    })
    .describe('Lines joined end to end; closed joins the last point to the first.'),
  z
    .object({ shape: z.literal('arc'), start: vec2, end: vec2, through: vec2 })
    .describe('An arc from start to end through a third point.'),
  z
    .object({ shape: z.literal('slot'), from: vec2, to: vec2, width: z.number().positive() })
    .describe('A slot between two centres, width in mm.'),
]);

export type SketchShape = z.infer<typeof shape>;

const empty = z.object({});

/** Every tool: name, description, input schema, and whether it changes the design. */
export const TOOL_SCHEMAS = {
  list_designs: {
    description: 'Lists the designs (id, name, last change); "open" marks the one open now.',
    input: empty,
  },
  new_design: {
    description: 'Makes a new empty design, opens it and answers it as get_design does.',
    input: z.object({ name: z.string().min(1).optional().describe("The design's name.") }),
  },
  open_design: {
    description: 'Opens a design by id (from list_designs) and waits until it is ready.',
    input: z.object({ id: id('The design id.') }),
  },
  get_design: {
    description:
      "The open design: id, name, parameters, configurations, and the timeline as [{ id, type, name, status, message?, suppressed }]. Read it first, and after every change: status 'error' or 'warning' says what went wrong.",
    input: empty,
  },
  get_document: {
    description: "The open design's whole document JSON (the file format's document).",
    input: empty,
  },
  get_feature: {
    description:
      "One feature: its type, name, status and inputs as the API's plain values (what add_feature and edit_feature take); a sketch lists its plane, profiles and curves (an extrude's side face of curve <c> is side:<c>).",
    input: z.object({ id: id('The feature id.') }),
  },
  get_bodies: {
    description:
      'The bodies at the timeline marker: [{ id, name, volume (mm³), box ({ min, max } in mm), visible }].',
    input: empty,
  },
  get_selection: {
    description: 'What the person has selected in the app: [{ kind, id }].',
    input: empty,
  },
  screenshot: {
    description: 'A picture of the model as a PNG, framed on the bodies. At most one per second.',
    input: empty,
  },
  list_commands: {
    description: "The app's commands run_command takes: [{ id, label, group, unavailable? }].",
    input: empty,
  },
  set_parameter: {
    description:
      'Sets a parameter to an expression, or creates it when no parameter has that name. Sketches re-solve. One undo step.',
    input: z.object({
      name: z.string().min(1).describe("The parameter's name, e.g. width."),
      expression: z
        .string()
        .min(1)
        .describe("Its expression with a unit, e.g. '40 mm' or 'width * 2'."),
    }),
  },
  apply_configuration: {
    description:
      "Applies a configuration (by id or name): its parameters take the configuration's values.",
    input: z.object({ configuration: z.string().min(1).describe('The configuration id or name.') }),
  },
  add_sketch: {
    description:
      "Adds a sketch on a plane with the shapes given and answers its id and profiles (the references an extrude's profiles take). Plane: 'xy', 'xz', 'yz' or a face reference. One undo step.",
    input: z.object({
      plane: z
        .union([z.enum(['xy', 'xz', 'yz']), geomRef])
        .describe("'xy', 'xz' or 'yz' (the origin planes), or a planar face reference."),
      shapes: z
        .array(shape)
        .min(1)
        .describe('What to draw: objects whose `shape` names the kind (rectangle, circle, …).'),
      name: z.string().optional().describe('A name for the sketch.'),
    }),
  },
  add_feature: {
    description:
      "Adds a feature at the timeline marker through the document API: type is the API method's feature type ('extrude', 'box', 'fillet', …) and inputs its plain values (see the skill's references/api.md); { edgeBetween: [faceName, faceName] } names the edge between two faces. A bad input answers the input's path and changes nothing. One undo step.",
    input: z.object({
      type: z.string().min(1).describe("The feature type, e.g. 'extrude'."),
      inputs: z.record(z.string(), z.unknown()).default({}).describe("The method's inputs."),
      name: z.string().optional().describe('A name for the feature.'),
    }),
  },
  edit_feature: {
    description:
      "Changes some inputs of a feature (the API's plain values, as add_feature). Inputs not named keep their values. One undo step.",
    input: z.object({
      id: id('The feature id.'),
      inputs: z.record(z.string(), z.unknown()).describe('The inputs to change.'),
    }),
  },
  suppress: {
    description: 'Suppresses a feature (on: true) or brings it back (on: false). One undo step.',
    input: z.object({ id: id('The feature id.'), on: z.boolean().default(true) }),
  },
  rename: {
    description: 'Renames a feature. One undo step.',
    input: z.object({ id: id('The feature id.'), name: z.string().min(1) }),
  },
  remove: {
    description: 'Deletes a feature; refused while another feature uses it. One undo step.',
    input: z.object({ id: id('The feature id.') }),
  },
  run_command: {
    description:
      "Runs one of the app's commands by id (list_commands lists them). One that opens a dialog or a sketch answers `opened`: it is finished in the app, and change tools are refused until then.",
    input: z.object({ id: id('The command id.') }),
  },
  undo: { description: 'Undoes the last change (an agent change is one step).', input: empty },
  redo: { description: 'Redoes the change undo took back.', input: empty },
  save: { description: 'Saves the open design now (it also saves itself).', input: empty },
  export: {
    description:
      'Exports the visible bodies as STL, 3MF or STEP. Extrudo writes the file and answers its path. At most one every 2 s, 20 MB at most.',
    input: z.object({ format: z.enum(['stl', '3mf', 'step']) }),
  },
  get_skill: {
    description: "The Extrudo skill's SKILL.md: how to model in Extrudo with these tools.",
    input: empty,
  },
} as const satisfies Record<string, { description: string; input: z.ZodType }>;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export type ToolInput<T extends ToolName> = z.infer<(typeof TOOL_SCHEMAS)[T]['input']>;

export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];

/** The tools that change the open design: refused while none is open. */
export const CHANGE_TOOLS: ReadonlySet<ToolName> = new Set([
  'set_parameter',
  'apply_configuration',
  'add_sketch',
  'add_feature',
  'edit_feature',
  'suppress',
  'rename',
  'remove',
  'run_command',
  'undo',
  'redo',
]);

/** The tools as MCP lists them. */
export function toolDefinitions(): AgentToolDefinition[] {
  return TOOL_NAMES.map((name) => {
    const { description, input } = TOOL_SCHEMAS[name];
    const schema = z.toJSONSchema(input, { io: 'input' }) as Record<string, unknown>;
    delete schema.$schema;
    return { name, description, inputSchema: { ...schema, type: 'object' } };
  });
}
