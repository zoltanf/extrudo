export function sha256Digest(bytes: Uint8Array): string;
export function checkDigest(bytes: Uint8Array, expected: unknown, name: string): void;
export function releaseDigest(
  tag: string,
  name: string,
  hasGh: boolean,
): Promise<string | undefined>;
export function filesIn(dir: string): string[];
export function run(cmd: string, args: string[], options?: object): void;
export function wasmRelease(spec: object): Promise<void>;
