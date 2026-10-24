import type { RenderJob, RenderProgress } from '@extrudo/web/platform/render';
import { describe, expect, it } from 'vitest';
import {
  type BlenderEnv,
  blenderStatus,
  blenderVersion,
  cleanupRenderFiles,
  FLATPAK_ID,
  findBlender,
  isSupported,
  jobFile,
  launchCommand,
  MAX_OBJ_CHARS,
  progressOf,
  RENDER_PREFIX,
  type RenderProcess,
  type RenderSignal,
  renderInBlender,
} from './blender';
import renderScript from './renderScript';

interface FakeProcess extends RenderProcess {
  stdout(text: string): void;
  stderr(text: string): void;
  emit(event: 'error' | 'exit', value?: Error | number | null): void;
  killed: boolean;
}

function fakeProcess(): FakeProcess {
  const listeners: Record<string, ((value: never) => void)[]> = {};
  const out: ((chunk: string) => void)[] = [];
  const err: ((chunk: string) => void)[] = [];
  return {
    onStdout: (listener) => void out.push(listener),
    onStderr: (listener) => void err.push(listener),
    on(event: string, listener: (value: never) => void) {
      listeners[event] = [...(listeners[event] ?? []), listener];
      return undefined;
    },
    stdout: (text) => {
      for (const l of out) l(text);
    },
    stderr: (text) => {
      for (const l of err) l(text);
    },
    emit(event, value) {
      for (const listener of listeners[event] ?? []) listener(value as never);
    },
    killed: false,
    kill() {
      this.killed = true;
    },
  };
}

interface Fake {
  env: BlenderEnv;
  files: Map<string, string>;
  dirs: string[];
  removed: string[];
  spawned: { command: string; args: string[]; cwd: string; process: FakeProcess }[];
  ran: { command: string; args: string[] }[];
}

function fake(
  over: Partial<BlenderEnv> & {
    present?: string[];
    dirsOf?: Record<string, string[]>;
    png?: Uint8Array;
    version?: string;
  } = {},
): Fake {
  const { present = [], dirsOf = {}, png, version = 'Blender 5.2.2 LTS\n', ...rest } = over;
  const state: Fake = {
    files: new Map(),
    dirs: [],
    removed: [],
    spawned: [],
    ran: [],
    env: undefined as never,
  };
  state.env = {
    platform: 'linux',
    env: {},
    homeDir: '/home/me',
    exists: (path) => present.includes(path),
    glob: (dir, prefix) => (dirsOf[dir] ?? []).filter((name) => name.startsWith(prefix)),
    which: () => undefined,
    flatpakInfo: () => false,
    run(command, args) {
      state.ran.push({ command, args });
      return { code: 0, output: version };
    },
    spawn(command, args, cwd) {
      const process = fakeProcess();
      state.spawned.push({ command, args, cwd, process });
      return process;
    },
    tempDir: '/tmp',
    override: undefined,
    prepareDir: (dir) => void state.dirs.push(dir),
    writeFile: (path, text) => void state.files.set(path, text),
    readFile: (path) => (path.endsWith('/out.png') ? png : undefined),
    removeDir: (dir) => void state.removed.push(dir),
    ...rest,
  };
  return state;
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const EXE = { path: '/usr/bin/blender', launcher: 'exe' as const };

const JOB: RenderJob = {
  project: 'Pen holder',
  obj: 'o Body1\nv 0 0 0\n',
  mtl: 'newmtl m0\n',
  objects: [{ name: 'Body1', finish: 'glossy', color: '#3b82f6' }],
  preset: 'table',
  width: 320,
  height: 180,
  quality: 'draft',
};

describe('findBlender', () => {
  it('takes the override first, a flatpak ID or a path', () => {
    const f = fake({ override: FLATPAK_ID, flatpakInfo: (id) => id === FLATPAK_ID });
    expect(findBlender(f.env)).toEqual({ path: FLATPAK_ID, launcher: 'flatpak' });
    const g = fake({ override: '/opt/blender/blender', present: ['/opt/blender/blender'] });
    expect(findBlender(g.env)).toEqual({ path: '/opt/blender/blender', launcher: 'exe' });
    // A path that isn't there falls through to detection.
    const h = fake({ override: '/nowhere/blender', which: () => '/usr/bin/blender' });
    expect(findBlender(h.env)).toEqual(EXE);
  });

  it('turns a macOS .app override into its program', () => {
    const f = fake({
      platform: 'darwin',
      override: '/Applications/Blender 5.app',
      present: ['/Applications/Blender 5.app'],
    });
    expect(findBlender(f.env)?.path).toBe('/Applications/Blender 5.app/Contents/MacOS/Blender');
  });

  it('finds PATH, the flatpak, snap and Steam on Linux, in that order', () => {
    expect(
      findBlender(fake({ which: (n) => (n === 'blender' ? '/usr/bin/blender' : undefined) }).env),
    ).toEqual(EXE);
    expect(findBlender(fake({ flatpakInfo: () => true }).env)).toEqual({
      path: FLATPAK_ID,
      launcher: 'flatpak',
    });
    expect(findBlender(fake({ present: ['/snap/bin/blender'] }).env)?.path).toBe(
      '/snap/bin/blender',
    );
    expect(
      findBlender(
        fake({ present: ['/home/me/.local/share/Steam/steamapps/common/Blender/blender'] }).env,
      )?.path,
    ).toBe('/home/me/.local/share/Steam/steamapps/common/Blender/blender');
    expect(findBlender(fake().env)).toBeUndefined();
  });

  it('takes the newest Blender Foundation folder on Windows', () => {
    const root = 'C:\\Program Files\\Blender Foundation';
    const f = fake({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files' },
      dirsOf: { [root]: ['Blender 4.2', 'Blender 5.2', 'Blender 4.5'] },
      present: [`${root}\\Blender 4.2\\blender.exe`, `${root}\\Blender 5.2\\blender.exe`],
    });
    expect(findBlender(f.env)?.path).toBe(`${root}\\Blender 5.2\\blender.exe`);
  });

  it('looks in /Applications and Steam on macOS', () => {
    const steam =
      '/home/me/Library/Application Support/Steam/steamapps/common/Blender/Blender.app/Contents/MacOS/Blender';
    expect(findBlender(fake({ platform: 'darwin', present: [steam] }).env)?.path).toBe(steam);
    expect(findBlender(fake({ platform: 'darwin' }).env)).toBeUndefined();
  });
});

describe('the version gate', () => {
  it('parses blender --version and grants the job directory to a flatpak', () => {
    const f = fake({ version: 'Blender 4.2.3 LTS\n\tbuild date: 2024-08-19\n' });
    expect(blenderVersion(f.env, EXE)).toBe('4.2');
    expect(f.ran).toEqual([{ command: '/usr/bin/blender', args: ['--version'] }]);
    expect(blenderVersion(fake({ version: 'Blender 5.2.2 LTS\n' }).env, EXE)).toBe('5.2');
    expect(
      blenderVersion(fake({ version: 'bash: blender: not found\n' }).env, EXE),
    ).toBeUndefined();
    expect(
      blenderVersion(fake({ run: () => ({ code: 1, output: 'Blender 5.2.2' }) }).env, EXE),
    ).toBeUndefined();
    expect(launchCommand({ path: FLATPAK_ID, launcher: 'flatpak' }, ['--version'])).toEqual([
      'flatpak',
      ['run', FLATPAK_ID, '--version'],
    ]);
    expect(launchCommand({ path: FLATPAK_ID, launcher: 'flatpak' }, ['-b'], '/tmp/x')).toEqual([
      'flatpak',
      ['run', '--filesystem=/tmp/x', FLATPAK_ID, '-b'],
    ]);
  });

  it('compares versions as numbers', () => {
    expect(isSupported('4.1')).toBe(false);
    expect(isSupported('4.2')).toBe(true);
    expect(isSupported('4.10')).toBe(true);
    expect(isSupported('5.2')).toBe(true);
    expect(isSupported('3.6')).toBe(false);
  });

  it('composes the status', () => {
    expect(blenderStatus(fake().env)).toEqual({ state: 'missing' });
    const which = () => '/usr/bin/blender';
    expect(blenderStatus(fake({ which, version: 'Blender 4.1.1\n' }).env)).toEqual({
      state: 'too-old',
      version: '4.1',
      path: '/usr/bin/blender',
    });
    expect(blenderStatus(fake({ which, version: 'Blender 4.2.0\n' }).env)).toEqual({
      state: 'found',
      version: '4.2',
      path: '/usr/bin/blender',
    });
    expect(blenderStatus(fake({ which, version: 'garbage' }).env)).toEqual({ state: 'missing' });
  });
});

describe('progressOf', () => {
  it("maps the script's phases and Blender's sample counts", () => {
    expect(progressOf('EXTRUDO importing')).toEqual({ fraction: 0.05, phase: 'importing' });
    expect(progressOf('EXTRUDO scene')).toEqual({ fraction: 0.08, phase: 'importing' });
    expect(progressOf('EXTRUDO rendering')).toEqual({ fraction: 0.1, phase: 'rendering' });
    expect(progressOf('EXTRUDO saving')).toEqual({ fraction: 0.97, phase: 'saving' });
    expect(progressOf('Fra:1 Mem:12.00M | Time:00:00.10 | Sample 64/128')).toEqual({
      fraction: 0.1 + 0.85 * 0.5,
      phase: 'rendering',
    });
    expect(progressOf('Fra:1 | Rendering 8 / 16 samples')?.fraction).toBeCloseTo(0.525);
    expect(progressOf('Fra:1 | Sample 128/128')?.fraction).toBe(0.95);
    expect(
      progressOf(
        '00:01.378  render           | Fra: 1 | Remaining: 00:12.30 | Mem: 83M | Sample 1/128',
      )?.fraction,
    ).toBeCloseTo(0.1066);
    expect(progressOf('00:09.604  render           | Fra: 1 | Mem: 83M | Finished')).toEqual({
      fraction: 0.97,
      phase: 'saving',
    });
    expect(progressOf("00:09.777  render           | Saved: '/tmp/x/out1.png'")?.phase).toBe(
      'saving',
    );
    expect(progressOf('EXTRUDO note cycles on CPU')).toBeUndefined();
    expect(progressOf('Blender 5.2.2 LTS')).toBeUndefined();
  });
});

describe('renderInBlender', () => {
  const start = (f: Fake, job = JOB, signal: RenderSignal = { cancelled: false }) => {
    const seen: RenderProgress[] = [];
    let time = 0;
    const promise = renderInBlender(
      f.env,
      EXE,
      job,
      (p) => seen.push(p),
      signal,
      () => (time += 1000),
    );
    const process = f.spawned[0]?.process as FakeProcess;
    return { promise, seen, process, signal };
  };

  it('writes the job directory, runs Blender in it and returns the PNG', async () => {
    const f = fake({ png: PNG });
    const { promise, seen, process } = start(f);
    const dir = f.dirs[0] as string;
    expect(dir).toMatch(/^\/tmp\/extrudo-render-[0-9a-f]{8}$/);
    expect([...f.files.keys()].map((p) => p.slice(dir.length + 1)).sort()).toEqual([
      'job.json',
      'model.mtl',
      'model.obj',
      'render.py',
    ]);
    expect(f.files.get(`${dir}/model.obj`)).toBe(JOB.obj);
    expect(f.files.get(`${dir}/render.py`)).toBe(renderScript);
    expect(JSON.parse(f.files.get(`${dir}/job.json`) as string)).toEqual({
      project: 'Pen holder',
      obj: 'model.obj',
      objects: JOB.objects,
      preset: 'table',
      camera: null,
      width: 320,
      height: 180,
      quality: 'draft',
    });
    expect(f.spawned[0]).toMatchObject({
      command: '/usr/bin/blender',
      args: [
        '-b',
        '--factory-startup',
        '-noaudio',
        '--python',
        `${dir}/render.py`,
        '--',
        'job.json',
        'out.png',
      ],
      cwd: dir,
    });
    process.stdout('Blender 5.2.2 LTS\nEXTRUDO importing\nEXTRUDO scene\nEXTRUDO rend');
    process.stdout(
      'ering\nFra:1 | Sample 32/64\nFra:1 | Sample 64/64\nEXTRUDO saving\nEXTRUDO done\n',
    );
    process.emit('exit', 0);
    const result = await promise;
    expect(result).toEqual({ ok: true, png: PNG });
    expect(seen.map((p) => [p.phase, Number(p.fraction.toFixed(3))])).toEqual([
      ['starting', 0],
      ['importing', 0.05],
      ['importing', 0.08],
      ['rendering', 0.1],
      ['rendering', 0.525],
      ['rendering', 0.95],
      ['saving', 0.97],
    ]);
    expect(f.removed).toEqual([dir]);
  });

  it('lets Blender render the slow qualities itself and reads its numbered frame', async () => {
    const f = fake({ readFile: (p) => (p.endsWith('/out1.png') ? PNG : undefined) });
    const { promise, process } = start(f, { ...JOB, quality: 'standard' });
    expect(f.spawned[0]?.args).toContain('-f');
    expect(f.spawned[0]?.args.slice(-5)).toEqual(['-f', '1', '--', 'job.json', 'out.png']);
    process.emit('exit', 0);
    expect(await promise).toEqual({ ok: true, png: PNG });
  });

  it('keeps a camera in job.json and the script renders it', () => {
    const camera = {
      projection: 'perspective' as const,
      position: [100, -100, 100] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
      up: [0, 0, 1] as [number, number, number],
    };
    expect(jobFile({ ...JOB, camera }).camera).toEqual(camera);
  });

  it("reports the script's error line, else stderr, else the exit code", async () => {
    const a = start(fake());
    a.process.stdout('EXTRUDO importing\nEXTRUDO ERROR Unknown preset "x".\n');
    a.process.stderr('Traceback (most recent call last):\n  File "render.py"\n');
    a.process.emit('exit', 2);
    expect(await a.promise).toEqual({ ok: false, message: 'Unknown preset "x".' });

    // (Slow qualities: a crashed draft is tried again, below.)
    const slow = { ...JOB, quality: 'standard' as const };
    const b = start(fake(), slow);
    b.process.stderr('Segmentation fault\n');
    b.process.emit('exit', 139);
    expect(await b.promise).toEqual({ ok: false, message: 'Segmentation fault' });

    const c = start(fake(), slow);
    c.process.emit('exit', 1);
    expect(await c.promise).toEqual({ ok: false, message: 'Blender exited with code 1.' });

    // Blender's own crash handler (Windows): say it crashed, not "Thread : 1bc4".
    const e = start(fake(), slow);
    e.process.stderr('Error   : EXCEPTION_ACCESS_VIOLATION\nAddress : 0x1\nThread  : 00001bc4\n');
    e.process.emit('exit', 3221225477);
    expect(await e.promise).toEqual({
      ok: false,
      message: 'Blender crashed (exit code 3221225477).',
    });

    // Exit 0 but no picture: say so rather than hand out nothing.
    const d = start(fake());
    d.process.emit('exit', 0);
    expect(await d.promise).toMatchObject({
      ok: false,
      message: expect.stringContaining('without writing'),
    });
  });

  it('renders a draft again with Cycles when Blender crashed', async () => {
    const f = fake({ png: PNG });
    const a = start(f);
    a.process.stdout('EXTRUDO importing\nEXTRUDO scene\nEXTRUDO rendering\n');
    a.process.stderr('Thread  : 00001bc4\n');
    a.process.emit('exit', 3221225477);
    await Promise.resolve();
    const second = f.spawned[1]?.process as FakeProcess;
    expect(second).toBeTruthy();
    const dir = f.dirs[0] as string;
    expect(JSON.parse(f.files.get(`${dir}/job.json`) as string)).toMatchObject({ eevee: false });
    second.stdout('EXTRUDO note eevee skipped; using Cycles\nEXTRUDO rendering\nEXTRUDO done\n');
    second.emit('exit', 0);
    expect(await a.promise).toEqual({ ok: true, png: PNG });
    expect(a.seen.map((p) => p.phase)).toContain('starting');

    // Not for the script's own errors, not for the slow qualities, not when cancelled.
    const g = fake();
    const b = start(g);
    b.process.stdout('EXTRUDO ERROR Unknown preset "x".\n');
    b.process.emit('exit', 2);
    expect(await b.promise).toMatchObject({ ok: false });
    expect(g.spawned).toHaveLength(1);
    const h = fake();
    const c = start(h, { ...JOB, quality: 'high' });
    c.process.emit('exit', 1);
    await c.promise;
    expect(h.spawned).toHaveLength(1);
  });

  it('is cancelled by the signal and reports it', async () => {
    const f = fake({ png: PNG });
    const { promise, process, signal } = start(f);
    expect(signal.process).toBe(process);
    signal.cancelled = true;
    signal.process?.kill();
    expect(process.killed).toBe(true);
    process.emit('exit', null);
    expect(await promise).toEqual({ ok: false, cancelled: true, message: 'Render cancelled.' });
    expect(signal.process).toBeUndefined();
    expect(f.removed).toHaveLength(1);
  });

  it("says it couldn't start Blender on ENOENT, and removes the directory", async () => {
    const a = start(fake());
    a.process.emit('error', new Error('spawn ENOENT'));
    expect(await a.promise).toEqual({ ok: false, message: "Couldn't start Blender." });
    const thrown = fake({
      spawn: () => {
        throw new Error('EACCES');
      },
    });
    expect(await renderInBlender(thrown.env, EXE, JOB, () => {}, { cancelled: false })).toEqual({
      ok: false,
      message: "Couldn't start Blender.",
    });
    expect(thrown.removed).toHaveLength(1);
  });

  it('refuses an OBJ over the cap and a directory that is not ours', async () => {
    const huge = { ...JOB, obj: 'x'.repeat(MAX_OBJ_CHARS + 1) };
    const f = fake();
    expect(await renderInBlender(f.env, EXE, huge, () => {}, { cancelled: false })).toEqual({
      ok: false,
      message: 'The model is too large to render.',
    });
    expect(f.spawned).toEqual([]);
    const g = fake({
      prepareDir: () => {
        throw new Error('The render directory is not ours.');
      },
    });
    expect(await renderInBlender(g.env, EXE, JOB, () => {}, { cancelled: false })).toEqual({
      ok: false,
      message: "Couldn't render: The render directory is not ours.",
    });
  });

  it('throttles sample progress to the interval but passes phase changes through', async () => {
    const f = fake({ png: PNG });
    const seen: RenderProgress[] = [];
    let time = 0;
    const promise = renderInBlender(
      f.env,
      EXE,
      JOB,
      (p) => seen.push(p),
      { cancelled: false },
      () => time,
    );
    const process = f.spawned[0]?.process as FakeProcess;
    process.stdout('EXTRUDO rendering\n');
    time = 50;
    process.stdout('Fra:1 | Sample 1/100\n');
    time = 90;
    process.stdout('Fra:1 | Sample 2/100\n');
    time = 200;
    process.stdout('Fra:1 | Sample 3/100\n');
    process.stdout('EXTRUDO saving\n');
    process.emit('exit', 0);
    await promise;
    expect(seen.map((p) => Number(p.fraction.toFixed(4)))).toEqual([0, 0.1, 0.1255, 0.97]);
  });

  it('cleanupRenderFiles removes every job directory left in temp', () => {
    const f = fake({
      dirsOf: { '/tmp': ['extrudo-render-0a1b2c3d', 'extrudo-slicer', `${RENDER_PREFIX}ffffffff`] },
    });
    cleanupRenderFiles(f.env);
    expect(f.removed).toEqual(['/tmp/extrudo-render-0a1b2c3d', '/tmp/extrudo-render-ffffffff']);
    const win = fake({
      platform: 'win32',
      tempDir: 'C:\\Temp',
      dirsOf: { 'C:\\Temp': ['extrudo-render-01234567'] },
    });
    cleanupRenderFiles(win.env);
    expect(win.removed).toEqual(['C:\\Temp\\extrudo-render-01234567']);
  });
});

describe('the bundled script', () => {
  it('is the Python file, with its contract and phases', () => {
    expect(renderScript).toContain('bpy.ops.wm.obj_import');
    for (const phase of ['importing', 'scene', 'rendering', 'saving', 'done']) {
      expect(renderScript).toContain(`log("${phase}")`);
    }
    expect(renderScript).toContain('sys.exit(2)');
  });
});
