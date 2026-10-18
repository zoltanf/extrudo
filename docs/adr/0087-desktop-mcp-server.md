# ADR-0087: An MCP server in the desktop app, with a shipped skill

- **Status:** Accepted, 2026-10-15
- **Task:** P6-08 (Phase 6: "MCP server in the desktop app").
- **Builds on:** ADR-0075 (the desktop app: main owns everything privileged,
  every channel in `shared/ipc.ts`, the external-files rule), ADR-0068 (the
  document API: `Design.from`, generated feature methods, `ApiError`),
  ADR-0077 (a plugin command's features inserted at the marker in one
  transaction after `remintFeatures`), ADR-0082 (the Settings screen and its
  inventory), ADR-0052 (the command registry).
- **No schema or file-format change.** The document is untouched; the server
  reads it and changes it through the same commands the app's own UI uses.
- **Protocol:** MCP over Streamable HTTP through `@modelcontextprotocol/sdk`
  1.32 (MIT). The skill follows **SEP-2640 "Skills Extension", status Final**
  (created 2026-04-23; read 2026-10-15 at
  <https://modelcontextprotocol.io/seps/2640-skills-extension>).

## Context

People already drive CAD with coding agents: they describe a part, the agent
writes code against an API, and they look at the result. Extrudo has the API
for it (ADR-0068) and a CLI (ADR-0069), but both work on files, not on the
design open in front of the person. The owner asked (2026-10-14) for the
desktop app to host a Model Context Protocol server while it runs, so Claude
Code, Claude Desktop and other MCP clients can read and change the open
design, and for a skill that teaches an agent how to model in Extrudo to ship
with it. The roadmap's Open decision 6 settled "on by default" the same day.

A local server that changes documents is a door into the person's machine.
The rules below are what keeps it a door only the person's own agent can open.

## Decision

### 1. Electron main hosts it, on 127.0.0.1, over Streamable HTTP

Main starts a Node `http.createServer` bound to the literal `127.0.0.1` (never
`0.0.0.0`, never `localhost`, which can resolve to `::1` or worse; a test
checks `server.address().address`), default port **7474**, path **`/mcp`**,
and hands each admitted request to the SDK's `StreamableHTTPServerTransport`
in front of the SDK's low-level `Server` (`main/mcp/server.ts`,
`createMcpServer({ port, token, tools, handle, skill, onActivity })`, pure over
the injected handler, so it is tested over real HTTP with the SDK's own
client and no Electron). Each client gets a session (its own `Server` +
transport; at most 16, the oldest idle one goes first). The SDK is a
devDependency of `@extrudo/desktop` bundled into `out/main`, like
`electron-updater`; `scripts/check-licenses.mjs` walks its whole dependency
tree against the allow-list (`BUNDLED_DEV`, since `--prod` can't see a
devDependency) and `NOTICE` §4 names it. **Nothing under `apps/web` imports the
SDK**: the web build has no server and no MCP code beyond the tools of §5,
which are plain functions.

### 2. Who may call: Host, Origin, size, token — in that order

`main/mcp/admit.ts`'s pure `admit(request, { port, token })`, with a table of
unit tests:

1. **403** when `Host` is not `127.0.0.1:<port>` or `localhost:<port>`, or an
   `Origin` header is present and not `http://127.0.0.1[:port]` or
   `http://localhost[:port]`. This stops DNS rebinding (a page whose name
   resolves to 127.0.0.1 sends its own `Host`) and any web page (a browser
   always sends `Origin` on a cross-origin POST). It comes before the token,
   so a page learns nothing by guessing.
2. **413** for a `Content-Length` over 1 MB; the body reader stops at 1 MB too
   when there is no length.
3. **401** `{"error":"Unauthorized."}` without `Authorization: Bearer <token>`
   or with a wrong one (compared in constant time), no details.

The token is 32 random bytes as hex, made on first start and kept in
`userData/mcp-token` with mode 0600 (`main/mcp/token.ts`). Settings'
**Regenerate token** writes a new one, and the server reads the current value
on every request, so the old one stops working at once.

### 3. On by default; main reads the preferences itself

Two desktop-only preferences in `settings/inventory.ts`'s Desktop section:
**`mcp.enabled`** (true) and **`mcp.port`** (7474; 1024–65535, anything else is
7474). Main reads them from its own preference file (like `slicers.paths`), so
the server listens before the renderer is up. A write of an `mcp.*` key over
`prefs:write` makes main reconfigure: **off closes the port at once**
(`server.close()` plus `closeAllConnections()`; a test binds the port again to
prove it is free), a new port restarts it. A bind error ("Port 7474 is in use
by another program.") is the status's `error`, shown in Settings, never a
crash. `main/mcp/service.ts` holds this lifecycle, serialised so a quick
off-on can't race two binds.

### 4. Main never touches the document

Each tool call is one round trip to the renderer over new channels in
`shared/ipc.ts`, with their payloads and checks in `shared/mcp.ts`:

| Channel | Direction | Payload |
|---|---|---|
| `extrudo:mcp:request` | main → renderer | `{ id, tool, args }` |
| `extrudo:mcp:respond` | renderer → main | `{ id, result }` (an MCP `CallToolResult`, text and PNG image content only), `{ id, result, file }` (an export), or `{ id, error }` |
| `extrudo:mcp:tools` | renderer → main | the tool list: names, descriptions, JSON schemas |
| `extrudo:mcp:status` | main → renderer | `{ enabled, port, url, listening, clients, error? }` |
| `extrudo:mcp:status-read`, `extrudo:mcp:config`, `extrudo:mcp:regenerate-token` | renderer → main (invoke) | the status; `{ url, token }` for Copy client config |

Main checks every payload (`isToolDefinitionList`, `isToolResponse`) and drops
a malformed one with a warning, like a malformed menu model. A call with no
answer in **60 s** fails as a tool error; a call while no page is loaded
answers "Extrudo's window isn't open." **Main carries no tool knowledge**: the
tool list is whatever the renderer sent on start-up (the tools are the web
app's). The one exception is `get_skill`: the renderer lists it, and main
answers it from the skill it already serves (§7), so the renderer needs no
copy of the skill.

On the renderer side `Platform` gains **`agent?: AgentBridge`**
(`onRequest(handler)`, a `status` store, `config()`, `regenerateToken()`,
`setTools()`), implemented in `apps/desktop/src/renderer/agent.ts` and absent
on the web.

### 5. The tools live in the web app

`apps/web/src/agent/`: `schemas.ts` (zod input schemas through core's
`zod.ts`; the same objects give the MCP `inputSchema` through
`z.toJSONSchema`), `tools.ts` (one function per tool over an `AgentHost`
interface), and the host the shell implements. Names are snake_case:

- **Read:** `list_designs`, `get_design` (id, name, parameters,
  configurations, the timeline as `[{ id, type, name, status, message?,
  suppressed }]`), `get_document` (the document JSON), `get_bodies`
  (`[{ id, name, volume, box, visible }]` from the model store, the measures
  Print Info uses), `get_selection`, `get_feature(id)` (its inputs as the
  API's plain values), `screenshot` (the viewport as an MCP `image` block,
  PNG).
- **Change:** `set_parameter(name, expression)` (through the shell's `apply`,
  so sketches re-solve; it creates the parameter when the name is new),
  `apply_configuration`, `add_sketch(plane, shapes)`, `add_feature(type, inputs)` and
  `edit_feature(id, inputs)`, `suppress(id, on)`, `rename(id, name)`,
  `remove(id)`, `run_command(id)` and `list_commands`, `undo`, `redo`.
- **Files:** `list_designs`, `new_design(name?)`, `open_design(id)`, `save`,
  `export(format: stl|3mf|step)`.
- **`get_skill`**: the skill's `SKILL.md` text.

`add_feature`/`edit_feature` take the `@extrudo/api` method's plain values: the
generated method runs on `Design.from(document)` in the renderer (no kernel,
ADR-0068), and the features it added are inserted into the open design **in
one transaction with `remintFeatures`**, the way a plugin command's are
(ADR-0077); a bad input answers `ApiError`'s path and changes nothing. **Every
change is one undo transaction named `Agent: <what>`**, so the timeline and
Ctrl+Z show it and one tool call is one undo step. With no design open, a
change tool answers "No design is open: call open_design first." as an MCP
tool error (`isError`), never an exception.

The export is written **by main** under `userData/agent-exports/<design>-<n>.<ext>`
(`main/mcp/exports.ts`: a safe stem, never overwriting) and the path returned;
the renderer sends the bytes and never names a path (ADR-0075's external-files
rule).

### 6. Safety and status

- The top bar shows **"Agent connected"** while a client is (a stream open, or
  a request in the last 30 s), with a tooltip naming the count.
- Settings › Desktop shows the state ("Listening on
  http://127.0.0.1:7474/mcp", "Off", or the bind error), the switch, the port,
  **Copy client config** (`{"mcpServers":{"extrudo":{"type":"http","url":…,
  "headers":{"Authorization":"Bearer …"}}}}`) and **Regenerate token**. The
  port is a plain numeric field, not an `<ExpressionInput>`: it is a setting
  of the app, not a model value, and has no unit, parameter or expression.
- Screenshots at most one per second and exports one per 2 s (later calls
  wait), exports at most 20 MB (main refuses a larger file).

### 7. The skill, served per SEP-2640

The skill is in the repo at **`apps/desktop/skill/extrudo/`**: `SKILL.md` (Agent
Skills frontmatter `name: extrudo`, `description`) and `references/api.md`,
`references/tools.md`, `references/examples.md`. `api.md` and `tools.md` are
**generated** by `pnpm api:generate` (from the same data as `docs/api/`, and
from the tool schemas); a test fails when they are stale and when the skill
names a tool or API method that doesn't exist.

Main bundles the folder (Vite's `import.meta.glob` with `?raw`) and serves it
(`main/mcp/skill.ts`):

- the capability `extensions: { "io.modelcontextprotocol/skills": {
  "directoryRead": true } }` with `resources`;
- **`skills/list`** and **`skills/get`** answer the skill's entry: `uri`
  `skill://extrudo/SKILL.md`, the frontmatter as JSON, and every file's
  `{ uri, digest: "sha256:…", size }`;
- every file is a resource `skill://extrudo/<path>` (`resources/list`,
  `resources/read`; `SKILL.md` as `text/markdown` with the frontmatter's name
  and description), and **`resources/directory/read`** lists a directory's
  direct children (`inode/directory` for folders); an unknown URI is `-32602`;
- the server's `instructions` are "Read skill://extrudo/SKILL.md before
  modelling.".

SDK 1.32 has no Skills-extension API, so the three methods are custom request
handlers on the low-level `Server` (zod schemas with the method literal), and
the capability is passed through `capabilities.extensions`, which the SDK's
types already carry. The roadmap's draft wording (a `skill://index.json`
index) was the SEP as drafted; the Final SEP replaced the index with
`skills/list`/`skills/get`, which is what is implemented. The same folder is
zipped by `.github/workflows/desktop.yml` as `extrudo-skill-<version>.zip`
next to the installers, for clients that load skills from disk.

### 8. Decided while implementing

- **`add_sketch`** (not in the task's list): an extrude needs a profile, and a
  sketch's content is a builder callback in the API, which a tool call can't
  carry. It takes a plane (`'xy'`, `'xz'`, `'yz'` or a face reference) and a
  list of shapes (rectangles with optional width and height dimensions, circles
  with a diameter dimension, lines, polylines, arcs, slots), runs the API's
  `d.sketch` and answers the sketch's profile references.
- **`new_design`**: with no design open there is nothing for `open_design` to
  open on a fresh install, and the commands of `run_command` exist only inside a
  design.
- **`{ edgeBetween: [face, face] }`**: an edge's name is its two faces' names
  sorted (`e[a|b]`), which an agent can't sort reliably when the names hold
  random feature IDs; the shorthand is expanded with the API's `edgeName`.
- **`get_skill` is answered by main**, which holds the skill for the resources;
  the renderer lists the tool like the others.
- **Copy client config works while the server is off**: it gives the URL the
  server would listen on.
- **A change is refused while a sketch is being edited or a dialog's
  transaction is open** ("Finish the sketch or close the open dialog in
  Extrudo first."): the agent's step would otherwise join the person's.
- **A change waits for the sketch solver** (`AgentHost.ready`, the tool host's
  `whenSolverReady`): the solver loads only when a design has dimensions, and a
  sketch the agent dimensions by a parameter must be solved before the kernel
  reads it.
- **`run_command` runs outside any agent transaction** (2026-10-15, the
  coordinator's review): a command is undoable on its own, and one that opens a
  feature dialog, a tool or a sketch begins its own step, which an agent step
  around it would swallow (`UndoHistory.commit` closes the innermost level). When
  the command leaves a transaction open or enters sketch mode it answers
  `{ command, opened }` ("<label> opened in the app: finish it there, or ask the
  person to; change tools are refused until then."); otherwise it waits for the
  recompute. It refuses `undo` and `redo` (their own tools do it).
- **App-level commands are not for agents** (`AGENT_DENIED_COMMANDS`, plus the
  `openRecent` prefix): what quits, shows a native dialog or file picker, opens a
  page outside the app or changes the app's settings is left out of
  `list_commands` and answers "Not available to agents." in `run_command`.
- **A renderer is ready again after `app:ready`**: `did-navigate` (a committed
  cross-document navigation, not a hash route or one `will-navigate` blocked)
  and `render-process-gone` mark it gone; until the app has mounted its handler
  the renderer answers "Extrudo isn't ready yet". At most 64 calls wait at once
  and 16 sessions live (a 17th while all hold a stream is 503).
- **Port squatting:** another local user could bind 7474 first and receive the
  token from a configured client. Settings shows "Port 7474 is in use by another
  program. If another program answered on this port, regenerate the token."; the
  remedy is another port and a new token.
- **Headless runs need a display.** Chromium's headless Ozone platform crashes
  Electron 44's main process, so the acceptance client runs under `xvfb-run -a`.

### 9. Out of scope

A headless `extrudo mcp` over stdio in the CLI (a later task if wanted), LAN or
remote access, OAuth, and MCP resources for the document (the tools are
enough for now).

## Rejected

- **Stdio only** (a `extrudo mcp` process the client spawns): it can't reach
  the design open in the running app, which is the point; a headless server
  over files is the CLI's job and stays a possible later task.
- **The server in the renderer**: a renderer can't listen on a socket
  (sandboxed, no Node), and giving it one would hand the network to the
  process that parses untrusted files.
- **Binding `0.0.0.0`** (or a LAN address), even behind the token: the token
  would cross the network in clear text and every machine on it could try.
- **No token**, trusting 127.0.0.1: any local program, and any web page that
  gets past the Origin check through a browser quirk, could change designs.
- **An allow-list of origins** instead of refusing every `Origin` but the
  loopback: no legitimate MCP client is a web page, so any foreign origin is
  refused and there is no list to keep.
- **Off by default** (Open decision 6): one more step for every user; copying
  the token from Settings already is the consent.
- **A per-client Allow/Deny prompt**: duplicates the token's purpose.

## Consequences

- An agent can build and change a design live while the person watches, with
  every change in the timeline and one Ctrl+Z away.
- The tools are the web app's and run in the renderer, so they use exactly the
  app's commands, `apply` and the recompute; main stays a thin relay.
- The skill's API and tool references can't drift from the code: they are
  generated and tested.
- A new tool is a schema and a function in `apps/web/src/agent/`, then
  `pnpm api:generate` for `tools.md`.
- The SDK (and its dependency tree) is in the desktop installer; the web
  bundle is unchanged.

## Amendment, 2026-10-18: Agents (MCP) is its own Settings section, with the setup per agent

Trying the server from Claude Code on the owner's laptop found two things.
**Copy client config failed** ("Couldn't copy the client config."): main's
`setPermissionRequestHandler` denied every permission, and Chromium gates
`navigator.clipboard.writeText` behind `clipboard-sanitized-write`, so every
Copy button in the desktop app (About's details, macros, scripts included) was
refused. `main/permissions.ts`'s `allowPermission` now allows that one
permission and nothing else (reading the clipboard stays denied), with a test.
And the setup was **crammed into the Desktop section** with no help on where
the config goes: a person has to know their agent's config format.

Decided:

- **`agents` is a section of its own** in `settings/inventory.ts` ("Agents
  (MCP)", desktop only, the keys `mcp.enabled` and `mcp.port`); Desktop keeps
  the slicers. §6's "Settings › Desktop" reads Settings › Agents (MCP).
- **The page gives the setup per agent** (`apps/web/src/agent/clientSetup.ts`,
  `agentSetups({ url, token })`, pure and tested): a combobox "Agent" picks
  Claude Code (`claude mcp add --transport http … --header "Authorization:
  Bearer …"`), Codex CLI (a `[mcp_servers.extrudo]` table with `url` and
  `http_headers` for `~/.codex/config.toml`), opencode (an `mcp.extrudo` entry
  of type `remote` with `headers` for `opencode.json`), Other (the `mcpServers`
  JSON that Claude Desktop, Cursor and others take; `clientConfig` moved here
  from `platform/agent.ts`) and Tell the agent (one sentence with the URL, the
  header and the skill to read, for an agent that configures itself). The text
  is a read-only textbox "Setup for <agent>" that selects itself on focus, so it
  can be copied by hand when the clipboard can't be written; **Copy** puts it on
  the clipboard, and **Regenerate token** rewrites every text. The texts follow
  the port: the dialog reads the config again when the status's URL changes.
- The texts show the token. They are the person's own settings on their own
  computer, and a text without the token would be useless; the page says that
  anyone who can read it can change the designs, and Regenerate locks them out.

### Installing the skill into the agent (same amendment, later the same day)

Serving the skill over MCP is not enough on its own: no client is known yet to
load SEP-2640 skills by itself, so the resource and `get_skill` depend on the
agent reading them on its own initiative, while a skill on disk loads at session
start and triggers on its description. Each agent has a global skills folder:
Claude Code `~/.claude/skills/<name>/SKILL.md`, Codex CLI `~/.codex/skills/`,
opencode `~/.config/opencode/skills/` (it reads `~/.claude/skills` too).

- `main/mcp/skillInstall.ts` (Electron-free, tested): `skillsHome(agent, home)`
  for those three, `skillRoot(dir)` (`<dir>/extrudo`, or `dir` when the person
  picked the skill's own folder), `skillState(dir, files)` (`missing`, `stale`
  when any file's sha256 differs from this build's, `current`),
  `installSkill(dir, files)` (writes every file, replacing what is there), and
  `createSkillInstaller({ files, home, chooseFolder })` behind the invokes
  `extrudo:mcp:skill-state` and `extrudo:mcp:skill-install` (`McpSkillTarget`:
  `{ dir, state }`, the home directory shown as `~`).
- **Main writes only where a dialog said** (ADR-0075 §3): Install skill opens a
  folder dialog (`dialogs.ts`'s `createFolderPicker`: "Install the Extrudo skill
  into", button "Install here", `createDirectory`) preset to the agent's folder,
  or to home for an agent the app doesn't know, and writes under the folder
  picked. No path is written unasked, and the renderer never names one.
- The Agents page shows a **Skill** row per agent ("Not installed…", "Installed
  in …, up to date", "Installed in …: an older version") and the button
  **Install skill** / **Update skill** (stale), or **Save skill to…** for Other
  and Tell the agent; `AgentSetup.skillTarget` marks the agents with a known
  folder and `skillNote` what they need (Codex: skills enabled, a restart). The
  bridge methods are optional on `AgentBridge`, so the web build and tests
  without them are unaffected.

