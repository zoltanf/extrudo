import { Bug, Check, Copy, ExternalLink, FolderGit2, Globe, ScrollText, X } from 'lucide-react';
import { Dialog as Radix } from 'radix-ui';
import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  version as reactVersion,
  useEffect,
  useState,
} from 'react';
import { REVISION } from 'three';
import type { BuildChannel } from '../../pwa/build-info';
import { IconButton, Wordmark } from '../design-system';
import { BUILD } from '../version';
import {
  CHANGELOG_URL,
  COMMIT_URL,
  CREDITS,
  ISSUES_URL,
  LICENSE_URL,
  NOTICE_URL,
  REPO,
  SITE,
} from './aboutLinks';
import { LogoReplay } from './LogoReplay';
import { type InfoRow, type KernelInfo, systemInfo } from './systemInfo';

const CHANNELS: Record<BuildChannel, { badge: string; label: string; tone: string }> = {
  stable: { badge: 'Stable', label: 'Stable, app.extrudo.org', tone: 'bg-success/15 text-success' },
  edge: { badge: 'Edge', label: 'Edge, the latest main', tone: 'bg-warning/15 text-warning' },
  dev: { badge: 'Dev', label: 'Local development build', tone: 'bg-sketch/15 text-sketch' },
};

export interface AboutDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The desktop build. */
  desktop: boolean;
  /** The kernel worker's status and WASM heap, when a project's kernel runs. */
  kernelInfo?: KernelInfo;
  /** Opens a link in the system browser (`Platform.openLink`). */
  openLink(url: string): void;
}

/**
 * Help › About Extrudo: the build's version, channel and commit, where the app
 * runs (browser, system, GPU, memory, storage), and links to the site and the
 * source. "Copy details" puts it all on the clipboard for a bug report. The
 * logo plays its own design once on open, and again when clicked (`LogoReplay`).
 */
export function AboutDialog({
  open,
  onOpenChange,
  desktop,
  kernelInfo,
  openLink,
}: AboutDialogProps) {
  const [rows, setRows] = useState<{ running: InfoRow[]; storage: InfoRow[] }>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void systemInfo(desktop, kernelInfo).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [open, desktop, kernelInfo]);

  const channel = CHANNELS[BUILD.channel];
  const built = BUILD.date
    ? new Date(BUILD.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : undefined;
  const buildRows: InfoRow[] = [
    { label: 'Version', value: BUILD.version },
    { label: 'Channel', value: channel.label },
    ...(BUILD.commit
      ? [{ label: 'Commit', value: `${BUILD.commit}${BUILD.dirty ? ' (with local changes)' : ''}` }]
      : []),
    ...(built ? [{ label: 'Built', value: built }] : []),
  ];

  const credits = CREDITS.filter((c) => desktop || !c.desktopOnly);
  const engineRows: InfoRow[] = [
    { label: 'OCCT', value: BUILD.engines.occt },
    { label: 'planegcs', value: BUILD.engines.planegcs },
    { label: 'OpenSCAD', value: BUILD.engines.openscad },
    { label: 'three.js', value: `r${REVISION}` },
    { label: 'React', value: reactVersion },
  ].filter((r) => r.value);

  // Keeps the href (hover URL, middle-click on the web); a click goes through the platform.
  const opener = (href: string) => (event: MouseEvent) => {
    event.preventDefault();
    openLink(href);
  };

  const copy = () => {
    const lines = (title: string, list: InfoRow[]) => [
      `${title}:`,
      ...list.map((r) => `  ${r.label}: ${r.value}`),
    ];
    const text = [
      `Extrudo ${BUILD.version}`,
      ...lines('Build', buildRows.slice(1)),
      ...lines('Running on', rows?.running ?? []),
      ...lines('Engines', engineRows),
      ...lines('Memory and storage', rows?.storage ?? []),
    ].join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-40 bg-[rgb(10_12_16/55%)]" />
        <Radix.Content
          aria-describedby={undefined}
          // Focus the dialog itself, so the close button's tooltip doesn't open with it.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-40 flex max-h-[calc(100vh-48px)] w-[min(880px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-dialog border border-line bg-raised text-ink shadow-raised"
        >
          {/* The hero: the mark on a sketch grid. */}
          <header className="relative isolate flex flex-col items-center gap-2 border-b border-line px-6 pt-7 pb-5 text-center">
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 50% 34%, color-mix(in srgb, var(--x-logo-top) 20%, transparent), transparent 60%), linear-gradient(color-mix(in srgb, var(--x-line) 55%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--x-line) 55%, transparent) 1px, transparent 1px)',
                maskImage: 'linear-gradient(black 70%, transparent)',
                backgroundSize: '100% 100%, 16px 16px, 16px 16px',
                backgroundPosition: 'center, center, center',
              }}
            />
            <Radix.Close asChild>
              <IconButton label="Close" className="absolute top-3 right-3">
                <X size={18} strokeWidth={1.75} />
              </IconButton>
            </Radix.Close>
            <LogoReplay size={112} autoPlay />
            <Radix.Title className="mt-1 text-[34px]">
              <Wordmark />
              <span className="sr-only"> — about</span>
            </Radix.Title>
            <p className="text-base text-muted">
              Parametric CAD for 3D printing, right in your browser.
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-full border border-line bg-panel px-2.5 py-0.5 font-mono text-sm">
                {BUILD.version}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${channel.tone}`}>
                {channel.badge}
              </span>
            </div>
          </header>

          {/* Two columns from md up: build, engines, memory and storage; then where it runs. */}
          <div className="grid min-h-0 gap-x-10 gap-y-3 overflow-auto px-6 py-4 md:grid-cols-2">
            <div>
              <Section title="Build">
                {buildRows.map((r) =>
                  r.label === 'Commit' ? (
                    <Row key={r.label} label={r.label}>
                      <a
                        href={COMMIT_URL(BUILD.commit)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={opener(COMMIT_URL(BUILD.commit))}
                        className="inline-flex items-center gap-1 font-mono underline-offset-2 hover:underline"
                      >
                        {r.value}
                        <ExternalLink size={12} className="text-muted" />
                      </a>
                    </Row>
                  ) : (
                    <Row key={r.label} label={r.label}>
                      {r.value}
                    </Row>
                  ),
                )}
              </Section>
              <Section title="Engines">
                {engineRows.map((r) => (
                  <Row key={r.label} label={r.label}>
                    {r.value}
                  </Row>
                ))}
              </Section>
              {rows && rows.storage.length > 0 && (
                <Section title="Memory and storage">
                  {rows.storage.map((r) => (
                    <Row key={r.label} label={r.label}>
                      {r.value}
                    </Row>
                  ))}
                </Section>
              )}
            </div>
            <div>
              <Section title="Running on">
                {rows ? (
                  rows.running.map((r) => (
                    <Row key={r.label} label={r.label}>
                      {r.value}
                    </Row>
                  ))
                ) : (
                  <p className="py-2 text-sm text-muted">Looking around…</p>
                )}
              </Section>
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2 border-t border-line px-4 py-3">
            <LinkButton href={SITE} onOpen={opener} icon={<Globe size={14} />}>
              extrudo.org
            </LinkButton>
            <LinkButton href={CHANGELOG_URL} onOpen={opener} icon={<ScrollText size={14} />}>
              What's new
            </LinkButton>
            <LinkButton href={REPO} onOpen={opener} icon={<FolderGit2 size={14} />}>
              GitHub
            </LinkButton>
            <LinkButton href={ISSUES_URL} onOpen={opener} icon={<Bug size={14} />}>
              Report an issue
            </LinkButton>
            <button type="button" onClick={copy} disabled={!rows} className={FOOTER_ITEM}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy details'}
            </button>
          </footer>
          <p className="px-6 pb-3 text-center text-xs leading-5 text-muted">
            Free and open source under <MutedLink href={LICENSE_URL} onOpen={opener} />.
            <br />
            Made with{' '}
            {credits.map((c, i) => (
              <Fragment key={c.name}>
                {i > 0 && (i === credits.length - 1 ? ' and ' : ', ')}
                <MutedLink href={c.url} onOpen={opener}>
                  {c.name}
                </MutedLink>
              </Fragment>
            ))}
            .{' '}
            <MutedLink href={NOTICE_URL} onOpen={opener}>
              Third-party notices
            </MutedLink>
            .
          </p>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <div className="mb-1 flex min-h-7 items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      </div>
      <dl className="grid grid-cols-[128px_1fr] gap-x-4">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="py-1 text-base text-muted">{label}</dt>
      <dd className="min-w-0 py-1 text-base break-words">{children}</dd>
    </>
  );
}

type Opener = (href: string) => (event: MouseEvent) => void;

/** The credits line's links: the line's muted colour, underlined, ink on hover. */
function MutedLink({
  href,
  onOpen,
  children = 'GPL-3.0-or-later',
}: {
  href: string;
  onOpen: Opener;
  children?: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onOpen(href)}
      className="underline underline-offset-2 hover:text-ink"
    >
      {children}
    </a>
  );
}

const FOOTER_ITEM =
  'inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-base text-muted transition-colors hover:bg-panel hover:text-ink disabled:pointer-events-none disabled:opacity-50';

function LinkButton({
  href,
  onOpen,
  icon,
  children,
}: {
  href: string;
  onOpen: Opener;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={onOpen(href)} className={FOOTER_ITEM}>
      {icon}
      {children}
    </a>
  );
}
