// Shared by scripts/verify-release.mjs, scripts/release-notes.mjs and the tests.
// Plain Node (no dependencies): ZIP reading, release-content checks, version checks.
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const zipName = version => `spellbinder-for-novelai-${version}-chrome.zip`;

/** Files a release may contain. Anything else (source maps, tests, fixtures, dotfiles) fails verification. */
export const ALLOWED_FILE = /^(manifest\.json|sidepanel\.html|background\.js|LICENSE\.txt|THIRD_PARTY_NOTICES\.txt|icon\/(16|32|48|128)\.png|chunks\/[\w-]+\.js|content-scripts\/novelai\.js|assets\/[\w-]+\.css)$/;
export const REQUIRED_FILES = ['manifest.json', 'sidepanel.html', 'background.js', 'content-scripts/novelai.js', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'icon/16.png', 'icon/32.png', 'icon/48.png', 'icon/128.png'];
const FORBIDDEN_TEXT = [
  [/sourceMappingURL=/, 'source map reference'],
  [/data-workbench-fixture|controlled-fixture/, 'test fixture code'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bAKIA[0-9A-Z]{16}\b/, 'credential-like text'],
];
const CONTENT_SCRIPT_MATCHES = ['https://novelai.net/image', 'https://novelai.net/image/*', 'https://novelai.net/image?*'];

/** Minimal ZIP reader (stored and deflate entries, no ZIP64/encryption). Returns entries in archive order. */
export function readZip(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) if (bytes.readUInt32LE(at) === 0x06054b50) { end = at; break; }
  if (end < 0) throw new Error('not a ZIP file (end of central directory not found)');
  const total = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < total; index++) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10);
    const packed = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28), extraLength = bytes.readUInt16LE(at + 30), commentLength = bytes.readUInt16LE(at + 32);
    const header = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new Error(`encrypted ZIP entry: ${name}`);
    if (name.endsWith('/')) { entries.push({ name, directory: true, data: Buffer.alloc(0) }); continue; }
    if (bytes.readUInt32LE(header) !== 0x04034b50) throw new Error(`corrupt ZIP local header: ${name}`);
    const start = header + 30 + bytes.readUInt16LE(header + 26) + bytes.readUInt16LE(header + 28);
    const raw = bytes.subarray(start, start + packed);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw, { maxOutputLength: 64 * 1024 * 1024 }) : null;
    if (!data) throw new Error(`unsupported ZIP compression (${method}): ${name}`);
    if (data.length !== size) throw new Error(`ZIP size mismatch: ${name}`);
    entries.push({ name, directory: false, data });
  }
  return entries;
}

/**
 * Checks a release ZIP: manifest.json at the root (so the extracted folder loads in
 * Chrome directly), only allowed files, every required file, no source maps, fixtures
 * or credential-like text, minimal manifest permissions and the expected version.
 * Returns a list of problems (empty = OK).
 */
export function verifyReleaseZip(buffer, expectedVersion) {
  const problems = [];
  let entries;
  try { entries = readZip(buffer).filter(entry => !entry.directory); }
  catch (error) { return { problems: [String(error.message ?? error)], files: [], manifest: null }; }
  const names = entries.map(entry => entry.name);
  for (const name of names) {
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) problems.push(`unsafe path: ${name}`);
    else if (!ALLOWED_FILE.test(name)) problems.push(`unexpected file: ${name}`);
  }
  if (new Set(names).size !== names.length) problems.push('duplicate file names');
  for (const required of REQUIRED_FILES) if (!names.includes(required)) problems.push(`missing file: ${required}`);
  for (const entry of entries) {
    if (!/\.(js|css|html|json|txt)$/.test(entry.name)) continue;
    const text = entry.data.toString('utf8');
    for (const [pattern, label] of FORBIDDEN_TEXT) if (pattern.test(text)) problems.push(`${label} in ${entry.name}`);
  }
  for (const entry of entries) if (entry.name.endsWith('.png') && !entry.data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) problems.push(`not a PNG: ${entry.name}`);
  let manifest = null;
  const manifestEntry = entries.find(entry => entry.name === 'manifest.json');
  if (manifestEntry) {
    try { manifest = JSON.parse(manifestEntry.data.toString('utf8')); } catch { problems.push('manifest.json is not valid JSON'); }
  }
  if (manifest) {
    if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
    if (manifest.version !== expectedVersion) problems.push(`manifest version ${manifest.version} does not match ${expectedVersion}`);
    if (JSON.stringify(manifest.permissions) !== JSON.stringify(['sidePanel'])) problems.push(`permissions must be exactly ["sidePanel"], got ${JSON.stringify(manifest.permissions)}`);
    for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'externally_connectable', 'web_accessible_resources', 'content_security_policy', 'update_url', 'key']) if (manifest[key] !== undefined) problems.push(`manifest must not contain ${key}`);
    const scripts = manifest.content_scripts ?? [];
    if (scripts.length !== 1 || JSON.stringify([...(scripts[0]?.matches ?? [])].sort()) !== JSON.stringify(CONTENT_SCRIPT_MATCHES)) problems.push('content script must match only the NovelAI image page');
    if (JSON.stringify(manifest.icons) !== JSON.stringify({ 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' })) problems.push('manifest icons are incomplete');
    if (manifest.background?.service_worker !== 'background.js' || manifest.side_panel?.default_path !== 'sidepanel.html') problems.push('manifest entrypoints are unexpected');
    if (manifest.action?.default_popup !== undefined) problems.push('manifest must not define a popup');
  }
  return { problems, files: names, manifest };
}

/** Version consistency: package.json = src/version.ts (= manifest) (= tag without "v"). */
export function checkVersions({ packageVersion, sourceVersion, manifestVersion, tag }) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(String(packageVersion))) problems.push(`package.json version "${packageVersion}" is not X.Y.Z`);
  if (sourceVersion !== packageVersion) problems.push(`src/version.ts (${sourceVersion}) does not match package.json (${packageVersion})`);
  if (manifestVersion !== undefined && manifestVersion !== packageVersion) problems.push(`manifest version (${manifestVersion}) does not match package.json (${packageVersion})`);
  if (tag !== undefined) {
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) problems.push(`tag "${tag}" is not in the form vX.Y.Z`);
    else if (tag.slice(1) !== packageVersion) problems.push(`tag ${tag} does not match version ${packageVersion}`);
  }
  return problems;
}
export function sourceVersionOf(versionTs) {
  return /export const APP_VERSION = '([^']+)'/.exec(versionTs)?.[1] ?? null;
}
/** v0.x releases are betas and published as pre-releases. */
export const isPrerelease = version => version.startsWith('0.');

/** The body of the `## [version]` section of CHANGELOG.md, or null when there is none. */
export function changelogSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(line => line.startsWith('## ') && line.includes(`[${version}]`));
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}
