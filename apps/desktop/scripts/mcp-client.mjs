#!/usr/bin/env node
/**
 * The MCP server's acceptance client (P6-08, ADR-0087). Connects to a running
 * Extrudo with the token, lists the tools, finds the skill (`skills/list`,
 * `skill://extrudo/SKILL.md`, `get_skill`), makes a design, adds a sketch and
 * an extrude of it, sets a parameter and reads the new body's volume, checks
 * the timeline, and undoes the parameter change.
 *
 *   node apps/desktop/scripts/mcp-client.mjs --url http://127.0.0.1:7474/mcp --token <hex>
 *   node apps/desktop/scripts/mcp-client.mjs --launch [--port 7491] [--keep]
 *
 * `--launch` starts the built app (`pnpm --filter @extrudo/desktop build`, and
 * Electron's binary: docs/desktop.md) with a throwaway data directory, the
 * port given and no sandbox, reads
 * the token main wrote there, runs the client and quits the app; `--keep`
 * leaves it running and prints the URL and token instead of quitting. It needs
 * a display: on a headless machine run it under `xvfb-run -a` (Chromium's
 * headless Ozone platform crashes Electron's main process).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(appDir, 'package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { ResultSchema } = require('@modelcontextprotocol/sdk/types.js');

const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

/** Starts the built app on `port` with a fresh data directory; resolves with its URL, token and process. */
async function launch(port) {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error('No display: run this under `xvfb-run -a`.');
  }
  if (!existsSync(join(appDir, 'out', 'main', 'index.cjs'))) {
    throw new Error('No build: run `pnpm --filter @extrudo/desktop build` first.');
  }
  const userData = mkdtempSync(join(tmpdir(), 'extrudo-mcp-'));
  writeFileSync(join(userData, 'preferences.json'), JSON.stringify({ 'mcp.port': port }));
  const electron = require('electron');
  const child = spawn(electron, [appDir, '--no-sandbox'], {
    env: { ...process.env, EXTRUDO_USER_DATA: userData, EXTRUDO_DISABLE_UPDATES: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const tokenFile = join(userData, 'mcp-token');
  for (let i = 0; i < 120 && !existsSync(tokenFile); i++) await sleep(500);
  if (!existsSync(tokenFile)) {
    child.kill();
    throw new Error('The app wrote no token within 60 s.');
  }
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token: readFileSync(tokenFile, 'utf8').trim(),
    child,
    userData,
  };
}

async function connect(url, token) {
  const client = new Client({ name: 'extrudo-acceptance', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

const textOf = (result) => result.content.find((c) => c.type === 'text')?.text ?? '';
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${textOf(result)}`);
  return textOf(result);
}
const callJson = async (client, name, args) => JSON.parse(await call(client, name, args));

async function run(url, token) {
  // Refused without the token, and from a web page.
  const bare = await fetch(url, { method: 'POST', body: '{}' });
  check(bare.status === 401, `no token: ${bare.status}`);
  const page = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://example.com' },
    body: '{}',
  });
  check(page.status === 403, `a foreign Origin: ${page.status}`);

  const client = await connect(url, token);
  check(
    client.getInstructions() === 'Read skill://extrudo/SKILL.md before modelling.',
    'instructions point at the skill',
  );
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const name of ['get_design', 'add_feature', 'set_parameter', 'get_bodies', 'get_skill']) {
    check(names.includes(name), `tools/list has ${name}`);
  }

  const Any = ResultSchema;
  const { skills } = await client.request({ method: 'skills/list', params: {} }, Any);
  check(skills?.[0]?.uri === 'skill://extrudo/SKILL.md', 'skills/list finds the skill');
  const read = await client.readResource({ uri: 'skill://extrudo/SKILL.md' });
  const skillText = read.contents[0]?.text ?? '';
  check(skillText.startsWith('---\nname: extrudo'), 'SKILL.md reads as a resource');
  check((await call(client, 'get_skill')) === skillText, 'get_skill gives the same text');

  const design = await callJson(client, 'new_design', { name: 'MCP acceptance' });
  check(design.name === 'MCP acceptance', `new design ${design.id}`);
  await call(client, 'set_parameter', { name: 'depth', expression: '5 mm' });
  const sketch = (
    await callJson(client, 'add_sketch', {
      plane: 'xy',
      shapes: [{ shape: 'rectangle', from: [0, 0], to: [40, 20], width: '40 mm', height: '20 mm' }],
    })
  ).result;
  check(sketch.profiles.length === 1, `sketch ${sketch.name} has one profile`);
  const added = await callJson(client, 'add_feature', {
    type: 'extrude',
    inputs: { profiles: sketch.profiles, distance: 'depth' },
  });
  check(added.problems.length === 0, `extrude added: ${added.result[0].name}`);
  const bodies = await callJson(client, 'get_bodies');
  check(Math.abs(bodies[0].volume - 4000) < 0.01, `body volume ${bodies[0].volume} mm³`);

  await call(client, 'set_parameter', { name: 'depth', expression: '10 mm' });
  const after = await callJson(client, 'get_bodies');
  check(Math.abs(after[0].volume - 8000) < 0.01, `after depth = 10 mm: ${after[0].volume} mm³`);
  const { timeline } = await callJson(client, 'get_design');
  check(
    timeline.map((f) => `${f.type}:${f.status}`).join(' ') === 'sketch:ok extrude:ok',
    `timeline: ${timeline.map((f) => `${f.name} (${f.status})`).join(', ')}`,
  );
  const undone = await callJson(client, 'undo');
  check(undone.undone === 'Agent: Set depth', `undo took back "${undone.undone}"`);
  const back = await callJson(client, 'get_bodies');
  check(Math.abs(back[0].volume - 4000) < 0.01, `after undo: ${back[0].volume} mm³`);
  // A sketch whose size is a parameter is solved before the extrude reads it.
  await call(client, 'set_parameter', { name: 'dia', expression: '20 mm' });
  const peg = (
    await callJson(client, 'add_sketch', {
      plane: 'xy',
      shapes: [{ shape: 'circle', center: [100, 0], diameter: 'dia' }],
    })
  ).result;
  await callJson(client, 'add_feature', {
    type: 'extrude',
    inputs: { profiles: peg.profiles, distance: '10 mm' },
  });
  const pegs = await callJson(client, 'get_bodies');
  const pegVolume = pegs.find((b) => Math.abs(b.volume - 4000) > 1)?.volume;
  check(
    Math.abs(pegVolume - Math.PI * 100 * 10) < 1,
    `a 'dia' circle extruded 10 mm: ${pegVolume} mm³`,
  );
  const shot = await client.callTool({ name: 'screenshot', arguments: {} });
  check(shot.content[0]?.type === 'image', 'screenshot is a PNG image block');
  await client.close();
}

/**
 * `--examples`: runs every call of the skill's worked examples in order, with
 * `<Name id>` replaced by the id of the feature named Name, and fails on a tool
 * error or a feature left in error.
 */
async function runExamples(url, token) {
  const text = readFileSync(join(appDir, 'skill/extrudo/references/examples.md'), 'utf8');
  const calls = [...text.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) =>
    m[1]
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line)),
  );
  const client = await connect(url, token);
  for (const { tool, args } of calls) {
    let resolved = JSON.stringify(args);
    if (resolved.includes(' id>')) {
      const { timeline } = await callJson(client, 'get_design');
      resolved = resolved.replace(/<([^<>]+) id>/g, (_, name) => {
        const found = timeline.find((f) => f.name === name);
        if (!found) throw new Error(`No feature named ${name}.`);
        return found.id;
      });
    }
    const result = await client.callTool({ name: tool, arguments: JSON.parse(resolved) });
    if (result.isError) throw new Error(`${tool} failed: ${textOf(result)}`);
    const answer = result.content[0]?.type === 'text' ? textOf(result) : '(image)';
    let problems = [];
    try {
      problems = JSON.parse(answer).problems ?? [];
    } catch {}
    check(problems.length === 0, `${tool} ${resolved.slice(0, 90)}`);
    if (tool === 'get_bodies') console.log(answer);
  }
  await client.close();
}

const port = Number(arg('--port') ?? 7491);
let app;
try {
  if (process.argv.includes('--launch')) {
    app = await launch(port);
    console.log(`launched: ${app.url} (data in ${app.userData})`);
  }
  const url = app?.url ?? arg('--url');
  const token = app?.token ?? arg('--token');
  if (!url || !token) throw new Error('Give --url and --token, or --launch.');
  // The server listens before the window is up; wait for the renderer's tool list.
  for (let i = 0; i < 60; i++) {
    try {
      const probe = await connect(url, token);
      const { tools } = await probe.listTools();
      await probe.close();
      if (tools.length > 0) break;
    } catch {}
    await sleep(1000);
  }
  if (process.argv.includes('--examples')) await runExamples(url, token);
  else await run(url, token);
  console.log('All checks passed.');
  if (app && process.argv.includes('--keep')) {
    console.log(`Still running: ${app.url}\nToken: ${app.token}`);
    app = undefined;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  app?.child.kill();
}
