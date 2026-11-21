# 開発環境・テスト・ビルド

## 必要なもの

- Node.js 22.12以上（開発時の実測は24.21.0、CIはNode 22）
- pnpm 10.34.5（`corepack pnpm` で固定版を使用。Node.js 25以降はCorepackが同梱されないため `npm install -g pnpm@10.34.5` で入れ、`corepack pnpm` を `pnpm` に読み替え）
- E2E: Playwright 1.64.1 の Chromium

## コマンド

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test        # Vitest（単体・統合、tests/unit）
corepack pnpm typecheck   # tsc --noEmit（strict）
corepack pnpm build       # WXT → .output/chrome-mv3
corepack pnpm test:e2e    # Playwright（tests/e2e）。buildの成果物を読むため必ずbuild後に実行
corepack pnpm zip         # 配布用ZIP → .output/novelai-prompt-workbench-<version>-chrome.zip
corepack pnpm fixture     # 手動確認用のVite開発サーバ http://127.0.0.1:4173
```

完了前に `test` → `typecheck` → `build` → `test:e2e` の4つを実行し、件数を報告します（CIも同じ順序）。

### ローカルfixture

- `http://127.0.0.1:4173/tests/fixtures/index.html` — サイトなしのUI（コピー・手動記録の経路）
- `http://127.0.0.1:4173/tests/fixtures/site.html` — React制御の模擬サイト2タブ（101/202）＋UI。`TextareaAdapter` と合成プロファイルで書込み・キャラクター欄・生成状態を再現します。**実NovelAIの検証ではありません。**

E2Eは `node scripts/serve-fixture.mjs` でfixtureを一度ビルドし（`.output/e2e-fixture`）、静的ファイルとして配信します（Playwrightの `webServer`。corepack・pnpmは不要）。Vite開発サーバは1ページで数百のモジュールを配信するため、低リソース環境では再読込を含むテストが `ERR_INSUFFICIENT_RESOURCES` / EMFILE で失敗することがありました（issue #4）。ビルド配信は1ページ数ファイルです（E2Eは1ワーカーで順に実行）。

fixtureはReactの開発ビルド（`NODE_ENV=development`）で作るため、StrictModeの検査と、検証済みデータの深い凍結（誤って書き換えると例外）が有効です。製品ビルドでは無効です。`corepack pnpm fixture`（開発サーバ）が4173番で動いている場合、E2Eはそれを再利用します。

### E2Eの種類

| 種類 | ファイル | 内容 |
|---|---|---|
| Mock E2E（fixture） | `workbench`, `presets`, `comparisons`, `weights`, `site`, `shuffle`, `lab`, `backup` | UI・保存・模擬サイトへの書込みフロー |
| 実拡張E2E | `extension.spec.ts` | `.output/chrome-mv3` をunpackedで読み込み、manifest・再起動後の保持・実content script。`https://novelai.net/**` はPlaywrightで模擬HTMLに差し替え、実サイトへは通信しない |

Mock E2Eや模擬HTMLでの成功を、実NovelAIでの動作確認として報告しないでください。

### Chromiumの共有ライブラリが無い環境（root権限なし）

`libnspr4.so` などが見つからずChromiumが起動しない場合、OSにインストールせず作業用ディレクトリに展開します。

```bash
mkdir -p "$SCRATCH/libs" && cd "$SCRATCH/libs"
apt-get download libnspr4 libnss3 libasound2t64
for f in *.deb; do dpkg -x "$f" root; done
LD_LIBRARY_PATH="$SCRATCH/libs/root/usr/lib/x86_64-linux-gnu" corepack pnpm test:e2e
```

## 配置

```text
entrypoints/
  sidepanel/          React UI（サイドパネル・広いタブ・fixture共通）
  novelai.content.ts  NovelAI画像ページのcontent script（読取り専用adapter）
  background.ts       ツールバーボタンでサイドパネルを開くだけのservice worker
src/
  core/               純粋なドメイン（DOM・Chrome API・時計・乱数なし）。shuffle/ lab/ を含む
  data/               永続化・検証・移行・JSON/ZIPの入出力・バックアップ
  platform/novelai/   NovelAI依存（セレクタ・プロトコル・handler）はここだけ
  ui/                 React表示とコマンド（アルゴリズムを置かない）
  version.ts          バージョンの単一の定義（manifest・バックアップ。package.jsonと一致をテスト）
tests/unit/           Vitest（perf/ は性能計測用データ）
tests/e2e/            Playwright
tests/fixtures/       fixtureページ・合成PNG・旧DB
scripts/              E2E用fixtureの配信（serve-fixture.mjs）、アイコンの原本と描き出し（icon/, render-icons.mjs）
public/               配布物にそのままコピー（THIRD_PARTY_NOTICES.txt、icon/）
```

詳細な設計は [ARCHITECTURE.md](ARCHITECTURE.md)、データ形式は [DATA_MODEL.md](DATA_MODEL.md) と [backup.md](backup.md)、安全方針は [security.md](security.md)。

## 性能の目安

`tests/unit/perf.test.ts` が100/500/2,000件のライブラリで「コミット（検証）→保存」「読込」を計測してログに出します（fake-indexeddb上の参考値。実Chromeでは異なる）。

2026-11-18の計測（Node 24 / fake-indexeddb）:

| 件数 | JSON | 検証 | 1編集の検証+保存 | 読込 | Undo履歴（31世代） |
|---|---|---|---|---|---|
| 100 | 67 KiB | 1.7 ms | 2.8 ms | 1.9 ms | 約2 MiB |
| 500 | 374 KiB | 6.8 ms | 11.0 ms | 9.6 ms | 約11 MiB |
| 2,000 | 1.4 MiB | 18.0 ms | 33.0 ms | 25.7 ms | 約42 MiB |

最適化前は1編集あたり検証が2回（コミット時と保存時）、保存時に全ストアの読込みがあり、2,000件で約74 ms（検証25 ms＋保存49 ms）でした。

## テストの出力

スクリーンショットやダウンロードを保存するE2Eは、Playwrightのテストごとの出力先（`test-results/`、git管理外）に書き込みます。OSの一時ディレクトリのパスを直接書かないでください（Windowsで動かないため）。

## CI

`.github/workflows/ci.yml` が push・pull request で4つのチェックを実行します。トークンは `contents: read`、Actionはコミットのフルハッシュで固定（コメントにタグ）し、`.github/dependabot.yml` が月1回まとめて更新PRを作ります。npm依存はセキュリティ更新のPRだけ（リポジトリ設定の Dependabot security updates が有効な場合）。

## ライセンス表示

配布物には `LICENSE.txt`（`wxt.config.ts` の `build:publicAssets` でルートの `LICENSE` をコピー）と `public/THIRD_PARTY_NOTICES.txt`（バンドルされる React・React DOM・scheduler・Viteのpreload helper・WXTの実行時コードのライセンス表示）を同梱します。実行時の依存を追加・更新したら `THIRD_PARTY_NOTICES.txt` を更新してください（`tests/unit/release.test.ts` が依存の一覧とライセンス本文・バージョンの不一致を検出します）。

## アイコン

原本は `scripts/icon/icon.svg`（48・128px用）と `scripts/icon/icon-small.svg`（16・32px用、ピクセルに合わせた簡略版）です。変更したら `node scripts/render-icons.mjs` で `public/icon/<サイズ>.png` を再生成します（PlaywrightのChromiumを使用）。WXTが `public/icon/` から `manifest.icons` を自動で設定します。NovelAIのロゴや意匠に似せないでください。

## リリース

1. `src/version.ts` と `package.json` の `version` を同時に更新（テストで一致を確認）。`CHANGELOG.md` の Unreleased を版番号にする。
2. 4つのチェック → `corepack pnpm zip`。
3. ZIPの中身が `manifest.json`・`background.js`・`sidepanel.html`・`assets/`・`chunks/`・`content-scripts/`・`LICENSE.txt`・`THIRD_PARTY_NOTICES.txt` だけであることを確認（fixture・テスト・source mapを含まない。`extension.spec.ts` も検証）。
4. 手動確認項目は [release-checklist.md](release-checklist.md)。
