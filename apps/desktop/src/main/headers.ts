/**
 * The security headers every `app://` response carries (P6-01, ADR-0075 §1;
 * the review). They are `apps/web/public/_headers`'s `/*` block, copied here
 * so the packaged app has the web app's policy even without the `webRequest`
 * hook (which stays as belt and braces). `headers.test.ts` parses `_headers`
 * and fails when the two drift.
 *
 * The response carries them on the `Response` itself (`protocol.ts`), not only
 * through `session.webRequest.onHeadersReceived`, so the CSP/COOP/COEP and
 * `nosniff` can't be lost to an Electron regression in that hook.
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};
