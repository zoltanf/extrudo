/**
 * The docs widgets, by name (ADR-0116 §1). A Markdown page names one with a fenced
 * block, ```` ```widget <name> ````, whose body is the caption; `docs.ts` looks the
 * name up here, and an unknown name fails the build. Node-safe: the build calls
 * `render`, which writes the widget's starting state into the page. The scripts
 * that wake each widget are listed in `enhance.ts`, under the same names.
 */
import { buttonRow, switchRow, widgetFigure } from './controls';
import {
  LABEL as DIMENSION_LABEL,
  START as LABEL_START,
  VIEW_BOX as LABEL_VIEW_BOX,
  labelMarkup,
  resultMarkup as labelResultMarkup,
} from './dimension-label-model';
import {
  LABEL as DOF_LABEL,
  START as DOF_START,
  SWITCHES as DOF_SWITCHES,
  VIEW_BOX as DOF_VIEW_BOX,
  dofMarkup,
  result as dofResult,
} from './dof-playground-model';
import { LABEL, paletteMarkup, START, SWITCHES, VIEW_BOX } from './palette-switches-model';
import {
  LABEL as TRIM_LABEL,
  START as TRIM_START,
  VIEW_BOX as TRIM_VIEW_BOX,
  trimMarkup,
  result as trimResult,
} from './trim-model';

export interface WidgetDef {
  /** The widget's figure in its starting state, controls `disabled`, with `caption`. */
  render(caption: string): string;
}

export const WIDGETS: Readonly<Record<string, WidgetDef>> = {
  'palette-switches': {
    render: (caption) =>
      widgetFigure({
        name: 'palette-switches',
        viewBox: VIEW_BOX,
        label: LABEL,
        stage: paletteMarkup(START),
        controls: SWITCHES.map((row) =>
          switchRow({ ...row, checked: START[row.key as keyof typeof START] }),
        ).join(''),
        caption,
      }),
  },
  'dof-playground': {
    render: (caption) =>
      widgetFigure({
        name: 'dof-playground',
        viewBox: DOF_VIEW_BOX,
        label: DOF_LABEL,
        stage: dofMarkup(DOF_START, false),
        controls:
          DOF_SWITCHES.map((row) => switchRow({ ...row, checked: DOF_START[row.key] })).join('') +
          buttonRow('reset', 'Reset'),
        result: dofResult(DOF_START).text,
        caption,
      }),
  },
  'dimension-label': {
    render: (caption) =>
      widgetFigure({
        name: 'dimension-label',
        viewBox: LABEL_VIEW_BOX,
        label: DIMENSION_LABEL,
        stage: labelMarkup(LABEL_START, false),
        controls: '',
        resultMarkup: labelResultMarkup(LABEL_START),
        caption,
      }),
  },
  trim: {
    render: (caption) =>
      widgetFigure({
        name: 'trim',
        viewBox: TRIM_VIEW_BOX,
        label: TRIM_LABEL,
        stage: trimMarkup(TRIM_START, false),
        controls: buttonRow('reset', 'Reset'),
        result: trimResult(undefined),
        caption,
      }),
  },
};
