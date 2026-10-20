# ADR-0092: Report a Bug: a dialog that captures a screenshot and drafts a GitHub issue

- **Status:** Accepted, 2026-10-19 (the owner's decision; options 1.1 + 1.2,
  2.1 and 3.1 of the plan in this record)
- **Task:** P6-12 (Phase 6: "Report a Bug").
- **Builds on:** ADR-0085 (the About dialog, `aboutLinks.ts`, the desktop's
  link allow-list), ADR-0075 (the desktop app and its bridge), ADR-0090 (one
  app menu, the `MenuModel`), ADR-0054 (hosting, the CSP), the issue forms in
  `.github/ISSUE_TEMPLATE/`.

## Context

A bug report needs what the person saw (a screenshot), what they did, and
where the app ran (version, browser, OS, GPU, the errors the app showed).
Today the About dialog has a "Report an issue" link to a blank GitHub issue
form and a "Copy details" button, and the person assembles the rest by hand:
most reports arrive without a version or a screenshot.

The app has the pieces already: the viewport can render itself to a PNG
(`viewport.getState().snapshot`, used by the MCP `screenshot` tool), the About
dialog's `systemInfo()` collects the environment, `version.ts` has the build,
and `recomputeErrors.ts` sees every feature error. What is missing is one
place that puts them together and gets them to GitHub.

Constraints: the web app cannot call GitHub's API (`connect-src 'self'`, and
the repository takes no anonymous API traffic anyway); GitHub has no API for
issue attachments (images are uploaded by the browser on the issue page); the
desktop's main process opens external links only from its allow-list; the
repository is public, so a report must not carry file paths, design names or
anything else private unless the person chose to include it.

## Decision

### 1. A `Help › Report a Bug…` dialog, no backend, no account

A command `reportBug` ("Report a Bug…", group Help, before About) in the
command palette, the app menu and the desktop menu (through the `MenuModel`,
ADR-0090), plus the About dialog's footer link ("Report an issue" becomes
"Report a bug" and opens the dialog instead of a blank form).

On open the dialog **captures a screenshot** and **gathers the environment**,
then shows:

- **Title** (one line) and two text areas, **What happened?** (with "and what
  did you expect instead?") and **Steps to reproduce**, mapping one to one
  onto the issue form's `what` and `steps` fields.
- **Details**: the version, browser, system and the rest of `systemInfo()`'s
  "Running on" rows, read-only, as the form's `version`, `browser` and `os`
  fields plus a "Running on" block.
- **Errors**: the last feature errors and uncaught errors the app saw (§3),
  read-only, as the form's `console` field.
- An opt-in **"Include the timeline"** checkbox (§4), off by default.
- The **screenshot** with Retake, Copy, Save and Remove.
- A read-only preview of the report as it will reach GitHub.
- Footer: **Open GitHub draft** (the primary action), **Copy report**, **Close**.

Nothing leaves the machine until the person presses "Submit new issue" on
GitHub: the dialog never talks to GitHub itself.

### 2. The GitHub hop: a prefilled issue-form URL, the person submits

"Open GitHub draft" does two things:

1. Puts the screenshot on the clipboard as a PNG
   (`navigator.clipboard.write` with a `ClipboardItem`; Chromium, Electron
   and Safari do this, Firefox from 127).
2. Opens `${ISSUES_URL}?template=bug_report.yml&title=…&what=…&steps=…&version=…&browser=…&os=…&console=…`
   through `platform.openLink` (the desktop's allow-list already admits
   `github.com/zoltanf/extrudo/…`; it checks the path, not the query).

GitHub prefills the form's fields from the query parameters by field id. The
person pastes the screenshot into the "Design file or screenshot" field
(Ctrl+V uploads it) and submits. The dialog says so in three numbered steps
above the footer, and that attaching the `.extrudo` file (File › Export) helps.

**URL length.** Browsers and GitHub take about 8 kB. `issueUrl()` truncates
the fields in the order `console`, `steps`, `what` (each cut ends with
"… (cut: see the copied report)") until the URL is under 8,000 characters;
`title`, `version`, `browser` and `os` are never cut. **Copy report** puts the
full Markdown report on the clipboard for the cases the URL cannot carry.

Rejected: **creating the issue directly** (GitHub's API through a Cloudflare
Worker with a GitHub App, or a personal token typed into Settings). It needs a
service to run and guard against spam, or a token the app would hold, and
still cannot attach the screenshot. Rejected: **the clipboard for the text
too**: one clipboard, and the image is the thing the URL cannot carry.

### 3. The screenshot: the viewport on the web, the window on the desktop

- **Web and desktop alike:** the viewport canvas, through the existing
  `snapshot(size)` (`Viewport.tsx`: renders the scene, then reads the canvas;
  `size` is the long side), at 1600 px. It shows the model, which is what
  most bugs are about, and needs no permission prompt.
- **Desktop:** the whole window, through a new bridge call
  `desktop.capturePage()` (main: `webContents.capturePage()` → PNG bytes),
  which also shows the dialogs, the timeline and the panels. The dialog is
  not in the picture: the capture runs before the dialog mounts, and
  **Retake** hides the dialog for one frame, captures, and shows it again.
  The desktop uses the window capture and falls back to the viewport when it
  fails.

Rejected: **full-page capture on the web** (`html2canvas` is a new dependency
and misses WebGL; `getDisplayMedia` prompts for a screen and records a
stream). Someone who needs more than the viewport takes a screenshot with the
OS and pastes that instead; the dialog says the image is only a help.

**Save** downloads the PNG (`platform.files.download`, `extrudo-bug-<date>.png`)
for browsers whose clipboard refuses images; **Copy** copies it again; **Remove**
drops it (then "Open GitHub draft" copies nothing).

### 4. What the report carries, and what it never does

The report is Markdown with the form's sections in the form's order (What
happened?, Steps to reproduce, Extrudo version, Browser and version, Operating
system, Console errors as a `text` block, Running on). It carries:

- The version line: the app mode (`systemInfo`'s "App" row: browser, PWA,
  desktop), `BUILD.version`, channel and commit.
- `systemInfo()`'s "Running on" rows (browser, system, processor, graphics,
  rendering, screen, window, kernel worker, language, isolation, service
  worker). Not the "Memory and storage" rows: they say nothing about a bug and
  something about the machine.
- The last **10 errors** from a ring buffer the shell fills: feature errors
  (`recomputeErrors.ts`'s `NewError.text`, "Extrude2: The cut doesn't touch
  any body.") and uncaught errors (`window` `error` and `unhandledrejection`
  events). **Message lines only, no stack traces**: a stack on the desktop
  names `file://` paths under the person's home folder. Consecutive
  duplicates collapse.
- With "Include the timeline" ticked: one line per feature, its name and
  type, in timeline order ("3. Extrude1 (extrude)"). **Off by default**
  (owner, option 3.1): feature names are the person's own words.

Never: file paths, the design's name, parameters or values, the document,
storage figures, the person's name or address. The dialog says "Nothing is
sent until you submit on GitHub; remove anything private before you do."

### 5. Where the pieces live

| Piece | File |
|---|---|
| Report text, issue URL, truncation, the error ring buffer, the timeline summary: pure, tested | `apps/web/src/shell/bugReport.ts`, `bugReport.test.ts` |
| The dialog, capture, clipboard, save | `apps/web/src/shell/BugReportDialog.tsx` |
| The command (the app menu, the palette and the desktop menu list every Help command by its group) | `apps/web/src/shell/commands.tsx` (`reportBug`) |
| The About footer link | `apps/web/src/shell/AboutDialog.tsx` |
| The desktop window capture | `apps/desktop/src/main/ipc.ts`, the preload, `DesktopApp.capturePage` in `apps/web/src/platform/index.ts` |
| The e2e spec | `e2e/bug-report.spec.ts` |

`ISSUES_URL` stays the base; the prefilled URL is on the desktop allow-list
by its path, and `links.test.ts` gets a case with query parameters.

## Consequences

- A report from the dialog always has the version, the environment and the
  app's own error texts; most also have a screenshot. Triage gets faster.
- No new dependency, no service, no secret, no change to the CSP.
- The person still does two things on GitHub (paste the image, press Submit):
  that is the price of no backend, and it keeps them in control of what goes
  out.
- Firefox below 127 cannot copy an image: the dialog's Save button and the
  numbered steps cover it ("save and upload the PNG").
- The issue form's field ids (`what`, `steps`, `version`, `browser`, `os`,
  `console`, `file`) are now an interface: renaming one in
  `bug_report.yml` breaks the prefill silently. `bugReport.test.ts` reads the
  template and checks the ids it uses exist.
