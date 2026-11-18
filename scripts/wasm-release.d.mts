export const PINS: string;
export type Pins = Record<string, { tag: string; sha256: string }>;
export function sha256(bytes: Uint8Array): string;
export function readPins(path?: string): Pins;
export function writePins(pins: Pins, path?: string): void;
export function pinFor(pins: Record<string, unknown>, name: string, tag: string): string;
export class DigestMismatch extends Error {}
export function checkDigest(bytes: Uint8Array, expected: string, file: string): void;
export function writeManifest(dist: string): void;
export function checkManifest(dist: string): boolean;
export function releaseDigest(
  tag: string,
  name: string,
  hasGh: boolean,
): Promise<string | undefined>;
export function filesIn(dir: string): string[];
export function run(cmd: string, args: string[], options?: object): void;
export function wasmRelease(spec: object): Promise<void>;
