/** A small plugin file for the plugins tests (P6-03 slice 2). */
import { writePluginFile } from '@extrudo/storage';

export const pluginManifest = (version = '1.0.0', extra: Record<string, unknown> = {}) => ({
  id: 'tiny',
  name: 'Tiny',
  version,
  description: 'Makes small things.',
  author: 'Someone',
  license: 'MIT',
  main: 'main.ts',
  commands: [{ id: 'box', label: 'Small box', hint: 'A 1 mm cube' }],
  features: [{ type: 'peg', label: 'Peg', inputs: [] }],
  ...extra,
});

export const pluginBytes = (version = '1.0.0', extra?: Record<string, unknown>) =>
  writePluginFile({
    manifest: pluginManifest(version, extra),
    code: "export const commands = { box: (design) => design.box({ length: '1 mm' }) };\n",
    readme: '# Tiny\n\n<script>alert(1)</script> stays text.\n',
    license: 'MIT License\n',
  });
