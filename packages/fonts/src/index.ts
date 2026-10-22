/** A bundled font ID carries its version: `family-style@n` (ADR-0058 §3). */
export type BundledFontId =
  | 'inter-regular@1'
  | 'inter-bold@1'
  | 'noto-serif-regular@1'
  | 'jetbrains-mono-regular@1'
  | 'allerta-stencil-regular@1'
  | 'fredoka-semibold@1'
  | 'arimo-regular@1'
  | 'arimo-bold@1'
  | 'archivo-narrow-regular@1'
  | 'archivo-narrow-bold@1'
  | 'sofia-sans-extra-condensed-bold@1';

export interface BundledFont {
  id: BundledFontId;
  family: string;
  style: string;
  /** Relative to this package's `fonts/` directory. */
  file: string;
}

/** Bundled fonts (ADR-0058 §3); the first is the default. File names are relative to packages/fonts/fonts/. */
export const BUNDLED_FONTS: readonly BundledFont[] = [
  { id: 'inter-regular@1', family: 'Inter', style: 'Regular', file: 'inter-regular.ttf' },
  { id: 'inter-bold@1', family: 'Inter', style: 'Bold', file: 'inter-bold.ttf' },
  {
    id: 'noto-serif-regular@1',
    family: 'Noto Serif',
    style: 'Regular',
    file: 'noto-serif-regular.ttf',
  },
  {
    id: 'jetbrains-mono-regular@1',
    family: 'JetBrains Mono',
    style: 'Regular',
    file: 'jetbrains-mono-regular.ttf',
  },
  {
    id: 'allerta-stencil-regular@1',
    family: 'Allerta Stencil',
    style: 'Regular',
    file: 'allerta-stencil-regular.ttf',
  },
  { id: 'fredoka-semibold@1', family: 'Fredoka', style: 'SemiBold', file: 'fredoka-semibold.ttf' },
  { id: 'arimo-regular@1', family: 'Arimo', style: 'Regular', file: 'arimo-regular.ttf' },
  { id: 'arimo-bold@1', family: 'Arimo', style: 'Bold', file: 'arimo-bold.ttf' },
  {
    id: 'archivo-narrow-regular@1',
    family: 'Archivo Narrow',
    style: 'Regular',
    file: 'archivo-narrow-regular.ttf',
  },
  {
    id: 'archivo-narrow-bold@1',
    family: 'Archivo Narrow',
    style: 'Bold',
    file: 'archivo-narrow-bold.ttf',
  },
  {
    id: 'sofia-sans-extra-condensed-bold@1',
    family: 'Sofia Sans Extra Condensed',
    style: 'Bold',
    file: 'sofia-sans-extra-condensed-bold.ttf',
  },
];

export const DEFAULT_FONT: BundledFontId = 'inter-regular@1';
