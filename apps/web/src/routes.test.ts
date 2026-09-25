import { describe, expect, it } from 'vitest';
import { parseRoute, projectHref } from './routes';

describe('routes', () => {
  it.each([
    ['', { page: 'home' }],
    ['#', { page: 'home' }],
    ['#/', { page: 'home' }],
    ['#/debug/kernel', { page: 'debug-kernel' }],
    ['#/p/abc-123', { page: 'project', id: 'abc-123' }],
    ['#/p/a%20b', { page: 'project', id: 'a b' }],
    ['#/p/', { page: 'not-found', hash: '#/p/' }],
    ['#/nowhere', { page: 'not-found', hash: '#/nowhere' }],
  ])('%j', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it('builds project links that parse back', () => {
    expect(parseRoute(projectHref('a/b c'))).toEqual({ page: 'project', id: 'a/b c' });
  });
});
