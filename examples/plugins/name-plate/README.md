# Name plate

An example Extrudo plugin (ADR-0077).

- **Name plate** (a custom feature): a plate of `width` × `height`, `thickness`
  thick, centred on a plane's origin, its corners rounded by a quarter of the
  shorter side unless *Rounded corners* is off.
- **Three holes** (a command): a sketch of three Ø4 mm circles on the XY plane,
  20 mm apart along X, cut through everything.

Pack it as `name-plate.extrudo-plugin` (a zip of `plugin.json`, `main.ts` and
this file) with `writePluginFile` from `@extrudo/storage`; the plugin tests in
`packages/cli/src/plugins.test.ts` do exactly that.
