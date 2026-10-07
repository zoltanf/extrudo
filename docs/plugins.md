# Writing a plugin

A plugin adds **commands** (a one-off that builds a few features at the
timeline marker) and **custom features** (a timeline entry with a dialog of its
own and typed inputs, recomputed whenever a parameter changes). It is one file,
`name.extrudo-plugin`: a zip with a `plugin.json` manifest, a `main.ts` (or
`main.js`) module and an optional `README.md` and `LICENSE`. The complete
working example is `examples/plugins/name-plate/` in the repository.

A plugin runs in the same QuickJS sandbox as a [Script](api/scripts.md): no DOM,
network, file access, timers or modules. It can **only add features**
(`design.remove`, `move`, `rename`, `suppress`, `group` and the parameter calls
are refused). Limits per run: 2 seconds, 64 MB, 1,000 generated features,
200,000 characters of source.

## The manifest

`plugin.json` is checked strictly before anything else is read; a key the schema
lacks is refused with its place (`plugin.json › features[0] › inputs[2] › kind`).

```json
{
  "id": "name-plate",
  "name": "Name plate",
  "version": "1.0.0",
  "description": "A plate with rounded corners on any plane, and a command that drills three holes.",
  "author": "The Extrudo contributors",
  "license": "MIT",
  "main": "main.ts",
  "commands": [
    {
      "id": "three-holes",
      "label": "Three holes",
      "hint": "Cuts three Ø4 mm holes through everything along the X axis."
    }
  ],
  "features": [
    {
      "type": "name-plate",
      "label": "Name plate",
      "hint": "A plate with rounded corners, centred on a plane's origin.",
      "icon": "box",
      "inputs": [
        { "name": "width", "label": "Width", "kind": "expr", "unit": "length", "default": "60 mm" },
        { "name": "height", "label": "Height", "kind": "expr", "unit": "length", "default": "20 mm" },
        { "name": "thickness", "label": "Thickness", "kind": "expr", "unit": "length", "default": "3 mm" },
        { "name": "rounded", "label": "Rounded corners", "kind": "bool", "default": true },
        { "name": "plane", "label": "Plane", "kind": "ref", "accepts": ["plane"] }
      ]
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `id` | Lower case letters, digits, dashes (2 to 64). Identifies the plugin across versions. |
| `version` | A semantic version (`1.2.0`). The app installs a newer one over an older one and refuses the same or an older one. |
| `license` | An SPDX expression (`MIT`, `GPL-3.0-or-later`). |
| `main` | `main.ts` (types stripped, not checked) or `main.js`. |
| `commands[]` | `id`, `label`, optional `hint`. A plugin never binds a key. |
| `features[]` | `type`, `label`, optional `hint`, optional `icon` (the name of one of the app's tool icons; an unknown name falls back to the Script's), `inputs[]` (at most 32). |

### Input kinds

| `kind` | Fields | Dialog | The handler gets |
|---|---|---|---|
| `expr` | `unit` (`length`, `angle` or `none`), `default` (an expression or a number), `min`, `max` | An expression field with the unit; a model parameter (`d7`). `min`/`max` appear as the hint "Between 1 and 99." — they are not enforced. | A number: millimetres, degrees or a plain number. |
| `bool` | `default` | A checkbox | `true` or `false` |
| `enum` | `options[]`, `default` (one of the options) | A dropdown | The option's text |
| `ref` | `accepts[]` (`face`, `edge`, `vertex`, `plane`, `axis`, `point`, `profile`, `body`, …), `multiple` | A pick field; the view only takes what `accepts` lists. Required: OK stays disabled until something is picked. | A reference (`GeomRef`), or an array of them when `multiple` |

An input is stored in the design as `in:<name>` (`in:width`), so an expression
can be driven by a parameter, and a reference is named and fingerprinted like any
other, with Fix References when it is lost. Every manifest input has a field;
the dialog adds a line "Plugin: Name plate 1.0.0".

## The handlers

`main.ts` exports `features` and `commands`, each a record of functions by `type`
or command `id`.

```ts
import type { Design, GeomRef, SketchBuilder } from '@extrudo/api';

interface NamePlateInputs {
  width: number;
  height: number;
  thickness: number;
  rounded: boolean;
  plane?: GeomRef;
}

interface PluginContext {
  params: Readonly<Record<string, number>>;
}

export const features = {
  'name-plate': (design: Design, inputs: NamePlateInputs, _ctx: PluginContext) => {
    const { width, height, thickness } = inputs;
    const sketch = design.sketch(inputs.plane ?? design.origin.xy, (k: SketchBuilder) => {
      k.rectangle([-width / 2, -height / 2], [width / 2, height / 2]);
    });
    design.extrude({ profiles: sketch.profileAt([0, 0]), distance: `${thickness} mm` });
  },
};

export const commands = {
  'three-holes': (design: Design, _ctx: PluginContext) => {
    const holes = design.sketch(design.origin.xy, (k: SketchBuilder) => {
      for (const x of [-20, 0, 20]) k.circle([x, 0], '2 mm');
    });
    design.extrude({
      profiles: holes.profiles(),
      direction: 'symmetric',
      extent: 'through-all',
      operation: 'cut',
    });
  },
};
```

(The example's real `main.ts` also rounds the corners with four arcs; see the
file.) `design` is the [document API](api/README.md) restricted to adds, `inputs`
and `ctx` are frozen deeply, `ctx.params` holds the document's parameter values
(millimetres, degrees, plain numbers). A handler that throws, or a feature that
comes out invalid, is the plugin feature's error: "Name plate 1.0.0, main.ts line 3: …".
A failed run makes nothing, and a handler that adds a feature the next time the
inputs change is run again — handlers must be **deterministic** (`Math.random`
is seeded, `Date` is frozen).

**How the inputs reach the handler:** the kernel resolves every `ref` input with
the topological-naming service first, then runs `features[type](design, inputs, ctx)`
in the sandbox. The features the handler adds get IDs `<plugin feature>.f<n>` and
are evaluated right after the plugin feature; a later feature that refers to their
faces depends on the plugin feature. The timeline shows one chip per plugin
feature, with the plugin's name and version in its tooltip.

## Installing and using

**File › Plugins…** (or Ctrl+K "Plugins…"): *Install…* picks a `.extrudo-plugin`
file; the dialog shows its README and license as plain text, and the checkbox
**Enabled** turns it on or off. Plugins live in the browser's storage (OPFS) or,
in the desktop app, the user data folder — never in a design. An enabled plugin
adds:

- its **commands** to Ctrl+K ("Plugins › Name plate" group, model mode only);
- its **custom features** to Ctrl+K and to a "Plugins" section at the end of the
  **Create** menu. Adding one opens its generated dialog; OK adds the feature
  **and the plugin file** to the design in one undo step.

## Versioning and sharing designs

A design carries its own copy of every plugin file it uses (an attachment of
media type `application/x-extrudo-plugin`, named "Name plate 1.0.0"), so it opens
and recomputes where the plugin is not installed, and editing a feature opens the
dialog the design's copy describes. In the Plugins dialog, **In this design**
lists plugins a design carries that are not installed (*Install*) and plugins
whose installed version is newer than the design's copy (*Update to 1.2.0*): that
points every feature of the plugin at the installed file as one undo step. Old
attachments stay until the next version save collects them. Change the `version`
whenever the handler or the inputs change, so the app can tell.

Headless, `extrudo` computes a design with plugin features from the file it
carries: `pnpm extrudo check design.extrudo`.

## Making the file

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { writePluginFile } from '@extrudo/storage';

const dir = new URL('./name-plate/', import.meta.url);
writeFileSync(
  'name-plate.extrudo-plugin',
  writePluginFile({
    manifest: JSON.parse(readFileSync(new URL('plugin.json', dir), 'utf8')),
    code: readFileSync(new URL('main.ts', dir), 'utf8'),
    readme: readFileSync(new URL('README.md', dir), 'utf8'),
  }),
);
```

A file larger than 1 MB, more than 4 MB unpacked, with a path outside the zip's
root, a module over 200,000 characters or a manifest the schema refuses is
rejected with the reason.
