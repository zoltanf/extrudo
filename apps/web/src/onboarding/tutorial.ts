/**
 * The first-run tutorial (P3-12, FR-UX-05, ADR-0052): five steps that build a
 * plain box. The steps are pure data over the app's real state: a step is done
 * when the document says so (a sketch exists, it has four lines, a dimension, an
 * extrude, a fillet), never because a button was pressed. So the tour follows
 * whatever route the user takes, undo steps it back, and a design that already
 * has the box shows the finish card at once. No React and no DOM here.
 */
import {
  CHAMFER_TYPE,
  EXTRUDE_TYPE,
  type ExtrudoDocument,
  FILLET_TYPE,
  readSketch,
  SHELL_TYPE,
} from '@extrudo/core';
import { keysFor } from '../commands/keymap';
import { shortcutLabel } from '../commands/shortcuts';
import type { ToolId } from '../shell/tools';

/** What the steps look at. */
export interface TutorialFacts {
  doc: ExtrudoDocument;
  mode: 'model' | 'sketch';
  /** The session's running tool: `sketch` while Create Sketch waits for a plane. */
  activeTool: string | undefined;
}

export interface TutorialStep {
  id: 'sketch' | 'rectangle' | 'dimension' | 'extrude' | 'round';
  title: string;
  /** What to do now: `**bold**` marks a control's name. */
  text(facts: TutorialFacts): string;
  /** The toolbar tool to point at now, if any. */
  target(facts: TutorialFacts): ToolId | undefined;
  /** Whether the step's work is in the document. */
  done(facts: TutorialFacts): boolean;
}

const key = (id: string) => {
  const keys = keysFor(id)[0];
  return keys ? ` (${shortcutLabel(keys)})` : '';
};

/** The live features of a type. */
const featuresOf = (doc: ExtrudoDocument, ...types: string[]) =>
  doc.features.filter((f) => !f.suppressed && types.includes(f.type));

/** Sketches' contents. */
const sketchesOf = (doc: ExtrudoDocument) =>
  doc.features.map((f) => readSketch(f)?.data).filter((s) => s !== undefined);

const reopen = 'Double-click the sketch on the timeline to open it again, then ';

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'sketch',
    title: 'Start with a sketch',
    text: ({ activeTool }) =>
      activeTool === 'sketch'
        ? 'Now click the **XY plane** in the view: the flat floor. The view turns to face it.'
        : 'Every part starts as a flat drawing. Press **Create Sketch**, then pick a plane.',
    target: ({ activeTool }) => (activeTool === 'sketch' ? undefined : 'sketch'),
    done: ({ doc }) => featuresOf(doc, 'sketch').length > 0,
  },
  {
    id: 'rectangle',
    title: 'Draw a rectangle',
    text: ({ mode }) =>
      `${mode === 'sketch' ? '' : reopen}Press **Rectangle**${key('rectangle')}, click one corner, then the opposite one.`,
    target: ({ mode }) => (mode === 'sketch' ? 'rectangle' : undefined),
    done: ({ doc }) =>
      sketchesOf(doc).some(
        (s) => Object.values(s.entities).filter((e) => e.type === 'line').length >= 4,
      ),
  },
  {
    id: 'dimension',
    title: 'Give it a size',
    text: ({ mode }) =>
      `${mode === 'sketch' ? '' : reopen}Press **Dimension**${key('dimension')}, click one side, click beside it to place the number, then type 40 and press Enter. Numbers are parameters: change one later and the box follows.`,
    target: ({ mode }) => (mode === 'sketch' ? 'dimension' : undefined),
    done: ({ doc }) => sketchesOf(doc).some((s) => Object.keys(s.dimensions).length > 0),
  },
  {
    id: 'extrude',
    title: 'Pull it up',
    text: ({ mode }) =>
      mode === 'sketch'
        ? 'The sketch is done. Press **Finish Sketch** to leave it.'
        : `Press **Extrude**${key('extrude')}, drag the arrow or type a height such as 20, then press OK.`,
    target: ({ mode }) => (mode === 'sketch' ? 'finishSketch' : 'extrude'),
    done: ({ doc }) => featuresOf(doc, EXTRUDE_TYPE).length > 0,
  },
  {
    id: 'round',
    title: 'Make it yours',
    text: () =>
      `Press **Fillet**${key('fillet')}, click a few edges of the box and press OK to round them. Or hollow it out with **Shell**.`,
    target: () => 'fillet',
    done: ({ doc }) => featuresOf(doc, FILLET_TYPE, CHAMFER_TYPE, SHELL_TYPE).length > 0,
  },
];

/** What the card says once the last step is done. */
export const TUTORIAL_FINISH =
  'That is a box! Every step is on the timeline below: double-click one to change it. Try editing the sketch’s dimension and watch the box follow.';

/**
 * The step to show: the first one at or after `floor` (steps the user skipped)
 * whose work isn't in the document. `TUTORIAL_STEPS.length` when all are.
 */
export function currentStep(facts: TutorialFacts, floor = 0): number {
  for (let i = Math.max(0, floor); i < TUTORIAL_STEPS.length; i++) {
    if (!TUTORIAL_STEPS[i]?.done(facts)) return i;
  }
  return TUTORIAL_STEPS.length;
}

/** Splits `**bold**` out of a step's text, for rendering. */
export function textParts(text: string): { bold: boolean; text: string }[] {
  return text
    .split(/\*\*(.+?)\*\*/)
    .map((part, i) => ({ bold: i % 2 === 1, text: part }))
    .filter((p) => p.text !== '');
}
