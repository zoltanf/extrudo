/**
 * The public addresses (ADR-0057): the landing page, the stable app, the latest build
 * and the contact email. Overridable at build time with the environment variables of the
 * same names (a fork, a staging site), so no domain or address is hard-coded anywhere
 * else.
 */
export const DEFAULTS = {
  SITE_URL: 'https://extrudo.org',
  APP_URL: 'https://app.extrudo.org',
  EDGE_URL: 'https://edge.extrudo.org',
  CONTACT_EMAIL: 'hello@extrudo.org',
} as const;

export type Addresses = Record<keyof typeof DEFAULTS, string>;

/** A base URL without a trailing slash; throws for something that isn't http(s). */
export function baseUrl(name: string, value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a full URL like ${fallback}, got "${raw}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must be an http(s) URL, got "${raw}"`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** An address for a `mailto:` link; throws for something that isn't an email address. */
export function email(name: string, value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(raw)) {
    throw new Error(`${name} must be an email address like ${fallback}, got "${raw}"`);
  }
  return raw;
}

export function addresses(env: Record<string, string | undefined>): Addresses {
  return {
    SITE_URL: baseUrl('SITE_URL', env.SITE_URL, DEFAULTS.SITE_URL),
    APP_URL: baseUrl('APP_URL', env.APP_URL, DEFAULTS.APP_URL),
    EDGE_URL: baseUrl('EDGE_URL', env.EDGE_URL, DEFAULTS.EDGE_URL),
    CONTACT_EMAIL: email('CONTACT_EMAIL', env.CONTACT_EMAIL, DEFAULTS.CONTACT_EMAIL),
  };
}
