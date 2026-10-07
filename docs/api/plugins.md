---
title: Plugins
section: Guide
order: 6
---

# Plugins

A [plugin](https://github.com/zoltanf/extrudo/blob/main/docs/plugins.md) is a `.extrudo-plugin` file whose custom features appear in
a design as the `plugin` feature. Its inputs are the manifest's, stored as `in:<name>`
inputs, and its handler is a function of a restricted `design`, the typed inputs
and a frozen context.

## Adding a plugin feature

`d.plugin(...)` adds one. `plugin` is the ID of the attachment that holds the plugin file;
`handler` is the manifest feature's `type`; `inputs` are the manifest's inputs by
name: a string is an expression (its unit read off it), a number is a plain
number, a boolean a toggle, `{ kind: 'enum', value }` a choice, and a reference
(or a list of them) a pick.

```ts
import { Design } from '@extrudo/api';

const d = Design.create({ name: 'Plate' });
const plate = d.plugin({
  plugin: 'att-name-plate',
  handler: 'name-plate',
  inputs: { width: '50 mm', height: '20 mm', rounded: true, plane: d.origin.xy },
});
console.log(plate.id);
```

## Handler types

The handler's three arguments, as the example plugin declares them (in `main.ts` the two
records are `export const`; here they are plain constants so the page compiles):

```ts
import { Design, type GeomRef } from '@extrudo/api';

/** The values the feature's dialog gives, by manifest name. */
interface Inputs {
  /** An `expr` input: millimetres, degrees or a plain number. */
  width: number;
  /** A `bool` input. */
  rounded: boolean;
  /** An `enum` input. */
  style: string;
  /** A single `ref` input; an array when the manifest says `multiple`. */
  plane?: GeomRef;
}

interface PluginContext {
  params: Readonly<Record<string, number>>;
  /** A command only: the selection's references, as `design.ref(kind, id)` takes them. */
  selection?: readonly GeomRef[];
}

const features = {
  plate: (design: Design, inputs: Inputs, ctx: PluginContext) => {
    design.box({ length: `${inputs.width} mm`, width: `${ctx.params.depth ?? 10} mm`, height: '3 mm' });
  },
};

const commands = {
  box: (design: Design, _ctx: PluginContext) => {
    design.box({ length: '1 mm', width: '1 mm', height: '1 mm' });
  },
};
```

A handler can only add features. See the [guide](https://github.com/zoltanf/extrudo/blob/main/docs/plugins.md) for the manifest,
installing and versioning.
