import { describe, expect, it } from 'vitest';
import { addresses, DEFAULTS } from './addresses';

describe('addresses', () => {
  it('uses the extrudo.org addresses by default', () => {
    expect(addresses({})).toEqual(DEFAULTS);
  });

  it('takes overrides without a trailing slash', () => {
    expect(
      addresses({ APP_URL: 'https://app.example.test/', EDGE_URL: ' https://e.example.test ' }),
    ).toEqual({
      SITE_URL: DEFAULTS.SITE_URL,
      APP_URL: 'https://app.example.test',
      EDGE_URL: 'https://e.example.test',
    });
  });

  it('refuses something that is not an http(s) URL', () => {
    expect(() => addresses({ APP_URL: 'app.extrudo.org' })).toThrow(/APP_URL must be a full URL/);
    expect(() => addresses({ SITE_URL: 'ftp://extrudo.org' })).toThrow(/http\(s\)/);
  });
});
