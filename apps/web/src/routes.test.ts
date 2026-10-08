import { describe, expect, it } from 'vitest';
import { exampleHref, parseRoute, projectHref } from './routes';

describe('routes', () => {
  it.each([
    ['', { page: 'home' }],
    ['#', { page: 'home' }],
    ['#/', { page: 'home' }],
    ['#/debug/kernel', { page: 'debug-kernel' }],
    ['#/debug/solver', { page: 'debug-solver' }],
    ['#/debug/dialog', { page: 'debug-dialog' }],
    ['#/debug/crash', { page: 'debug-crash' }],
    ['#/p/abc-123', { page: 'project', id: 'abc-123' }],
    ['#/p/a%20b', { page: 'project', id: 'a b' }],
    ['#/p/', { page: 'not-found', hash: '#/p/' }],
    ['#/example/name-tag', { page: 'example', id: 'name-tag' }],
    ['#/example/a%20b', { page: 'example', id: 'a b' }],
    ['#/example/', { page: 'not-found', hash: '#/example/' }],
    ['#/example/a/b', { page: 'not-found', hash: '#/example/a/b' }],
    ['#/nowhere', { page: 'not-found', hash: '#/nowhere' }],
  ])('%j', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it('builds project links that parse back', () => {
    expect(parseRoute(projectHref('a/b c'))).toEqual({ page: 'project', id: 'a/b c' });
  });

  it('builds example links that parse back', () => {
    expect(parseRoute(exampleHref('a/b c'))).toEqual({ page: 'example', id: 'a/b c' });
  });
});
