import { describe, expect, it } from 'vitest';
import { isAllowedNavigation } from './navigation';

describe('navigation rules (P6-01 review)', () => {
  it('allows the packaged renderer and the dev server’s own origin', () => {
    expect(isAllowedNavigation('app://bundle/')).toBe(true);
    expect(isAllowedNavigation('app://bundle/#/p/abc')).toBe(true);
    expect(isAllowedNavigation('http://localhost:5174/', 'http://localhost:5174/')).toBe(true);
    expect(isAllowedNavigation('http://localhost:5174/x', 'http://localhost:5174')).toBe(true);
  });

  it('refuses everything else, including another origin of the dev server', () => {
    expect(isAllowedNavigation('https://evil.example/')).toBe(false);
    expect(isAllowedNavigation('http://localhost:5175/', 'http://localhost:5174/')).toBe(false);
    expect(isAllowedNavigation('javascript:alert(1)')).toBe(false);
    expect(isAllowedNavigation('data:text/html,<script>1</script>')).toBe(false);
    expect(isAllowedNavigation('file:///etc/passwd')).toBe(false);
    expect(isAllowedNavigation('not a url')).toBe(false);
    // No dev URL: nothing but app:// is allowed.
    expect(isAllowedNavigation('http://localhost:5174/')).toBe(false);
  });
});
