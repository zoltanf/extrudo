/**
 * A picture of the sheet (P6-24): Report a Bug attaches it in the drawing, where the 3D
 * view's snapshot would show the hidden model (ADR-0092). The sheet's own SVG (the display
 * list, as on screen, without the selection frames) is drawn onto white paper and written
 * as a PNG. A `blob:` image: the CSP's `img-src` allows it.
 */

/** The picture's pixel size: the paper's shape, its longer side `size` px. */
export function snapshotSize(
  paper: { width: number; height: number },
  size: number,
): { width: number; height: number } {
  const k = size / Math.max(paper.width, paper.height);
  return {
    width: Math.max(1, Math.round(paper.width * k)),
    height: Math.max(1, Math.round(paper.height * k)),
  };
}

/** `svg` (the sheet in mm) as a PNG whose longer side is `size` px, or `null` if it fails. */
export async function sheetSnapshot(
  svg: SVGSVGElement,
  paper: { width: number; height: number },
  size: number,
): Promise<Blob | null> {
  const { width, height } = snapshotSize(paper, size);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A sheet's exported SVG (`sheetToSvg`: the export's look, its text outlined) as a PNG
 * whose longer side is `size` px, or `null` if it fails: the agent tools' `export_sheet`
 * (P6-24 S6). Parsed as XML, never run; drawn the same way as `sheetSnapshot`.
 */
export async function sheetSvgSnapshot(
  svg: string,
  paper: { width: number; height: number },
  size: number,
): Promise<Blob | null> {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  if (!(parsed instanceof SVGSVGElement)) return null;
  return sheetSnapshot(parsed, paper, size);
}
