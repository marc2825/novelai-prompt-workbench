import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The distributed extension bundles third-party code; MIT requires their notices
// to ship with it (public/THIRD_PARTY_NOTICES.txt is copied into the build).
const require = createRequire(import.meta.url);
const notices = readFileSync('public/THIRD_PARTY_NOTICES.txt', 'utf8');
const packageDir = (name: string, from = process.cwd()) => realpathSync(dirname(require.resolve(`${name}/package.json`, { paths: [from] })));

describe('release contents', () => {
  it('runtime dependencies are exactly the ones covered by THIRD_PARTY_NOTICES.txt', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string>; license: string };
    expect(manifest.license).toBe('MIT');
    // Adding a runtime dependency? Add its license to public/THIRD_PARTY_NOTICES.txt first.
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['react', 'react-dom']);
  });
  it.each(['react', 'react-dom', 'scheduler'])('ships the current license text and version of %s', name => {
    const dir = name === 'scheduler' ? packageDir(name, packageDir('react-dom')) : packageDir(name);
    const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string };
    expect(notices).toContain(`=== ${name} ${version} (MIT) ===`);
    expect(notices).toContain(readFileSync(join(dir, 'LICENSE'), 'utf8').trim());
  });
  it('covers the bundler runtime helpers (Vite preload helper, WXT entrypoint runtime)', () => {
    expect(notices).toMatch(/=== vite \S+ \(MIT\)/);
    expect(notices).toContain('Copyright (c) 2019-present, VoidZero Inc. and Vite contributors');
    expect(notices).toMatch(/=== wxt \S+ and @wxt-dev\/browser \S+ \(MIT\)/);
  });
});
