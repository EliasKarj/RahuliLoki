import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/lib/config.ts';
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

/**
 * The number the app says it is, against the number the release is built as.
 *
 * These are separate files and nothing in the type system ties them together, so they drifted:
 * `VERSION` sat at 1.2.0 while the manifests went to 1.4.0 and a tag went to 1.4.1. The visible
 * result was an app that introduced itself as 1.2.0 and was told, every time it checked, that an
 * update was waiting — the exact "nags forever about an update that is already installed" failure
 * the comment at the top of lib/version.ts warns about, arriving through a door that comment did
 * not cover.
 *
 * It is not enough for the four manifests to agree with each other, because they all agreed at
 * 1.4.0 while the app said something else entirely. What matters is that the string the running
 * program reports is the string the installer was named after.
 */
describe('the version the app reports', () => {
  const root = new URL('../../', import.meta.url);
  const manifests = ['package.json', 'server/package.json', 'web/package.json', 'desktop/package.json'];

  const versionOf = (file: string): string => {
    const raw = readFileSync(new URL(file, root), 'utf8');
    return (JSON.parse(raw) as { version?: unknown }).version as string;
  };

  it('is the version every manifest is packaged as', () => {
    // One assertion listing all four, so a failure names which file disagrees rather than
    // stopping at the first.
    expect(Object.fromEntries(manifests.map((file) => [file, versionOf(file)]))).toEqual(
      Object.fromEntries(manifests.map((file) => [file, VERSION])),
    );
  });

  it('is a version the update check can actually compare', () => {
    // A version this cannot parse makes isNewer answer false to everything, which is the silent
    // half of the same bug: no nagging, and no update ever announced either.
    expect(parseVersion(VERSION)).not.toBeNull();
  });
});
