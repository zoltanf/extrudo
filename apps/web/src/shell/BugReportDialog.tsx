import type { ExtrudoDocument } from '@extrudo/core';
import { Bug, Camera, Check, Copy, Download, ExternalLink, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, fieldClass, TextInput } from '../design-system';
import { BUILD } from '../version';
import {
  type BugReportInput,
  buildReport,
  errorLog,
  issueFields,
  issueUrl,
  timelineSummary,
} from './bugReport';
import { type InfoRow, type KernelInfo, systemInfo } from './systemInfo';

export interface BugReportDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  desktop: boolean;
  kernelInfo?: KernelInfo;
  /** `Platform.openLink`. */
  openLink(url: string): void;
  /** `Platform.files.download`: Save puts the PNG in the downloads. */
  download(file: Blob, name: string): void;
  /** The screenshot the opener took before opening (ADR-0092 §3); null when none could be taken. */
  screenshot: Blob | null;
  /** Retake: the opener closes the dialog, captures, sets `screenshot`, reopens. Absent where nothing can capture. */
  onRetake?: () => Promise<void>;
  /** For "Include the timeline"; absent on the home screen (no checkbox then). */
  doc?: Pick<ExtrudoDocument, 'features'>;
  notify(tone: 'info' | 'error', text: string): void;
}

const COPY_FAILED = "Couldn't copy the screenshot. Save it and upload the PNG instead.";

/**
 * Help › Report a Bug… (ADR-0092): a title, what happened, the steps, a
 * screenshot, and a preview of the report. "Open GitHub draft" puts the PNG on
 * the clipboard and opens the prefilled issue form; nothing else leaves the
 * machine. The field state lives here (the component stays mounted while the
 * opener retakes the screenshot) and is reset when the dialog closes.
 */
export function BugReportDialog({
  open,
  onOpenChange,
  desktop,
  kernelInfo,
  openLink,
  download,
  screenshot,
  onRetake,
  doc,
  notify,
}: BugReportDialogProps) {
  const [title, setTitle] = useState('');
  const [what, setWhat] = useState('');
  const [steps, setSteps] = useState('');
  const [withTimeline, setWithTimeline] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState<InfoRow[]>([]);
  const [errors, setErrors] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setErrors(errorLog.recent());
    void systemInfo(desktop, kernelInfo).then((r) => live && setRunning(r.running));
    return () => {
      live = false;
    };
  }, [open, desktop, kernelInfo]);

  const shot = removed ? null : screenshot;
  const shotUrl = useMemo(() => (shot ? URL.createObjectURL(shot) : null), [shot]);
  useEffect(() => () => void (shotUrl && URL.revokeObjectURL(shotUrl)), [shotUrl]);

  const input: BugReportInput = {
    title,
    what,
    steps,
    build: BUILD,
    running,
    errors,
    ...(withTimeline && doc && { timeline: timelineSummary(doc) }),
  };
  const report = buildReport(input);

  const change = (next: boolean) => {
    if (!next) {
      setTitle('');
      setWhat('');
      setSteps('');
      setWithTimeline(false);
      setRemoved(false);
    }
    onOpenChange(next);
  };

  const copyShot = async () => {
    if (!shot) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': shot })]);
    } catch {
      notify('error', COPY_FAILED);
    }
  };

  const copyReport = () => {
    void navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const openDraft = async () => {
    await copyShot();
    openLink(issueUrl(issueFields(input)));
  };

  const retake = () => {
    setRemoved(false);
    void onRetake?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={change}
      size="medium"
      title="Report a bug"
      description="Nothing is sent until you submit on GitHub. Remove anything private before you do."
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="bug-title" className="text-sm font-medium">
            Title
          </label>
          <TextInput
            id="bug-title"
            value={title}
            placeholder="One line"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="bug-what" className="text-sm font-medium">
            What happened?
          </label>
          <textarea
            id="bug-what"
            rows={3}
            value={what}
            placeholder="And what did you expect instead?"
            onChange={(e) => setWhat(e.target.value)}
            className={`${fieldClass} h-auto py-1.5`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="bug-steps" className="text-sm font-medium">
            Steps to reproduce
          </label>
          <textarea
            id="bug-steps"
            rows={4}
            value={steps}
            placeholder={'1. New design, Create Sketch on the XY plane\n2. …'}
            onChange={(e) => setSteps(e.target.value)}
            className={`${fieldClass} h-auto py-1.5`}
          />
        </div>

        <div className="flex flex-col gap-2">
          {shotUrl ? (
            <>
              <img
                src={shotUrl}
                alt="Screenshot"
                className="max-h-40 self-start rounded-input border border-line"
              />
              <div className="flex flex-wrap gap-2">
                {onRetake && (
                  <Button onClick={retake}>
                    <Camera size={14} /> Retake
                  </Button>
                )}
                <Button onClick={() => void copyShot()}>
                  <Copy size={14} /> Copy
                </Button>
                <Button
                  onClick={() =>
                    shot &&
                    download(shot, `extrudo-bug-${new Date().toISOString().slice(0, 10)}.png`)
                  }
                >
                  <Download size={14} /> Save
                </Button>
                <Button onClick={() => setRemoved(true)}>
                  <Trash2 size={14} /> Remove
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">No screenshot</span>
              {onRetake && (
                <Button onClick={retake}>
                  <Camera size={14} /> Take screenshot
                </Button>
              )}
            </div>
          )}
          {!shotUrl && (
            <p className="text-sm text-muted">
              A screenshot of the whole screen, taken with your system, works too: paste it on
              GitHub.
            </p>
          )}
        </div>

        {doc && (
          <label className="flex cursor-pointer items-center gap-2 text-base">
            <input
              type="checkbox"
              checked={withTimeline}
              onChange={(e) => setWithTimeline(e.target.checked)}
              className="accent-(--x-accent)"
            />
            Include the timeline
            <span className="text-sm text-muted">(feature names and types)</span>
          </label>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Report</span>
          <pre
            data-testid="bug-report-preview"
            className="max-h-48 overflow-auto rounded-input border border-line bg-panel p-2 font-mono text-xs whitespace-pre-wrap"
          >
            {report}
          </pre>
        </div>

        <ol className="list-none text-sm text-muted">
          <li>1. Open the GitHub draft: the screenshot goes to your clipboard.</li>
          <li>2. Paste it into "Design file or screenshot" (Ctrl+V), or upload the saved PNG.</li>
          <li>3. Press Submit new issue.</li>
        </ol>
        <p className="text-sm text-muted">
          Attaching the design helps most: File › Export saves a <code>.extrudo</code> file.
        </p>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          <Button variant="primary" onClick={() => void openDraft()}>
            <Bug size={14} /> Open GitHub draft <ExternalLink size={12} />
          </Button>
          <Button onClick={copyReport}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy report'}
          </Button>
          <Button onClick={() => change(false)}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
