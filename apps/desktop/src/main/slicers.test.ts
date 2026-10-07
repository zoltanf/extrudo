import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupSlicerFiles,
  findSlicers,
  isSlicerFile,
  isSlicerId,
  LAUNCH_WINDOW_MS,
  MAX_SLICER_BYTES,
  nodeSlicerEnv,
  openInSlicer,
  type SlicerEnv,
  type SpawnedProcess,
  sanitizeFileName,
} from './slicers';

interface FakeProcess {
  on: SpawnedProcess['on'];
  emit(event: 'error' | 'exit', value?: Error | number | null): void;
  unref: ReturnType<typeof vi.fn>;
}

function fakeProcess(): FakeProcess {
  const listeners: Record<string, ((value: never) => void)[]> = {};
  return {
    on(event: string, listener: (value: never) => void) {
      listeners[event] = [...(listeners[event] ?? []), listener];
      return undefined;
    },
    emit(event, value) {
      for (const listener of listeners[event] ?? []) listener(value as never);
    },
    unref: vi.fn(),
  } as FakeProcess;
}

interface Fake {
  env: SlicerEnv;
  files: Map<string, Uint8Array>;
  dirs: string[];
  removed: string[];
  spawned: { command: string; args: string[]; process: FakeProcess }[];
}

function fake(
  over: Partial<SlicerEnv> & { present?: string[]; dirsOf?: Record<string, string[]> } = {},
): Fake {
  const { present = [], dirsOf = {}, ...rest } = over;
  const state: Fake = {
    files: new Map(),
    dirs: [],
    removed: [],
    spawned: [],
    env: undefined as never,
  };
  state.env = {
    platform: 'linux',
    env: {},
    exists: (path) => present.includes(path),
    glob: (dir, prefix) => (dirsOf[dir] ?? []).filter((name) => name.startsWith(prefix)),
    which: () => undefined,
    flatpakInfo: () => false,
    spawn(command, args) {
      const process = fakeProcess();
      state.spawned.push({ command, args, process });
      return process as unknown as SpawnedProcess;
    },
    tempDir: '/tmp',
    overrides: {},
    prepareDir: (dir) => void state.dirs.push(dir),
    writeFile: (path, bytes) => void state.files.set(path, bytes),
    removeDir: (dir) => void state.removed.push(dir),
    ...rest,
  };
  return state;
}

const FILE = { name: 'Bracket.3mf', bytes: Uint8Array.from([1, 2, 3]), format: '3mf' as const };

describe('finding slicers (P6-02)', () => {
  it('Linux: PATH first, then flatpaks, one entry per slicer, in the dialog order', () => {
    const { env } = fake({
      which: (name) =>
        name === 'orca-slicer' || name === 'UltiMaker-Cura' ? `/usr/bin/${name}` : undefined,
      flatpakInfo: (id) =>
        id === 'com.prusa3d.PrusaSlicer' || id === 'io.github.softfever.OrcaSlicer',
    });
    expect(findSlicers(env)).toEqual([
      { id: 'prusaslicer', path: 'com.prusa3d.PrusaSlicer', launcher: 'flatpak' },
      { id: 'orcaslicer', path: '/usr/bin/orca-slicer', launcher: 'exe' },
      { id: 'cura', path: '/usr/bin/UltiMaker-Cura', launcher: 'exe' },
    ]);
  });

  it('Linux: every PATH name and every flatpak ID is looked for', () => {
    const asked: string[] = [];
    const env = fake({
      which: (name) => {
        asked.push(name);
        return undefined;
      },
      flatpakInfo: (id) => {
        asked.push(id);
        return false;
      },
    }).env;
    findSlicers(env);
    expect(asked).toEqual([
      'prusa-slicer',
      'orca-slicer',
      'bambu-studio',
      'cura',
      'UltiMaker-Cura',
      'com.prusa3d.PrusaSlicer',
      'io.github.softfever.OrcaSlicer',
      'com.bambulab.BambuStudio',
      'com.ultimaker.cura',
    ]);
  });

  it('nothing installed finds nothing', () => {
    for (const platform of ['linux', 'win32', 'darwin'] as const) {
      expect(findSlicers(fake({ platform }).env)).toEqual([]);
    }
  });

  it('Windows: Program Files and the per-user Programs folder, the newest Cura winning', () => {
    const pf = 'C:\\Program Files';
    const local = 'C:\\Users\\a\\AppData\\Local';
    const { env } = fake({
      platform: 'win32',
      env: { ProgramFiles: pf, LOCALAPPDATA: local },
      present: [
        `${pf}\\Prusa3D\\PrusaSlicer\\prusa-slicer.exe`,
        `${local}\\Programs\\OrcaSlicer\\orca-slicer.exe`,
        `${pf}\\Bambu Studio\\bambu-studio.exe`,
        `${pf}\\UltiMaker Cura 5.10.1\\UltiMaker-Cura.exe`,
        `${pf}\\UltiMaker Cura 5.9.0\\UltiMaker-Cura.exe`,
      ],
      dirsOf: { [pf]: ['UltiMaker Cura 5.9.0', 'UltiMaker Cura 5.10.1', 'Other'] },
    });
    expect(findSlicers(env)).toEqual([
      { id: 'prusaslicer', path: `${pf}\\Prusa3D\\PrusaSlicer\\prusa-slicer.exe`, launcher: 'exe' },
      {
        id: 'orcaslicer',
        path: `${local}\\Programs\\OrcaSlicer\\orca-slicer.exe`,
        launcher: 'exe',
      },
      { id: 'bambustudio', path: `${pf}\\Bambu Studio\\bambu-studio.exe`, launcher: 'exe' },
      { id: 'cura', path: `${pf}\\UltiMaker Cura 5.10.1\\UltiMaker-Cura.exe`, launcher: 'exe' },
    ]);
  });

  it('macOS: the four app bundles, launched with open', () => {
    const { env } = fake({
      platform: 'darwin',
      present: [
        '/Applications/PrusaSlicer.app',
        '/Applications/UltiMaker Cura.app',
        '/Applications/BambuStudio.app',
      ],
    });
    expect(findSlicers(env)).toEqual([
      { id: 'prusaslicer', path: '/Applications/PrusaSlicer.app', launcher: 'open' },
      { id: 'bambustudio', path: '/Applications/BambuStudio.app', launcher: 'open' },
      { id: 'cura', path: '/Applications/UltiMaker Cura.app', launcher: 'open' },
    ]);
  });

  it('an override wins over detection and counts when its path exists', () => {
    const { env } = fake({
      which: (name) => (name === 'prusa-slicer' ? '/usr/bin/prusa-slicer' : undefined),
      present: ['/opt/orca/orca', '/Applications/Custom.app'],
      overrides: {
        prusaslicer: '/opt/prusa/missing',
        orcaslicer: '/opt/orca/orca',
        bambustudio: '',
      },
    });
    expect(findSlicers(env)).toEqual([
      { id: 'prusaslicer', path: '/usr/bin/prusa-slicer', launcher: 'exe' },
      { id: 'orcaslicer', path: '/opt/orca/orca', launcher: 'exe' },
    ]);
    const mac = fake({
      platform: 'darwin',
      present: ['/Applications/Custom.app'],
      overrides: { cura: '/Applications/Custom.app' },
    });
    expect(findSlicers(mac.env)).toEqual([
      { id: 'cura', path: '/Applications/Custom.app', launcher: 'open' },
    ]);
    const over = fake({
      present: ['/opt/prusa/p'],
      which: () => '/usr/bin/x',
      overrides: { prusaslicer: '/opt/prusa/p' },
    });
    expect(findSlicers(over.env)[0]).toEqual({
      id: 'prusaslicer',
      path: '/opt/prusa/p',
      launcher: 'exe',
    });
  });
});

describe('the temp file name (P6-02)', () => {
  it('is a basename with the format’s extension', () => {
    expect(sanitizeFileName('../../etc/passwd', 'stl')).toBe('passwd.stl');
    expect(sanitizeFileName('C:\\Users\\a\\Bracket.3mf', '3mf')).toBe('Bracket.3mf');
    expect(sanitizeFileName('.hidden', 'stl')).toBe('hidden.stl');
    expect(sanitizeFileName('Bracket.stl', '3mf')).toBe('Bracket.3mf');
    expect(sanitizeFileName('Part v1.2', 'step')).toBe('Part v1.2.step');
    expect(sanitizeFileName('a:b*c?.3mf', '3mf')).toBe('a_b_c_.3mf');
    expect(sanitizeFileName('', 'stl')).toBe('model.stl');
    expect(sanitizeFileName('...', 'stl')).toBe('model.stl');
    expect(sanitizeFileName('x'.repeat(300), 'stl')).toHaveLength(124);
  });

  it('validates what crossed the bridge', () => {
    expect(isSlicerFile(FILE)).toBe(true);
    expect(isSlicerFile({ ...FILE, format: 'obj' })).toBe(false);
    expect(isSlicerFile({ ...FILE, bytes: [1] })).toBe(false);
    expect(isSlicerFile(null)).toBe(false);
    expect(isSlicerId('cura')).toBe(true);
    expect(isSlicerId('slic3r')).toBe(false);
  });
});

describe('launching (P6-02)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const exe = [
    { id: 'prusaslicer' as const, path: '/usr/bin/prusa-slicer', launcher: 'exe' as const },
  ];

  it('writes the file under extrudo-slicer and starts the program: true after the window', async () => {
    const f = fake();
    const result = openInSlicer(f.env, exe, { ...FILE, name: '../Bracket.stl' }, 'prusaslicer');
    await vi.advanceTimersByTimeAsync(LAUNCH_WINDOW_MS);
    expect(await result).toBe(true);
    expect(f.dirs).toEqual(['/tmp/extrudo-slicer']);
    expect([...f.files.keys()]).toEqual(['/tmp/extrudo-slicer/Bracket.3mf']);
    expect(f.spawned[0]).toMatchObject({
      command: '/usr/bin/prusa-slicer',
      args: ['/tmp/extrudo-slicer/Bracket.3mf'],
    });
    expect(f.spawned[0]?.process.unref).toHaveBeenCalled();
  });

  it('macOS uses open -a, flatpak forwards the file', async () => {
    const mac = fake({ platform: 'darwin' });
    const a = openInSlicer(
      mac.env,
      [{ id: 'cura', path: '/Applications/UltiMaker Cura.app', launcher: 'open' }],
      FILE,
      'cura',
    );
    mac.spawned[0]?.process.emit('exit', 0);
    expect(await a).toBe(true);
    expect(mac.spawned[0]).toMatchObject({
      command: 'open',
      args: ['-a', '/Applications/UltiMaker Cura.app', '/tmp/extrudo-slicer/Bracket.3mf'],
    });

    const fp = fake();
    const b = openInSlicer(
      fp.env,
      [{ id: 'orcaslicer', path: 'io.github.softfever.OrcaSlicer', launcher: 'flatpak' }],
      FILE,
      'orcaslicer',
    );
    await vi.advanceTimersByTimeAsync(LAUNCH_WINDOW_MS);
    await b;
    expect(fp.spawned[0]).toMatchObject({
      command: 'flatpak',
      args: [
        'run',
        '--file-forwarding',
        'io.github.softfever.OrcaSlicer',
        '@@',
        '/tmp/extrudo-slicer/Bracket.3mf',
        '@@',
      ],
    });
  });

  it('Windows paths are joined with backslashes', async () => {
    const f = fake({ platform: 'win32', tempDir: 'C:\\Temp' });
    const result = openInSlicer(
      f.env,
      [{ id: 'prusaslicer', path: 'C:\\p.exe', launcher: 'exe' }],
      FILE,
      'prusaslicer',
    );
    await vi.advanceTimersByTimeAsync(LAUNCH_WINDOW_MS);
    await result;
    expect([...f.files.keys()]).toEqual(['C:\\Temp\\extrudo-slicer\\Bracket.3mf']);
  });

  it('ENOENT is false', async () => {
    const f = fake();
    const result = openInSlicer(f.env, exe, FILE, 'prusaslicer');
    await vi.advanceTimersByTimeAsync(0);
    f.spawned[0]?.process.emit('error', new Error('spawn ENOENT'));
    expect(await result).toBe(false);
  });

  it('a non-zero exit inside the window is false', async () => {
    const f = fake();
    const result = openInSlicer(f.env, exe, FILE, 'prusaslicer');
    await vi.advanceTimersByTimeAsync(500);
    f.spawned[0]?.process.emit('exit', 1);
    expect(await result).toBe(false);
  });

  it('a throwing spawn, a throwing write, an unknown slicer and a huge file are false', async () => {
    const thrown = fake({
      spawn: () => {
        throw new Error('boom');
      },
    });
    expect(await openInSlicer(thrown.env, exe, FILE, 'prusaslicer')).toBe(false);
    const writes = fake({
      writeFile: () => {
        throw new Error('disk full');
      },
    });
    expect(await openInSlicer(writes.env, exe, FILE, 'prusaslicer')).toBe(false);
    const f = fake();
    expect(await openInSlicer(f.env, exe, FILE, 'cura')).toBe(false);
    const huge = { ...FILE, bytes: { byteLength: MAX_SLICER_BYTES + 1 } as Uint8Array };
    expect(await openInSlicer(f.env, exe, huge, 'prusaslicer')).toBe(false);
    expect(f.files.size).toBe(0);
    expect(f.spawned).toHaveLength(0);
  });

  it('the quit cleanup removes the directory and swallows errors', () => {
    const f = fake();
    cleanupSlicerFiles(f.env);
    expect(f.removed).toEqual(['/tmp/extrudo-slicer']);
    expect(() =>
      cleanupSlicerFiles(
        fake({
          removeDir: () => {
            throw new Error('busy');
          },
        }).env,
      ),
    ).not.toThrow();
  });
});

describe('the real environment (P6-02)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'extrudo-slicers-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a private directory and file, overwrites, and cleans up', () => {
    const env = nodeSlicerEnv(dir, {});
    const target = join(dir, 'extrudo-slicer');
    env.prepareDir(target);
    env.writeFile(join(target, 'a.stl'), Uint8Array.from([1]));
    env.writeFile(join(target, 'a.stl'), Uint8Array.from([2, 3]));
    expect([...readFileSync(join(target, 'a.stl'))]).toEqual([2, 3]);
    if (process.platform !== 'win32') expect(statSync(target).mode & 0o777).toBe(0o700);
    cleanupSlicerFiles(env);
    expect(() => statSync(target)).toThrow();
  });

  it.skipIf(process.platform === 'win32')('refuses a directory that is a planted symlink', () => {
    const env = nodeSlicerEnv(dir, {});
    symlinkSync(tmpdir(), join(dir, 'extrudo-slicer'));
    expect(() => env.prepareDir(join(dir, 'extrudo-slicer'))).toThrow();
  });
});
