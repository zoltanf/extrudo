/**
 * The docs widgets, by name (ADR-0116 §1). A Markdown page names one with a fenced
 * block, ```` ```widget <name> ````, whose body is the caption; `docs.ts` looks the
 * name up here, and an unknown name fails the build. Node-safe: the build calls
 * `render`, which writes the widget's starting state into the page. The scripts
 * that wake each widget are listed in `enhance.ts`, under the same names.
 */
import { switchRow, widgetFigure } from './controls';
import { LABEL, paletteMarkup, START, SWITCHES, VIEW_BOX } from './palette-switches-model';

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
};
