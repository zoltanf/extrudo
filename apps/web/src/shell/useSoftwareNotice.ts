import { useEffect } from 'react';
import type { Platform } from '../platform';
import { type Push, showSoftwareNotice } from '../platform/renderNotice';
import { webglSupport } from '../viewport/webglSupport';

/** Tells a project's page, once, that the browser draws 3D in software (ADR-0076). */
export function useSoftwareNotice(push: Push, platform: Pick<Platform, 'preferences'>): void {
  const { preferences } = platform;
  useEffect(() => {
    showSoftwareNotice(webglSupport(), preferences, push);
  }, [preferences, push]);
}
