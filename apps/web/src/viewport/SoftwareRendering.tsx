import { Tooltip } from '../design-system';
import { SOFTWARE_NOTICE_TEXT } from '../platform/renderNotice';
import type { WebglSupport } from './webglSupport';

/** The status bar's "Software rendering" (ADR-0076); nothing for hardware. */
export function SoftwareRendering({ support }: { support: WebglSupport }) {
  if (support.kind !== 'software') return null;
  return (
    <Tooltip label="Software rendering" hint={SOFTWARE_NOTICE_TEXT}>
      <output
        aria-label="Renderer"
        data-renderer="software"
        className="font-mono text-[11px] whitespace-nowrap text-muted"
      >
        Software rendering
      </output>
    </Tooltip>
  );
}
