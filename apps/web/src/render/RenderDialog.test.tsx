// @vitest-environment jsdom
import {
  createDocument,
  createDocumentStore,
  createModelStore,
  createSessionStore,
  DEFAULT_RENDER_SETTINGS,
  setRenderSettings,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelExporter } from '../export/modelExport';
import type {
  BlenderRenderer,
  BlenderStatus,
  RenderProgress,
  RenderResult,
} from '../platform/render';
import type { BodyEntry } from '../shell/bodies';
import { type RenderDialogProps, RenderForm } from './RenderDialog';

const A = 'E1:Bracket' as never;
const tri = {
  positions: Float64Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
  indices: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
};

interface Fake extends BlenderRenderer {
  jobs: Parameters<BlenderRenderer['render']>[0][];
  progress?: (p: RenderProgress) => void;
  finish(result: RenderResult): void;
}

function fakeRender(status: BlenderStatus = { state: 'found', version: '4.5.1', path: '/b' }) {
  let resolve: (r: RenderResult) => void = () => {};
  const fake: Fake = {
    jobs: [],
    status: async () => status,
    render(job, onProgress) {
      fake.jobs.push(job);
      fake.progress = onProgress;
      return new Promise<RenderResult>((r) => {
        resolve = r;
      });
    },
    cancel: vi.fn(),
    finish: (r) => resolve(r),
  };
  return fake;
}

function setup(over: Partial<RenderDialogProps> = {}, status?: BlenderStatus) {
  const model = createModelStore<BodyMesh>();
  const store = createDocumentStore(createDocument());
  model.getState().computed({ features: {}, bodies: {} });
  const kernel: ModelExporter = {
    exportMeshes: async (ids) => ids.map((id) => ({ id, mesh: tri })),
    exportStep: async () => '',
    exportScad: async () => '',
  };
  const bodies: BodyEntry[] = [
    {
      id: A,
      meta: { name: 'Bracket', visible: true, color: '#3366ff' },
      stored: true,
      display: 'shown',
    },
  ];
  const renderer = fakeRender(status);
  const download = vi.fn();
  const notify = vi.fn();
  const onClose = vi.fn();
  const props: RenderDialogProps = {
    store,
    session: createSessionStore(),
    model,
    bodies,
    kernel,
    request: {},
    files: { download, pick: async () => undefined },
    render: renderer,
    viewportCamera: () => ({
      projection: 'perspective',
      position: [5, 5, 5],
      target: [0, 0, 0],
      up: [0, 0, 1],
    }),
    onClose,
    notify,
    ...over,
  };
  const view = render(<RenderForm {...props} />);
  return { ...props, renderer, download, notify, onClose, view, store };
}

const renderButton = () => screen.getByRole('button', { name: 'Render' });
const dispatchSpy = (store: ReturnType<typeof setup>['store']) => {
  const original = store.getState().dispatch;
  const spy = vi.fn(original);
  store.setState({ dispatch: spy });
  return spy;
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:picture');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe('the Blender status line', () => {
  it('says which Blender was found and enables Render', async () => {
    setup();
    expect(await screen.findByText('Blender 4.5.1 found.')).toBeTruthy();
    await waitFor(() => expect((renderButton() as HTMLButtonElement).disabled).toBe(false));
  });

  it('points to blender.org and disables Render when it is missing', async () => {
    const openLink = vi.fn();
    setup({ openLink }, { state: 'missing' });
    expect(await screen.findByText(/Blender isn't installed/)).toBeTruthy();
    expect((renderButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'blender.org' }));
    expect(openLink).toHaveBeenCalledWith('https://www.blender.org/download/');
  });

  it('names the minimum version for an old Blender', async () => {
    setup({}, { state: 'too-old', version: '3.6.0', path: '/b' });
    expect(
      await screen.findByText(/Blender 3\.6\.0 is too old: 4\.2 or newer is needed\./),
    ).toBeTruthy();
    expect((renderButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Render when every body is hidden', async () => {
    setup({
      bodies: [
        { id: A, meta: { name: 'Bracket', visible: false }, stored: true, display: 'hidden' },
      ],
    });
    await screen.findByText('Blender 4.5.1 found.');
    expect(screen.getByText('Nothing to render: every body is hidden.')).toBeTruthy();
    expect((renderButton() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the scene cards', () => {
  it('are a radio group the arrow keys move through', async () => {
    setup();
    const studio = screen.getByRole('radio', { name: /Studio/ });
    expect(studio.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(studio, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: /Wooden table/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(studio.getAttribute('aria-checked')).toBe('false');
  });
});

describe('many bodies', () => {
  const B = 'E2:Lid' as never;
  const two = (): BodyEntry[] => [
    {
      id: A,
      meta: { name: 'Bracket', visible: true, color: '#3366ff' },
      stored: true,
      display: 'shown',
    },
    { id: B, meta: { name: 'Lid', visible: true }, stored: true, display: 'shown' },
  ];

  it('offers one finish for all bodies, and the per-body list on request', () => {
    setup({ bodies: two() });
    const all = screen.getByLabelText('Finish of all bodies') as HTMLSelectElement;
    expect(all.value).toBe('matte');
    expect(screen.queryByLabelText('Finish of Lid')).toBeNull();
    fireEvent.change(all, { target: { value: 'glossy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set per body…' }));
    expect((screen.getByLabelText('Finish of Bracket') as HTMLSelectElement).value).toBe('glossy');
    expect((screen.getByLabelText('Finish of Lid') as HTMLSelectElement).value).toBe('glossy');
    fireEvent.change(screen.getByLabelText('Finish of Lid'), { target: { value: 'wood' } });
    // Mixed now: the list stays open and the toggle is gone.
    expect(all.value).toBe('mixed');
    expect(screen.queryByRole('button', { name: 'Hide the list' })).toBeNull();
    fireEvent.change(all, { target: { value: 'metal' } });
    expect((screen.getByLabelText('Finish of Lid') as HTMLSelectElement).value).toBe('metal');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the list' }));
    expect(screen.queryByLabelText('Finish of Lid')).toBeNull();
  });

  it('folds the Scene group to one line that sums up the choices', () => {
    setup({ bodies: two() });
    fireEvent.click(screen.getByRole('radio', { name: /Workbench/ }));
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '1280x720' } });
    fireEvent.click(screen.getByLabelText(/High/));
    expect(screen.getByText('Several minutes, finest')).toBeTruthy();
    const scene = screen.getByRole('button', { name: /^Scene/ });
    expect(scene.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(scene);
    expect(scene.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('radio', { name: /Workbench/ })).toBeNull();
    expect(screen.queryByLabelText('Camera')).toBeNull();
    expect(scene.textContent).toContain('Workbench · Current view · 1280 × 720 · High');
    // The Bodies group stays.
    expect(screen.getByLabelText('Finish of all bodies')).toBeTruthy();
    fireEvent.click(scene);
    expect(screen.getByRole('radio', { name: /Workbench/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect((screen.getByLabelText(/High/) as HTMLInputElement).checked).toBe(true);
  });

  it('opens the list by itself when the stored finishes differ', () => {
    const store = createDocumentStore(createDocument());
    store
      .getState()
      .dispatch(
        setRenderSettings({ render: { ...DEFAULT_RENDER_SETTINGS, finishes: { [A]: 'resin' } } }),
      );
    setup({ store, bodies: two() });
    expect((screen.getByLabelText('Finish of all bodies') as HTMLSelectElement).value).toBe(
      'mixed',
    );
    expect((screen.getByLabelText('Finish of Bracket') as HTMLSelectElement).value).toBe('resin');
  });
});

describe('rendering', () => {
  const ready = async () => {
    await screen.findByText('Blender 4.5.1 found.');
  };

  it('dispatches the chosen settings once, builds the job and shows progress', async () => {
    const ctx = setup();
    const dispatch = dispatchSpy(ctx.store);
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Wooden table/ }));
    fireEvent.change(screen.getByLabelText('Finish of Bracket'), { target: { value: 'metal' } });
    fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'current' } });
    fireEvent.click(screen.getByLabelText(/High/));
    fireEvent.click(renderButton());

    await waitFor(() => expect(ctx.renderer.jobs).toHaveLength(1));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(ctx.store.getState().doc.render).toMatchObject({
      preset: 'table',
      quality: 'high',
      finishes: { [A]: 'metal' },
      camera: { kind: 'current' },
    });
    const job = ctx.renderer.jobs[0];
    expect(job).toMatchObject({
      preset: 'table',
      quality: 'high',
      camera: { position: [5, 5, 5] },
    });
    expect(job?.objects).toEqual([{ name: 'Bracket', finish: 'metal', color: '#3366ff' }]);

    act(() => ctx.renderer.progress?.({ phase: 'rendering', fraction: 0.43 }));
    expect(screen.getByText('Rendering… 43 %')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('43');
    act(() => ctx.renderer.progress?.({ phase: 'saving', fraction: 1 }));
    expect(screen.getByText('Saving…')).toBeTruthy();
  });

  it('dispatches nothing when the choices are what is stored', async () => {
    const ctx = setup();
    const dispatch = dispatchSpy(ctx.store);
    await ready();
    fireEvent.click(renderButton());
    await waitFor(() => expect(ctx.renderer.jobs).toHaveLength(1));
    expect(dispatch).not.toHaveBeenCalled();
    expect(ctx.store.getState().doc.render).toBeUndefined();
  });

  it('Cancel stops the render', async () => {
    const ctx = setup();
    await ready();
    fireEvent.click(renderButton());
    await waitFor(() => expect(ctx.renderer.jobs).toHaveLength(1));
    await screen.findByText('Starting Blender…');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ctx.renderer.cancel).toHaveBeenCalledTimes(1);
    act(() => ctx.renderer.finish({ ok: false, message: 'stopped', cancelled: true }));
    expect(await screen.findByText('Render cancelled.')).toBeTruthy();
    expect(renderButton()).toBeTruthy();
  });

  it('shows the picture with Save PNG, Copy and Render again', async () => {
    const write = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { write } });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public items: unknown) {}
      },
    );
    const ctx = setup();
    await ready();
    fireEvent.click(renderButton());
    await waitFor(() => expect(ctx.renderer.jobs).toHaveLength(1));
    act(() => ctx.renderer.finish({ ok: true, png: Uint8Array.from([137, 80, 78, 71]) }));
    const img = (await screen.findByRole('img')) as HTMLImageElement;
    expect(img.alt).toBe('Rendered picture of Untitled');
    expect(img.src).toBe('blob:picture');
    // A click zooms to the real size, another fits it again.
    const zoom = screen.getByRole('button', { name: /^Zoom in/ });
    expect(zoom.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(zoom);
    expect(zoom.getAttribute('aria-pressed')).toBe('true');
    expect(img.className).toContain('max-w-none');
    fireEvent.click(screen.getByRole('button', { name: /^Zoom out/ }));
    expect(img.className).not.toContain('max-w-none');

    fireEvent.click(screen.getByRole('button', { name: 'Save PNG…' }));
    expect(ctx.download).toHaveBeenCalledWith(expect.any(Blob), 'Untitled - Studio.png');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(ctx.notify).toHaveBeenCalledWith('info', 'Copied'));
    write.mockRejectedValueOnce(new Error('no'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(ctx.notify).toHaveBeenCalledWith('error', "Couldn't copy"));

    fireEvent.click(screen.getByRole('button', { name: 'Render again' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:picture');
    expect(renderButton()).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('shows the message of a failed render and the form again', async () => {
    const ctx = setup();
    await ready();
    fireEvent.click(renderButton());
    await waitFor(() => expect(ctx.renderer.jobs).toHaveLength(1));
    act(() => ctx.renderer.finish({ ok: false, message: 'Blender stopped with an error.' }));
    expect(await screen.findByText('Blender stopped with an error.')).toBeTruthy();
    expect(renderButton()).toBeTruthy();
  });

  it('cancels a running render when the dialog goes away', async () => {
    const ctx = setup();
    await ready();
    fireEvent.click(renderButton());
    await waitFor(() => expect(ctx.renderer.jobs).toHaveLength(1));
    ctx.view.unmount();
    expect(ctx.renderer.cancel).toHaveBeenCalled();
  });
});

describe('the stored settings', () => {
  it('come back when the dialog is opened again', async () => {
    const store = createDocumentStore(createDocument());
    store.getState().dispatch(
      setRenderSettings({
        render: {
          ...DEFAULT_RENDER_SETTINGS,
          preset: 'workbench',
          width: 1280,
          height: 720,
          quality: 'draft',
          finishes: { [A]: 'glossy' },
        },
      }),
    );
    setup({ store });
    expect(screen.getByRole('radio', { name: /Workbench/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe('1280x720');
    expect((screen.getByLabelText('Finish of Bracket') as HTMLSelectElement).value).toBe('glossy');
    expect((screen.getByLabelText(/Draft/) as HTMLInputElement).checked).toBe(true);
  });
});
