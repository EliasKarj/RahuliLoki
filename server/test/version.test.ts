import { describe, expect, it } from 'vitest';
import { isNewer, parseVersion } from '../src/lib/version.ts';

describe('parseVersion', () => {
  it('reads a tag with or without its v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('  v1.2.3  ')).toEqual([1, 2, 3]);
  });

  it('refuses anything it cannot be sure about', () => {
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('1.2.3-rc.1')).toBeNull();
    expect(parseVersion('nightly')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('isNewer', () => {
  it('compares numbers as numbers', () => {
    // The classic: as strings, "1.0.10" sorts before "1.0.9" and the check goes silent for the
    // rest of the project's life.
    expect(isNewer('1.0.9', '1.0.10')).toBe(true);
    expect(isNewer('1.0.10', '1.0.9')).toBe(false);
  });

  it('walks major, minor, patch in that order', () => {
    expect(isNewer('1.9.9', '2.0.0')).toBe(true);
    expect(isNewer('1.2.3', '1.3.0')).toBe(true);
    expect(isNewer('2.0.0', '1.9.9')).toBe(false);
  });

  it('is not newer than itself', () => {
    expect(isNewer('1.0.2', 'v1.0.2')).toBe(false);
  });

  it('says no when either side is unreadable', () => {
    // A tag nobody can parse is not a reason to send someone to a download page.
    expect(isNewer('1.0.2', 'v2.0.0-rc.1')).toBe(false);
    expect(isNewer('dev', 'v2.0.0')).toBe(false);
  });
});
