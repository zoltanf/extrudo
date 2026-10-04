import { describe, expect, it } from 'vitest';
import { addresses, DEFAULTS, email } from './addresses';

describe('addresses', () => {
  it('uses the extrudo.org addresses by default', () => {
    expect(addresses({})).toEqual(DEFAULTS);
  });

  it('takes overrides without a trailing slash', () => {
    expect(
      addresses({
        APP_URL: 'https://app.example.test/',
        EDGE_URL: ' https://e.example.test ',
        CONTACT_EMAIL: ' hi@example.test ',
      }),
    ).toEqual({
      SITE_URL: DEFAULTS.SITE_URL,
      APP_URL: 'https://app.example.test',
      EDGE_URL: 'https://e.example.test',
      CONTACT_EMAIL: 'hi@example.test',
    });
  });

  it('refuses something that is not an http(s) URL', () => {
    expect(() => addresses({ APP_URL: 'app.extrudo.org' })).toThrow(/APP_URL must be a full URL/);
    expect(() => addresses({ SITE_URL: 'ftp://extrudo.org' })).toThrow(/http\(s\)/);
  });

  it('refuses something that is not an email address', () => {
    expect(() => addresses({ CONTACT_EMAIL: 'not an email' })).toThrow(
      /CONTACT_EMAIL must be an email address like hello@extrudo\.org/,
    );
    // A local part and a host with no dot: no domain, so no address.
    expect(() => addresses({ CONTACT_EMAIL: 'a@b' })).toThrow(/must be an email address/);
  });
});

describe('email', () => {
  it('falls back for an empty value and trims', () => {
    expect(email('CONTACT_EMAIL', undefined, 'hello@extrudo.org')).toBe('hello@extrudo.org');
    expect(email('CONTACT_EMAIL', '   ', 'hello@extrudo.org')).toBe('hello@extrudo.org');
    expect(email('CONTACT_EMAIL', ' hi@extrudo.org ', 'hello@extrudo.org')).toBe('hi@extrudo.org');
  });
});
