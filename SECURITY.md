# Security policy

## Supported versions

Extrudo is young. Security fixes go into the **latest release** and the
**`main` branch**; older releases are not patched. The hosted app always runs
the latest release.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Report it
privately through GitHub:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe what you found.

That creates a private advisory that only you and the maintainers can see. We
use it to talk with you, work on a fix, and publish an advisory when the fix is
out.

A useful report has:

- what the problem is and what an attacker could do with it,
- the steps to reproduce it, or a proof of concept (a crafted `.extrudo`, STEP,
  STL, 3MF, SVG or DXF file is a good way to show one),
- the version or commit, and the browser and system,
- anything you already know about a fix.

## What counts

Things we care about most, because Extrudo runs in your browser and opens
files from other people:

- script injection, or anything that breaks out of the page or its content
  security policy,
- a crafted design or imported file that runs code, reads data it should not,
  or crashes the browser tab in a way that loses work,
- problems in how projects are stored in the browser,
- problems in the hosted site's headers or service worker.

Bugs in the geometry kernel that only produce a wrong shape are ordinary bugs:
please use the normal issue form. Problems in a third-party library (React,
three.js, OpenCascade and so on) are best reported to that project too; tell us
if Extrudo is affected in a way they would not know.

## What to expect

This is a volunteer project, so these are goals, not promises: we aim to
acknowledge a report within a week, to tell you what we think of it within two,
and to fix confirmed problems as soon as we reasonably can, depending on how
serious they are. We will credit you in the advisory if you want that.

Please give us a reasonable time to fix a problem before you share it publicly.
There is no bug bounty.
