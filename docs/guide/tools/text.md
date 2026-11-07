---
title: Text
section: Tools
category: Sketch
order: 90
---

# Text

Type text on the sketch. Its letters are closed regions like any other profile.

| Where | Shortcut |
|---|---|
| Sketch › Create | Shift+T |

<video src="demo:text" muted loop autoplay playsinline aria-label="Text demo"></video>

<!-- notes -->
## Step by step

1. Press `Shift+T` and click where the first line's baseline starts. The
   click snaps like a Line click (points, midpoints, crossings, curves) and
   each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. A **Text** panel opens beside the view with the cursor in its **Text**
   field. Type the text; `Enter` starts a new line. The text previews at the
   anchor as you type, with the anchor point and a second point one height
   above it.
3. Set the **Font**, the alignment (**Left**, **Center** or **Right** of the
   anchor) and the **Height** if the defaults don't fit.
4. Click **OK** or press `Ctrl+Enter` to place the text. **OK** stays
   disabled while the text is empty or the height is not a valid length.
5. The tool stays on and the panel starts again from its defaults (text
   "Text", the default font, **Left**, 10 mm). The next click places another
   text.
6. `Esc` or **Cancel** closes the panel and drops the text; the tool stays
   on. A second `Esc` ends it. The text is one undo step.

## Options

- **Text**: the string. Several lines are fine.
- **Font**: the fonts that come with Extrudo, then the fonts already in this
  design under **This design**. **Add font…** at the end of the list picks a
  `.ttf`, `.otf` or `.woff` file; the font is saved inside the design and
  selected. A font from the design shows the hint "Saved inside this design.
  Only add fonts whose licence allows embedding."
- **Alignment**: **Left**, **Center** or **Right**, about the anchor.
- **Height**: the height of the text, a length or an
  [expression](../parameters.md).
- `X` (Construction): the text you place next is construction geometry.
- Select a text to change its string, font, alignment and height in the
  selection panel. A double-click on the text puts the cursor in its **Text**
  field.

## What it keeps

- The text is one entity over two points: the anchor and a top point, one
  height above it.
- A **Vertical** constraint holds the top point above the anchor, so the text
  stays upright. Delete it to rotate the text.
- The height is a driving dimension between the two points, so it is a
  parameter you can edit and other fields can use.
- A snapped anchor is held where it snapped: **Coincident** with a point,
  **Midpoint**, on the curve, or on both curves of a crossing. An anchor
  placed on the origin is fixed there.
- The solver drops an automatic constraint that would conflict with or
  repeat another.

## Messages

- "Click where the first line’s baseline starts.": the prompt before the
  click.
- "Type the text, then OK. Esc cancels.": the prompt while the panel is open.
- "Type some text first.": the text was empty when it was placed. Type
  something and place it again.
- "WOFF2 isn't supported; convert the font to TTF or OTF first.": the file
  picked for **Add font…** is WOFF2.
- "Extrudo reads TrueType (.ttf), OpenType (.otf) and WOFF (.woff) fonts.":
  the file picked for **Add font…** is not one of those types.
- "This file isn't a font Extrudo can read: `<reason>`.": the font file could
  not be read; the reason replaces `<reason>`. Nothing is stored.
<!-- /notes -->
