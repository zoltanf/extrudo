import { describe, expect, it, vi } from 'vitest';
import {
  CADMPEG_DIR,
  type CadmpegEnv,
  type ConvertProcess,
  cadmpegStatus,
  cleanupCadmpegFiles,
  convertWithCadmpeg,
  findCadmpeg,
  MAX_INPUT_BYTES,
  MAX_LOG_BYTES,
  MAX_OUTPUT_BYTES,
  NOT_AVAILABLE,
  noSolidMessage,
  safeInputName,
  stepHasSolid,
} from './cadmpeg';

interface FakeProcess extends ConvertProcess {
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
  env: CadmpegEnv;
  files: Map<string, Uint8Array>;
  dirs: string[];
  removed: string[];
  spawned: { command: string; args: string[]; cwd: string; process: FakeProcess }[];
}

/**
 * A fake environment; `script` plays the spawned cadmpeg (lines, the output
 * through the fake file system, an exit), or leaves it running.
 */
function fake(
  over: Partial<CadmpegEnv> & {
    present?: string[];
    script?: (process: FakeProcess, files: Map<string, Uint8Array>, cwd: string) => void;
  } = {},
): Fake {
  const { present = ['/opt/cadmpeg'], script, ...rest } = over;
  const state: Fake = {
    files: new Map(),
    dirs: [],
    removed: [],
    spawned: [],
    env: undefined as never,
  };
  state.env = {
    platform: 'linux',
    exists: (path) => present.includes(path),
    which: () => undefined,
    run: () => ({ code: 0, output: 'cadmpeg 0.6.7\n' }),
    spawn(command, args, cwd) {
      const process = fakeProcess();
      state.spawned.push({ command, args, cwd, process });
      if (script) queueMicrotask(() => script(process, state.files, cwd));
      return process;
    },
    tempDir: '/tmp',
    resourcesPath: undefined,
    devVendorDir: undefined,
    override: '/opt/cadmpeg',
    prepareDir: (dir) => void state.dirs.push(dir),
    writeFile: (path, bytes) => void state.files.set(path, bytes),
    readFile: (path) => state.files.get(path),
    fileSize: (path) => state.files.get(path)?.byteLength,
    removeDir: (dir) => void state.removed.push(dir),
    ...rest,
  };
  return state;
}

/** A STEP file whose DATA section is `data`; the units' SOLID_ANGLE_UNIT is no solid. */
const step = (...data: string[]) =>
  new TextEncoder().encode(
    [
      'ISO-10303-21;',
      'DATA;',
      '#3 = ( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() );',
      ...data,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n'),
  );
const STEP = step("#20 = MANIFOLD_SOLID_BREP('',#21);");
const INPUT = { name: 'My Part (v2).SLDPRT', bytes: new Uint8Array([1, 2, 3]) };

const writes =
  (bytes: Uint8Array, stderr = '') =>
  (process: FakeProcess, files: Map<string, Uint8Array>, cwd: string) => {
    process.stdout('Converted.\n');
    if (stderr) process.stderr(stderr);
    files.set(`${cwd}/My_Part_v2.step`, bytes);
    process.emit('exit', 0);
  };
const writesStep = writes(STEP);

describe('findCadmpeg (ADR-0115 §2)', () => {
  const all = ['/pref/cadmpeg', '/res/cadmpeg/cadmpeg', '/dev/vendor/cadmpeg'];
  const env = (present: string[]) =>
    fake({
      present,
      override: '/pref/cadmpeg',
      resourcesPath: '/res',
      devVendorDir: '/dev/vendor',
      which: (name) => (name === 'cadmpeg' ? '/usr/bin/cadmpeg' : undefined),
    }).env;

  it('takes the preference, then the packaged binary, the dev checkout and PATH', () => {
    expect(findCadmpeg(env(all))).toBe('/pref/cadmpeg');
    expect(findCadmpeg(env(all.slice(1)))).toBe('/res/cadmpeg/cadmpeg');
    expect(findCadmpeg(env(all.slice(2)))).toBe('/dev/vendor/cadmpeg');
    expect(findCadmpeg(env([]))).toBe('/usr/bin/cadmpeg');
    expect(findCadmpeg(fake({ present: [], override: undefined }).env)).toBeUndefined();
  });

  it('looks for cadmpeg.exe on Windows', () => {
    const f = fake({
      platform: 'win32',
      override: undefined,
      resourcesPath: 'C:\\App\\resources',
      present: ['C:\\App\\resources\\cadmpeg\\cadmpeg.exe'],
    });
    expect(findCadmpeg(f.env)).toBe('C:\\App\\resources\\cadmpeg\\cadmpeg.exe');
  });

  it('reports the version, or why there is no converter', () => {
    expect(cadmpegStatus(fake().env)).toEqual({
      found: true,
      path: '/opt/cadmpeg',
      version: '0.6.7',
    });
    expect(cadmpegStatus(fake({ present: [] }).env)).toEqual({
      found: false,
      message: NOT_AVAILABLE,
    });
    const broken = cadmpegStatus(fake({ run: () => ({ code: 1, output: '' }) }).env);
    expect(broken.found).toBe(false);
    expect(broken.message).toContain('--version');
  });
});

describe('safeInputName', () => {
  // The base keeps [A-Za-z0-9._-]; other runs become one `_`; leading and
  // trailing `._-` go (no option-like names); empty → `model`; the extension
  // is lower-cased.
  it('reduces the name to safe characters and keeps the extension', () => {
    expect(safeInputName('My Part (v2).SLDPRT')).toBe('My_Part_v2.sldprt');
    expect(safeInputName('-rf.ipt')).toBe('rf.ipt');
    expect(safeInputName('../../etc/passwd.sat')).toBe('etc_passwd.sat');
    expect(safeInputName('Zahnrad ü.CATPart')).toBe('Zahnrad.catpart');
    expect(safeInputName('äöü.iges')).toBe('model.iges');
    expect(safeInputName(`${'a'.repeat(300)}.igs`)).toBe(`${'a'.repeat(100)}.igs`);
  });

  it('refuses what is not convertible', () => {
    expect(safeInputName('tool.exe')).toBeUndefined();
    expect(safeInputName('part.step')).toBeUndefined();
    expect(safeInputName('sldprt')).toBeUndefined();
  });
});

describe('convertWithCadmpeg (ADR-0115 §2)', () => {
  it('writes the input, runs cadmpeg without a shell in its directory and returns the STEP', async () => {
    const f = fake({ script: writesStep });
    const result = await convertWithCadmpeg(f.env, INPUT);
    expect(result).toEqual({ ok: true, name: 'My Part (v2).step', bytes: STEP });
    const [dir] = f.dirs;
    expect(dir).toMatch(new RegExp(`^/tmp/${CADMPEG_DIR}/[0-9a-f-]{36}$`));
    expect(f.files.get(`${dir}/My_Part_v2.sldprt`)).toEqual(INPUT.bytes);
    expect(f.spawned.map(({ command, args, cwd }) => ({ command, args, cwd }))).toEqual([
      {
        command: '/opt/cadmpeg',
        args: ['convert', 'My_Part_v2.sldprt', '-o', 'My_Part_v2.step'],
        cwd: dir,
      },
    ]);
    expect(f.removed).toEqual([dir]);
  });

  it("answers stderr's last line, else the exit code, and removes the directory", async () => {
    const a = fake({
      script: (process) => {
        process.stderr('reading…\nerror: unsupported version\n\n');
        process.emit('exit', 1);
      },
    });
    expect(await convertWithCadmpeg(a.env, INPUT)).toEqual({
      ok: false,
      message: 'error: unsupported version',
    });
    expect(a.removed).toEqual(a.dirs);
    const b = fake({ script: (process) => process.emit('exit', 3) });
    expect(await convertWithCadmpeg(b.env, INPUT)).toEqual({
      ok: false,
      message: 'cadmpeg exited with code 3.',
    });
  });

  it('caps what it keeps of stderr', async () => {
    const f = fake({
      script: (process) => {
        process.stderr('x'.repeat(MAX_LOG_BYTES));
        process.stderr('\nnever seen\n');
        process.emit('exit', 1);
      },
    });
    const result = await convertWithCadmpeg(f.env, INPUT);
    expect(result.ok === false && result.message).toBe('x'.repeat(300));
  });

  it('kills cadmpeg after 2 minutes', async () => {
    vi.useFakeTimers();
    try {
      const f = fake({ script: () => {} });
      const pending = convertWithCadmpeg(f.env, INPUT);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await pending).toEqual({
        ok: false,
        message: 'The conversion took longer than 2 minutes.',
      });
      expect(f.spawned[0]?.process.killed).toBe(true);
      expect(f.removed).toEqual(f.dirs);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses an input over the cap, an unknown file and a missing binary before spawning', async () => {
    const big = { name: 'big.sat', bytes: { byteLength: MAX_INPUT_BYTES + 1 } as Uint8Array };
    const f = fake({ script: writesStep });
    expect((await convertWithCadmpeg(f.env, big)).ok).toBe(false);
    expect((await convertWithCadmpeg(f.env, { name: 'x.exe', bytes: new Uint8Array() })).ok).toBe(
      false,
    );
    const none = fake({ present: [], script: writesStep });
    expect(await convertWithCadmpeg(none.env, INPUT)).toEqual({
      ok: false,
      message: NOT_AVAILABLE,
    });
    expect([...f.spawned, ...none.spawned]).toEqual([]);
    expect([...f.dirs, ...none.dirs]).toEqual([]);
  });

  it('refuses a missing or oversized STEP, and removes the directory', async () => {
    const missing = fake({ script: (process) => process.emit('exit', 0) });
    expect(await convertWithCadmpeg(missing.env, INPUT)).toEqual({
      ok: false,
      message: 'cadmpeg finished without a STEP file.',
    });
    expect(missing.removed).toEqual(missing.dirs);
    const huge = fake({
      script: writesStep,
      fileSize: () => MAX_OUTPUT_BYTES + 1,
    });
    const result = await convertWithCadmpeg(huge.env, INPUT);
    expect(result.ok === false && result.message).toContain('too large');
    expect(huge.removed).toEqual(huge.dirs);
  });

  // cadmpeg exits 0 when it couldn't read the part's B-rep: a STEP with no
  // geometry, or with an open shell of the faces it could write. Either is
  // refused here, so the kernel doesn't call the part a file of surfaces.
  it('refuses a STEP without a solid, and removes the directory', async () => {
    const empty = fake({
      script: writes(
        step(),
        'step export losses:\n  [error/geometry] no geometry was written to a STEP representation\n',
      ),
    });
    expect(await convertWithCadmpeg(empty.env, INPUT)).toEqual({
      ok: false,
      message: noSolidMessage('My Part (v2).SLDPRT'),
    });
    expect(empty.removed).toEqual(empty.dirs);
    const open = fake({
      script: writes(
        step("#20 = OPEN_SHELL('',(#30));", "#21 = SHELL_BASED_SURFACE_MODEL('',(#20));"),
        '  [error/topology] region #86 was written as a surface model because its solid shells are incomplete or open\n',
      ),
    });
    expect(await convertWithCadmpeg(open.env, INPUT)).toEqual({
      ok: false,
      message: noSolidMessage('My Part (v2).SLDPRT'),
    });
    expect(noSolidMessage('GEAR 32.SLDPRT')).toBe(
      "Couldn't read the geometry of GEAR 32.SLDPRT: converting it gave no solid body. Export it as STEP from the program it was made in, then import that file.",
    );
  });

  it('takes manifold_solid_brep and its subtypes as a solid', () => {
    expect(stepHasSolid(STEP)).toBe(true);
    expect(stepHasSolid(step("#20 = BREP_WITH_VOIDS('',#21,(#22));"))).toBe(true);
    expect(stepHasSolid(step("#20 = FACETED_BREP('',#21);"))).toBe(true);
    expect(stepHasSolid(step())).toBe(false);
    // A view into a larger buffer reads only its own bytes.
    const tail = new TextEncoder().encode('MANIFOLD_SOLID_BREP');
    const joined = new Uint8Array([...step(), ...tail]);
    expect(stepHasSolid(joined.subarray(0, joined.length - tail.length))).toBe(false);
  });

  it("says it couldn't start cadmpeg, and a directory that isn't ours", async () => {
    const a = fake({ script: (process) => process.emit('error', new Error('spawn ENOENT')) });
    expect(await convertWithCadmpeg(a.env, INPUT)).toEqual({
      ok: false,
      message: "Couldn't start cadmpeg.",
    });
    const b = fake({
      prepareDir: () => {
        throw new Error('The conversion directory is not ours.');
      },
    });
    expect(await convertWithCadmpeg(b.env, INPUT)).toEqual({
      ok: false,
      message: "Couldn't convert: The conversion directory is not ours.",
    });
    expect(b.spawned).toEqual([]);
    expect(b.removed).toHaveLength(1);
  });
});

describe('cleanupCadmpegFiles', () => {
  it('removes the conversions folder, and survives a failure', () => {
    const f = fake();
    cleanupCadmpegFiles(f.env);
    expect(f.removed).toEqual([`/tmp/${CADMPEG_DIR}`]);
    const g = fake({
      removeDir: () => {
        throw new Error('EBUSY');
      },
    });
    expect(() => cleanupCadmpegFiles(g.env)).not.toThrow();
  });
});
