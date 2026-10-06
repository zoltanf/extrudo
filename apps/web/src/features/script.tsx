import { scriptFeature, scriptInputs, scriptSettings } from '@extrudo/core';
import { type ComponentType, useEffect, useState } from 'react';
import type { DialogExtraProps, FeatureDialogSpec } from './spec';

/** Only the small spec is eager: CodeMirror and the API completion list load on opening. */
function ScriptExtra(props: DialogExtraProps) {
  const [Editor, setEditor] = useState<ComponentType<DialogExtraProps>>();
  useEffect(() => {
    let live = true;
    void import('./scriptEditor').then((module) => {
      if (live) setEditor(() => module.ScriptEditor);
    });
    return () => {
      live = false;
    };
  }, []);
  return Editor ? <Editor {...props} /> : <p role="status">Loading script editor…</p>;
}

export const scriptDialog: FeatureDialogSpec = {
  ...scriptFeature,
  command: 'script',
  wide: true,
  previewDelay: 500,
  fields: [
    {
      kind: 'choice',
      name: 'language',
      label: 'Language',
      default: 'ts',
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
    },
  ],
  initialValues: ({ doc }) => {
    const parameter = Object.values(doc.parameters)[0];
    const size = parameter ? `Math.max(1, params[${JSON.stringify(parameter.name)}])` : '20';
    return {
      choices: {
        code: `// A parametric box; lengths are in millimetres.\nconst size = ${size};\ndesign.box({ length: size, width: size, height: size });`,
      },
    };
  },
  toInputs: (values) =>
    scriptInputs({
      code: values.choices.code ?? '',
      language: values.choices.language === 'js' ? 'js' : 'ts',
    }),
  fromInputs: (inputs) => ({ choices: { ...scriptSettings(inputs) } }),
  extra: ScriptExtra,
};
