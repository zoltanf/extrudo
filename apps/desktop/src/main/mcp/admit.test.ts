import { describe, expect, it } from 'vitest';
import { admit, MAX_BODY_BYTES } from './admit';

const token = 'a'.repeat(64);
const config = { port: 7474, token };
const ok = {
  host: '127.0.0.1:7474',
  origin: undefined,
  authorization: `Bearer ${token}`,
  contentLength: '120',
};

describe('admit (ADR-0087 §2)', () => {
  it.each([
    ['127.0.0.1 with the port', { host: '127.0.0.1:7474' }, true],
    ['localhost with the port', { host: 'localhost:7474' }, true],
    ['LOCALHOST in capitals', { host: 'LOCALHOST:7474' }, true],
    ['no Host', { host: undefined }, 403],
    ['another port', { host: '127.0.0.1:7475' }, 403],
    ['no port', { host: '127.0.0.1' }, 403],
    ['a rebound name', { host: 'evil.example:7474' }, 403],
    ['a LAN address', { host: '192.168.1.5:7474' }, 403],
    ['0.0.0.0', { host: '0.0.0.0:7474' }, 403],
    ['a loopback Origin', { origin: 'http://127.0.0.1:7474' }, true],
    ['localhost Origin without a port', { origin: 'http://localhost' }, true],
    ['a foreign Origin', { origin: 'https://evil.example' }, 403],
    ['an HTTPS loopback Origin', { origin: 'https://localhost:7474' }, 403],
    ['the null Origin', { origin: 'null' }, 403],
    ['loopback Origin, another port', { origin: 'http://localhost:3000' }, 403],
    ['no token', { authorization: undefined }, 401],
    ['a wrong token', { authorization: `Bearer ${'b'.repeat(64)}` }, 401],
    ['a short token', { authorization: 'Bearer abc' }, 401],
    ['not Bearer', { authorization: `Basic ${token}` }, 401],
    ['a body at the cap', { contentLength: String(MAX_BODY_BYTES) }, true],
    ['a body over the cap', { contentLength: String(MAX_BODY_BYTES + 1) }, 413],
    ['a damaged length', { contentLength: 'lots' }, 413],
  ] as const)('%s', (_name, change, expected) => {
    const result = admit({ ...ok, ...change }, config);
    if (expected === true) expect(result).toEqual({ ok: true });
    else expect(result).toMatchObject({ ok: false, status: expected });
  });

  it('refuses a foreign origin before looking at the token', () => {
    expect(
      admit({ ...ok, origin: 'https://evil.example', authorization: undefined }, config),
    ).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden.',
    });
  });

  it('refuses everything while the token is empty', () => {
    expect(admit({ ...ok, authorization: 'Bearer ' }, { port: 7474, token: '' })).toMatchObject({
      status: 401,
    });
  });
});
