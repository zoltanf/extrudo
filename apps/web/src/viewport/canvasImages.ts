/**
 * The pictures a canvas draws (P4-06, ADR-0066 §5), on the UI thread: an
 * attachment's bytes are decoded once with `createImageBitmap` and turned into
 * a three.js texture, cached per attachment ID and **disposed when the last
 * canvas using it goes** (ADR-0024's rule about OCCT objects, as much as it
 * applies to the GPU).
 *
 * No URL is loaded: the bytes come from the project's attachment store
 * (`attachmentBytes`, ADR-0061 §3) or from the cache a freshly picked file
 * was put into (`putAttachmentBytes`), so the CSP is untouched and a design
 * opens offline with its pictures.
 *
 * The pixel sizes are in a store of their own, because the Viewport's
 * `data-canvases` needs a canvas's height (the picture's aspect) before it
 * draws anything.
 */
import type { AttachmentId } from '@extrudo/core';
import { LinearFilter, SRGBColorSpace, type Texture, Texture as ThreeTexture } from 'three';
import { createStore } from 'zustand/vanilla';
import { attachmentBytes } from '../sketch/fonts';
import type { CanvasPixels } from './canvasGeometry';

/** A decoded picture and the texture drawn from it. */
export interface CanvasImage {
  bitmap: ImageBitmap;
  texture: Texture;
  pixels: CanvasPixels;
}

const images = new Map<AttachmentId, Promise<CanvasImage | undefined>>();
/** How many drawn canvases hold each image; the texture goes when the last one lets go. */
const holders = new Map<AttachmentId, number>();

export const canvasPixelsStore = createStore<{ pixels: Record<string, CanvasPixels> }>()(() => ({
  pixels: {},
}));

/** The pixel size of an image the view has decoded, or `undefined` while it hasn't. */
export function canvasPixels(id: AttachmentId): CanvasPixels | undefined {
  return canvasPixelsStore.getState().pixels[id];
}

/**
 * What a picture's pixels are, for a file that was just picked: the dialog
 * needs it to propose the image's width (100 dpi, ADR-0066 §5) before the
 * view has drawn it.
 */
export function rememberCanvasPixels(id: AttachmentId, pixels: CanvasPixels): void {
  canvasPixelsStore.setState((s) => ({ pixels: { ...s.pixels, [id]: pixels } }));
}

/**
 * An image's texture for a canvas to draw with (`undefined` for a file
 * nothing can decode). Each call holds it until `releaseCanvasImage`: what a
 * drawing's effect does with the pair.
 */
export async function canvasImage(id: AttachmentId): Promise<CanvasImage | undefined> {
  holders.set(id, (holders.get(id) ?? 0) + 1);
  const image = await load(id).catch(() => undefined);
  if (!image) releaseCanvasImage(id);
  return image;
}

/**
 * A canvas is gone: the picture's GPU memory goes with the last of them (the
 * pixel size stays, so `data-canvases` keeps reading the same height while
 * the design is open).
 */
export function releaseCanvasImage(id: AttachmentId): void {
  const left = (holders.get(id) ?? 0) - 1;
  holders.set(id, Math.max(0, left));
  if (left > 0) return;
  const pending = images.get(id);
  images.delete(id);
  void pending?.then((image) => {
    image?.bitmap.close();
    image?.texture.dispose();
  });
}

/** Drops every image and its sizes: the open project changed (ADR-0061 §3). */
export function forgetCanvasImages(): void {
  for (const id of [...holders.keys()]) {
    holders.set(id, 1);
    releaseCanvasImage(id);
  }
  canvasPixelsStore.setState({ pixels: {} });
}

async function load(id: AttachmentId): Promise<CanvasImage | undefined> {
  const known = images.get(id);
  if (known) return known;
  const promise = (async () => {
    const bytes = await attachmentBytes(id);
    if (!bytes) return undefined;
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const texture = new ThreeTexture(bitmap);
    texture.colorSpace = SRGBColorSpace;
    // A reference picture is looked at at every zoom: filtered, and not
    // mipmapped (a canvas is drawn nearly flat, and the GPU has memory enough).
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const image: CanvasImage = {
      bitmap,
      texture,
      pixels: { width: bitmap.width, height: bitmap.height },
    };
    canvasPixelsStore.setState((s) => ({ pixels: { ...s.pixels, [id]: image.pixels } }));
    return image;
  })();
  images.set(id, promise);
  return promise;
}
