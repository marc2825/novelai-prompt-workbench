import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../../src/core/png';
import { writeZip } from '../../src/data/zip';
import { APP_VERSION } from '../../src/version';
import { changelogSection, checkVersions, isPrerelease, readZip, REQUIRED_FILES, sourceVersionOf, verifyReleaseZip, zipName } from '../../scripts/release-lib.mjs';
import { png } from '../fixtures/png';

const manifest = (overrides: Record<string, unknown> = {}) => ({
  manifest_version: 3, name: 'x', version: '1.2.3', permissions: ['sidePanel'],
  action: { default_title: 't' }, background: { service_worker: 'background.js' }, side_panel: { default_path: 'sidepanel.html' },
  icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  content_scripts: [{ matches: ['https://novelai.net/image', 'https://novelai.net/image/*', 'https://novelai.net/image?*'], js: ['content-scripts/novelai.js'] }],
  ...overrides,
});
const text = (value: string) => new TextEncoder().encode(value);
async function release(change: (files: Map<string, Uint8Array>) => void = () => undefined) {
  const files = new Map<string, Uint8Array>(REQUIRED_FILES.map(name => [name, name.endsWith('.png') ? new Uint8Array(png()) : text(`/* ${name} */`)]));
  files.set('manifest.json', text(JSON.stringify(manifest())));
  files.set('chunks/sidepanel-abc123.js', text('console.log(1)'));
  files.set('assets/sidepanel-abc123.css', text('body{}'));
  change(files);
  return Buffer.from(await (await writeZip([...files].map(([name, data]) => ({ name, data })))).arrayBuffer());
}

describe('release version checks', () => {
  it('accepts matching versions and a matching vX.Y.Z tag', () => {
    expect(checkVersions({ packageVersion: '0.1.0', sourceVersion: '0.1.0', manifestVersion: '0.1.0', tag: 'v0.1.0' })).toEqual([]);
  });
  it.each([
    [{ packageVersion: '0.1.0', sourceVersion: '0.1.1' }, 'src/version.ts'],
    [{ packageVersion: '0.1.0', sourceVersion: '0.1.0', manifestVersion: '0.2.0' }, 'manifest version'],
    [{ packageVersion: '0.1.0', sourceVersion: '0.1.0', tag: 'v0.1.1' }, 'does not match version'],
    [{ packageVersion: '0.1.0', sourceVersion: '0.1.0', tag: '0.1.0' }, 'vX.Y.Z'],
    [{ packageVersion: '0.1.0', sourceVersion: '0.1.0', tag: 'v0.1.0-beta' }, 'vX.Y.Z'],
    [{ packageVersion: '0.1', sourceVersion: '0.1' }, 'X.Y.Z'],
  ])('rejects %j', (input, message) => {
    expect(checkVersions(input).join('\n')).toContain(message);
  });
  it('reads the version from src/version.ts and treats 0.x as pre-release', () => {
    expect(sourceVersionOf(readFileSync('src/version.ts', 'utf8'))).toBe(APP_VERSION);
    expect(isPrerelease('0.9.3')).toBe(true);
    expect(isPrerelease('1.0.0')).toBe(false);
    expect(zipName('0.1.0')).toBe('novelai-prompt-workbench-0.1.0-chrome.zip');
  });
  it('the CLI fails on a tag that does not match the project version', () => {
    const mismatch = spawnSync(process.execPath, ['scripts/verify-release.mjs', '--versions-only', '--tag', 'v99.0.0'], { encoding: 'utf8' });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('does not match version');
    const match = spawnSync(process.execPath, ['scripts/verify-release.mjs', '--versions-only', '--tag', `v${APP_VERSION}`], { encoding: 'utf8' });
    expect(match.status).toBe(0);
  });
});

describe('release ZIP verification', () => {
  it('accepts a complete release with manifest.json at the root', async () => {
    const result = verifyReleaseZip(await release(), '1.2.3');
    expect(result.problems).toEqual([]);
    expect(result.files).toContain('manifest.json');
  });
  it.each([
    ['a source map', (files: Map<string, Uint8Array>) => files.set('chunks/sidepanel-abc123.js.map', text('{}')), 'unexpected file'],
    ['a source map reference', (files: Map<string, Uint8Array>) => files.set('background.js', text('x\n//# sourceMappingURL=background.js.map')), 'source map reference'],
    ['test fixture code', (files: Map<string, Uint8Array>) => files.set('chunks/sidepanel-abc123.js', text('"data-workbench-fixture"')), 'test fixture code'],
    ['a test file', (files: Map<string, Uint8Array>) => files.set('tests/unit/a.test.ts', text('x')), 'unexpected file'],
    ['an env file', (files: Map<string, Uint8Array>) => files.set('.env', text('TOKEN=1')), 'unexpected file'],
    ['credential-like text', (files: Map<string, Uint8Array>) => files.set('background.js', text(`const t = "ghp_${'a'.repeat(36)}"`)), 'credential-like text'],
    ['a missing license', (files: Map<string, Uint8Array>) => files.delete('LICENSE.txt'), 'missing file: LICENSE.txt'],
    ['missing third-party notices', (files: Map<string, Uint8Array>) => files.delete('THIRD_PARTY_NOTICES.txt'), 'missing file: THIRD_PARTY_NOTICES.txt'],
    ['a missing icon', (files: Map<string, Uint8Array>) => files.delete('icon/128.png'), 'missing file: icon/128.png'],
    ['a fake icon', (files: Map<string, Uint8Array>) => files.set('icon/16.png', text('not png')), 'not a PNG'],
    ['extra permissions', (files: Map<string, Uint8Array>) => files.set('manifest.json', text(JSON.stringify(manifest({ permissions: ['sidePanel', 'tabs'] })))), 'permissions must be exactly'],
    ['host permissions', (files: Map<string, Uint8Array>) => files.set('manifest.json', text(JSON.stringify(manifest({ host_permissions: ['<all_urls>'] })))), 'must not contain host_permissions'],
    ['a wider content script', (files: Map<string, Uint8Array>) => files.set('manifest.json', text(JSON.stringify(manifest({ content_scripts: [{ matches: ['https://novelai.net/*'] }] })))), 'content script'],
    ['a popup', (files: Map<string, Uint8Array>) => files.set('manifest.json', text(JSON.stringify(manifest({ action: { default_popup: 'sidepanel.html' } })))), 'popup'],
    ['another version', (files: Map<string, Uint8Array>) => files.set('manifest.json', text(JSON.stringify(manifest({ version: '9.9.9' })))), 'does not match 1.2.3'],
  ])('rejects %s', async (_label, change, message) => {
    expect(verifyReleaseZip(await release(change), '1.2.3').problems.join('\n')).toContain(message);
  });
  it('rejects a ZIP whose files sit in a subfolder (manifest.json must be at the root)', async () => {
    const nested = Buffer.from(await (await writeZip([{ name: 'extension/manifest.json', data: text(JSON.stringify(manifest())) }])).arrayBuffer());
    const problems = verifyReleaseZip(nested, '1.2.3').problems.join('\n');
    expect(problems).toContain('unexpected file: extension/manifest.json');
    expect(problems).toContain('missing file: manifest.json');
  });
  it('rejects garbage and reads deflate-compressed entries', () => {
    expect(verifyReleaseZip(Buffer.from('not a zip at all, definitely'), '1.2.3').problems[0]).toContain('not a ZIP');
    // One deflated entry, built by hand (the release ZIP from WXT is deflate-compressed).
    const name = Buffer.from('a.txt'); const data = Buffer.from('hello hello hello hello'); const packed = deflateRawSync(data); const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + packed.length, 16);
    const entries = readZip(Buffer.concat([local, name, packed, central, name, end]));
    expect(entries.map(entry => [entry.name, entry.data.toString()])).toEqual([['a.txt', 'hello hello hello hello']]);
  });
});

describe('release notes source', () => {
  it('extracts exactly one version section from CHANGELOG.md', () => {
    const markdown = '# Changelog\n\n## [Unreleased]\n\n## [0.2.0]\n\n### 追加\n- B\n\n## [0.1.0]\n\n- A\n';
    expect(changelogSection(markdown, '0.2.0')).toBe('### 追加\n- B');
    expect(changelogSection(markdown, '0.1.0')).toBe('- A');
    expect(changelogSection(markdown, '0.3.0')).toBeNull();
    expect(changelogSection('## [0.1.0]\n\n## [0.0.9]\n- x', '0.1.0')).toBeNull();
  });
  it('the current version has release notes that state what is unverified', () => {
    const section = changelogSection(readFileSync('CHANGELOG.md', 'utf8'), APP_VERSION);
    expect(section).toContain('確認できていないこと');
    expect(section).toContain('書込み');
  });
});
