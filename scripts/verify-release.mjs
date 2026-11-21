// Verifies the release ZIP produced by `pnpm zip` and writes its SHA-256 file.
//   node scripts/verify-release.mjs                 check versions + ZIP, write .sha256
//   node scripts/verify-release.mjs --tag v0.1.0    also require the Git tag to match
//   node scripts/verify-release.mjs --versions-only  only the version consistency checks
// Exits with code 1 and lists every problem when something is wrong.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkVersions, sha256, sourceVersionOf, verifyReleaseZip, zipName } from './release-lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
const tag = tagIndex >= 0 ? args[tagIndex + 1] : undefined;
const versionsOnly = args.includes('--versions-only');
const fail = problems => { for (const problem of problems) console.error(`✖ ${problem}`); process.exit(1); };

if (tagIndex >= 0 && !tag) fail(['--tag needs a value such as v0.1.0']);
const packageVersion = JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version;
const sourceVersion = sourceVersionOf(readFileSync(`${root}src/version.ts`, 'utf8'));
const versionProblems = checkVersions({ packageVersion, sourceVersion, tag });
if (versionProblems.length) fail(versionProblems);
console.log(`✔ versions agree: ${packageVersion}${tag ? ` (tag ${tag})` : ''}`);
if (versionsOnly) process.exit(0);

const zipPath = `${root}.output/${zipName(packageVersion)}`;
if (!existsSync(zipPath)) fail([`${zipPath} not found. Run "pnpm zip" first.`]);
const zip = readFileSync(zipPath);
const result = verifyReleaseZip(zip, packageVersion);
const manifestProblems = result.manifest ? checkVersions({ packageVersion, sourceVersion, manifestVersion: result.manifest.version }) : [];
if (result.problems.length || manifestProblems.length) fail([...result.problems, ...manifestProblems]);
const digest = sha256(zip);
writeFileSync(`${zipPath}.sha256`, `${digest}  ${zipName(packageVersion)}\n`);
console.log(`✔ ${zipName(packageVersion)}: ${result.files.length} files, ${zip.length} bytes`);
console.log(`✔ sha256 ${digest}`);
