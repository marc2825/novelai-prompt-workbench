// Prints the GitHub Release notes for a version: a fixed header (unofficial,
// install/update pointers) followed by that version's CHANGELOG.md section.
//   node scripts/release-notes.mjs 0.1.0 [sha256]
// Fails when CHANGELOG.md has no "## [<version>]" section, so a release cannot be
// published without written notes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { changelogSection, isPrerelease, zipName } from './release-lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const [version, digest] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) { console.error('usage: node scripts/release-notes.mjs X.Y.Z [sha256]'); process.exit(1); }
const section = changelogSection(readFileSync(`${root}CHANGELOG.md`, 'utf8'), version);
if (!section) { console.error(`✖ CHANGELOG.md has no "## [${version}]" section`); process.exit(1); }
const repository = 'https://github.com/marc2825/novelai-prompt-workbench';
process.stdout.write(`> **非公式ツールです。** NovelAI（Anlatan Inc.）とは提携していません。NovelAIの利用規約を守ってご利用ください。${isPrerelease(version) ? '\n> v0.x はベータ版（Pre-release）です。' : ''}

## インストール・更新

1. 下の Assets から \`${zipName(version)}\` をダウンロードして展開します。**「Source code (zip)」「Source code (tar.gz)」はGitHubが自動で付けるソースコードで、そのままでは読み込めません。**
2. Chromeの \`chrome://extensions\` で「デベロッパーモード」をONにし、「パッケージ化されていない拡張機能を読み込む」で展開したフォルダ（\`manifest.json\` があるフォルダ。Windowsで拡張子が非表示の場合は \`manifest\` と表示されます）を選びます。

**更新するときは、必ず前回と同じフォルダの中身を置き換えてください**（別のフォルダから読み込むと別の拡張機能として扱われ、保存したデータが表示されません）。更新の前に「設定」→「完全バックアップ」を保存してください。自動更新はありません。詳しい手順: [docs/install.md](${repository}/blob/v${version}/docs/install.md)

${section}
${digest ? `\n## チェックサム\n\n\`\`\`\n${digest}  ${zipName(version)}\n\`\`\`\n` : ''}`);
