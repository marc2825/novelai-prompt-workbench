# 開発環境・テスト・ビルド

## 必要なもの

- Node.js 22.12以上（開発時の実測は24.21.0、CIはNode 22）
- pnpm 10.34.5（`corepack pnpm` で固定版を使用。Node.js 25以降はCorepackが同梱されないため `npm install -g pnpm@10.34.5` で入れ、`corepack pnpm` を `pnpm` に読み替え）
- E2E: Playwright 1.64.1 の Chromium

## ソースからビルドして使う

```bash
git clone https://github.com/marc2825/novelai-prompt-workbench.git
cd novelai-prompt-workbench
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

`chrome://extensions` でデベロッパーモードをONにし、「パッケージ化されていない拡張機能を読み込む」で `.output/chrome-mv3` を選びます。更新は `git pull` → 同じ手順でビルド → `chrome://extensions` で再読み込みです。`.output/chrome-mv3` とReleases版の置き場所フォルダは別の拡張機能として扱われ、データは共有されません（移すときは完全バックアップ → 復元）。

## コマンド

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test        # Vitest（単体・統合、tests/unit）
corepack pnpm typecheck   # tsc --noEmit（strict）
corepack pnpm build       # WXT → .output/chrome-mv3
corepack pnpm test:e2e    # Playwright（tests/e2e）。buildの成果物を読むため必ずbuild後に実行
corepack pnpm zip         # 配布用ZIP → .output/novelai-prompt-workbench-<version>-chrome.zip
corepack pnpm fixture     # 手動確認用のVite開発サーバ http://127.0.0.1:4173
corepack pnpm bench:chromium  # 実Chromiumでの性能計測（任意。下記「性能の目安」）
```

完了前に `test` → `typecheck` → `build` → `test:e2e` の4つを実行し、件数を報告します（CIも同じ順序）。

### ローカルfixture

- `http://127.0.0.1:4173/tests/fixtures/index.html` — サイトなしのUI（コピー・手動記録の経路）
- `http://127.0.0.1:4173/tests/fixtures/site.html` — React制御の模擬サイト2タブ（101/202）＋UI。`TextareaAdapter` と合成プロファイルで書込み・キャラクター欄・生成状態を再現します。**実NovelAIの検証ではありません。**

E2Eは `node scripts/serve-fixture.mjs` でfixtureを一度ビルドし（`.output/e2e-fixture`）、静的ファイルとして配信します（Playwrightの `webServer`。corepack・pnpmは不要）。Vite開発サーバは1ページで数百のモジュールを配信するため、低リソース環境では再読込を含むテストが `ERR_INSUFFICIENT_RESOURCES` / EMFILE で失敗することがありました（issue #4）。ビルド配信は1ページ数ファイルです（E2Eは1ワーカーで順に実行）。

fixtureはReactの開発ビルド（`NODE_ENV=development`）で作るため、StrictModeの検査が有効です（製品ビルドでは無効）。検証済みデータの深い凍結（誤って書き換えると例外）は製品ビルドを含むすべてのビルドで有効です（ADR-105）。`corepack pnpm fixture`（開発サーバ）が4173番で動いている場合、E2Eはそれを再利用します。

### E2Eの種類

| 種類 | ファイル | 内容 |
|---|---|---|
| Mock E2E（fixture） | `workbench`, `presets`, `comparisons`, `weights`, `site`, `shuffle`, `lab`, `backup` | UI・保存・模擬サイトへの書込みフロー |
| リリースZIPのE2E | `release.spec.ts` | `wxt zip` のZIPを展開して読み込み、再起動後の保持・同じフォルダへの更新でのデータ保持・別フォルダでは別の拡張機能になることを確認 |
| 実拡張E2E | `extension.spec.ts` | `.output/chrome-mv3` をunpackedで読み込み、manifest・再起動後の保持・実content script。`https://novelai.net/**` はPlaywrightで模擬HTMLに差し替え、実サイトへは通信しない |

Mock E2Eや模擬HTMLでの成功を、実NovelAIでの動作確認として報告しないでください。

複数の作業ツリー（git worktree）で同時にE2Eを実行するときは、`E2E_PORT=4174 corepack pnpm test:e2e` のように検証用サーバーのポートを分けてください（既定は4173。同じポートだと別の作業ツリーのサーバーを使い回します）。

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
tests/perf/           実Chromiumでの性能計測（`pnpm bench:chromium`。通常のテストに含まない）
tests/e2e/            Playwright
tests/fixtures/       fixtureページ・合成PNG・旧DB
scripts/              E2E用fixtureの配信（serve-fixture.mjs）、アイコン（icon/, render-icons.mjs）、リリースの検証とノート生成（verify-release.mjs, release-notes.mjs, release-lib.mjs）
public/               配布物にそのままコピー（THIRD_PARTY_NOTICES.txt、icon/）
```

詳細な設計は [ARCHITECTURE.md](ARCHITECTURE.md)、データ形式は [DATA_MODEL.md](DATA_MODEL.md) と [backup.md](backup.md)、安全方針は [security.md](security.md)。

## 性能の目安

### 実Chromiumでの計測（`corepack pnpm bench:chromium`）

`tests/perf/chromium.bench.spec.ts`（設定は `playwright.bench.config.ts`）が、PlaywrightのChromium（実際のブラウザエンジン。市販のChromeはコマンドラインからunpacked拡張機能を読み込めないため使わない）でfixtureページを開き、開発用ビルドにだけある `window.__workbenchBench`（`src/ui/useWorkbench.ts`。拡張機能のビルドには含まれないことを `extension.spec.ts` が確認）から操作して計測します。通常の `test`・`test:e2e` には含まれません。

```bash
corepack pnpm bench:chromium                                        # 100/500/2,000件・上限付近
BENCH_SIZES=2000,limit BENCH_LABEL=after corepack pnpm bench:chromium  # データを選ぶ・結果に名前を付ける
```

`E2E_PORT`、共有ライブラリが無い環境の `LD_LIBRARY_PATH`（上記）はE2Eと同じです。fixtureを一度ビルドして配信するため、`build` は不要です。結果は表で標準出力に、JSON（各回の生の値と環境を含む）で `test-results/bench-chromium-<BENCH_LABEL>.json`（git管理外。次のE2Eの実行で消える）に出ます。

- データ: 100/500/2,000件（ワークスペース1/2/10個・各20グループ×10部品、プリセット1/5/20個。レコード323/2,052/8,650）と上限付近（5,000件・ワークスペース5・プリセット15、原文を伸ばして9.5MiB・9,435レコード。上限は10MiB・10,000レコード）。アプリのcommitで保存し、再読込してから計測します。
- 検証: 1件を変えた入力の `validateData`（毎回のcommitで実行）。commit: アプリの `commit()` の同期部分（検証・Undo履歴・保存の予約）。
- 入力1文字→描画: ワークスペースの自由入力を1文字変えるcommit（入力欄は1文字ごとにcommit）から次のフレームまで。
- 編集→保存完了: ライブラリ1件の編集のcommitから、その保存トランザクションの完了まで（続けて「保存済み」の表示を確認）。31回の中央値で、読込直後の1回目は別に記録します。
- 保存（単体）: Reactを通さず、別DBで `WorkbenchRepository.save` を続けて実行。全件保存: `load()` の直後の保存（全レコードを書く）。読込: `load()`。
- ヒープ: CDP `HeapProfiler.collectGarbage` の後の `performance.memory.usedJSHeapSize`（`--enable-precise-memory-info`）。読込直後と、31回の編集（元に戻す30段階＝上限）の後の差。

2026-11-22の計測。環境: Linux（WSL2、カーネル6.6）、Intel Core i7-12700F（20スレッド）、メモリ8GiB、Node 24.21.0、Playwright 1.64.1のChromium 156.0.8078.4（new headless）。fixtureはReactの開発ビルドなので、描画を含む値は製品ビルドより大きめです。2回の実行の平均（ADR-105の前 → 後）:

| データ | 検証 | commit | 入力1文字→描画 | 編集→保存完了 | 保存（単体） | 元に戻す30段階のヒープ増加 |
|---|---|---|---|---|---|---|
| 100件（0.1MiB） | 0.9 → 0.6 ms | 1.2 → 0.8 ms | 12.1 → 13.1 ms | 8.4 → 4.6 ms | 3.5 → 0.7 ms | 1.9 → 0.1 MiB |
| 500件（0.4MiB） | 5.2 → 4.2 ms | 6.2 → 4.2 ms | 25.6 → 19.4 ms | 26.9 → 9.2 ms | 15.6 → 0.9 ms | 11.0 → 0.2 MiB |
| 2,000件（1.7MiB） | 23.8 → 16.9 ms | 24.4 → 16.6 ms | 62.2 → 31.4 ms | 95.2 → 23.9 ms | 64.4 → 1.4 ms | 46.2 → 0.3 MiB |
| 上限付近（9.5MiB） | 82.6 → 66.0 ms | 88.4 → 66.6 ms | 124.6 → 95.6 ms | 301.7 → 81.0 ms | 191.9 → 2.1 ms | 295.7 → 0.7 MiB |

全件を扱う処理はほぼ変わりません（2,000件 / 上限付近）: 読込直後の初回保存 121 → 113 ms / 316 → 303 ms、全件保存（単体）66 → 65 ms / 187 → 186 ms、読込（単体）37 → 38 ms / 148 → 127 ms、新規データ（読込・取込）の検証 23 → 23 ms / 90 → 70 ms、読込直後のヒープ 8.2 → 8.4 MiB / 16.6 → 16.7 MiB。参考: データ全体の `structuredClone` は 5.1 / 14.6 ms、深い凍結は 1.4 / 2.2 ms。

段階ごと（1回の実行、2,000件 / 上限付近）: 構造共有だけで検証 15.9 / 68.6 ms、ヒープ増加 1.2 / 1.2 MiB（保存は 63 / 184 ms のまま）。差分保存を加えて保存（単体）1.4 / 2.1 ms、編集→保存完了 24 / 81 ms。

前の版を計測するには、`git checkout <前のコミット> -- src/data` で `src/data` だけを戻して同じコマンドを実行し、`git checkout HEAD -- src/data` で戻します（計測用フックは `src/ui` にあるため）。

### 採用しなかったもの・今後

- 元に戻す単位の統合: 不採用。構造共有で30段階の増加が2,000件で0.3MiB、上限付近で0.7MiBになり、メモリのために統合する必要がなくなった。自由入力が1文字ごとに1段階になる点は操作性の問題で、必要なら別に扱う。
- Worker化: 現時点では不要。残る主な費用は毎回の全体検証（2,000件で約17ms、上限付近で約66ms）で、commitは検証結果を同期的に必要とする。Workerへ渡すには構造化複製（上限付近で約15ms）が往復で要り、効果が小さい。上限付近の入力（1文字あたり約0.1秒）を改善するなら、共有ノードの検査結果（安全なJSON・サイズ）を再利用する増分検証か、入力欄を確定時にcommitする方式を別のタスクで検討する。
- 仮想化: 不要。ライブラリと画像ライブラリはページ送りで、描画する件数はデータ量に比例しない。
- 遅延読み込み: 不要。起動時の読込は2,000件で約38ms、上限付近で約130ms。参照（カテゴリ・プリセット・画像）の検証に全データが必要なため、分割すると検証の保証が弱くなる。
- 読込直後の初回保存の差分化: 見送り。差分の基準は、同じ画面が自分で書いてコミットした状態だけにしている（ADR-105）。

### Node（fake-indexeddb）

`tests/unit/perf.test.ts` が同じ経路を100/500/2,000件で計測してログに出し、保存時に全ストアを読まない・再検証しない・元に戻す履歴が未変更の部品を共有することを構造的に検証します（fake-indexeddb上の参考値。実Chromeとは異なる）。

2026-11-22の計測（Node 24 / fake-indexeddb、ADR-105の後）:

| 件数 | JSON | 検証 | 1編集の検証+保存 | 読込 | 31世代の履歴が持つ部品 |
|---|---|---|---|---|---|
| 100 | 67 KiB | 0.9 ms | 1.6 ms | 2.7 ms | 130（全コピーなら3,100） |
| 500 | 374 KiB | 4.7 ms | 3.8 ms | 12.3 ms | 530（同15,500） |
| 2,000 | 1.4 MiB | 16.6 ms | 15.9 ms | 35.8 ms | 2,030（同62,000） |

2026-11-18（構造共有・差分保存の前）は2,000件で検証18.0 ms、1編集の検証+保存33.0 ms、元に戻す履歴は31世代の全コピーで約42MiB（JSONの大きさからの推定）でした。その前は1編集あたり検証が2回（コミット時と保存時）、保存時に全ストアの読込みがあり、2,000件で約74 ms（検証25 ms＋保存49 ms）でした（ADR-077）。

## テストの出力

スクリーンショットやダウンロードを保存するE2Eは、Playwrightのテストごとの出力先（`test-results/`、git管理外）に書き込みます。OSの一時ディレクトリのパスを直接書かないでください（Windowsで動かないため）。

## CI

`.github/workflows/ci.yml` が push・pull request で4つのチェックを実行します。トークンは `contents: read`、Actionはコミットのフルハッシュで固定（コメントにタグ）し、`.github/dependabot.yml` が月1回まとめて更新PRを作ります。npm依存はセキュリティ更新のPRだけ（リポジトリ設定の Dependabot security updates が有効な場合）。

`.github/workflows/security.yml`（「Security」）が、週1回（月曜 03:17 UTC）・手動・`main` へのPRとpushで、依存関係の監査（`pnpm audit`）、PRの依存関係レビュー（脆弱性・ライセンス）、Gitleaksによる全履歴の秘密情報の検査、CodeQLによるコードとワークフローの静的解析を行います。`ci.yml` とは別のワークフローで、リリース（`release.yml`）の経路には入りません。開発用ツールの新しい勧告ではPRを止めず、週1回の実行で失敗させます。方針・失敗したときの対応・ローカルでの再現方法は [security.md](security.md#セキュリティ検査ci) にあります。Actionと同じくGitleaksの版もハッシュで固定しており、Dependabotの対象外なので手動で更新します（同じ節）。

## ライセンス表示

配布物には `LICENSE.txt`（`wxt.config.ts` の `build:publicAssets` でルートの `LICENSE` をコピー）と `public/THIRD_PARTY_NOTICES.txt`（バンドルされる React・React DOM・scheduler・Viteのpreload helper・WXTの実行時コードのライセンス表示）を同梱します。実行時の依存を追加・更新したら `THIRD_PARTY_NOTICES.txt` を更新してください（`tests/unit/release.test.ts` が依存の一覧とライセンス本文・バージョンの不一致を検出します）。

## アイコン

原本は `scripts/icon/icon.svg`（48・128px用）と `scripts/icon/icon-small.svg`（16・32px用、ピクセルに合わせた簡略版）です。変更したら `node scripts/render-icons.mjs` で `public/icon/<サイズ>.png` を再生成します（PlaywrightのChromiumを使用）。WXTが `public/icon/` から `manifest.icons` を自動で設定します。NovelAIのロゴや意匠に似せないでください。

## リリース

リリースは `vX.Y.Z` 形式のタグのpushで `.github/workflows/release.yml` が自動で作成します。タグのpushとリリースの公開はメンテナーの判断で行います（エージェントは明示的な許可なしに行わない）。

ワークフローの流れ（どれかが失敗するとリリースは作られません）:

1. `ci` — 通常のCI（`ci.yml` を呼び出し）: 単体テスト・型検査・ビルド・E2E。リリースがこの検査を迂回することはありません。
2. `package`（読取り専用トークン）— タグのコミットが `main` 上にあることを確認 → `pnpm zip` → `node scripts/verify-release.mjs --tag <タグ>` → リリースノート生成 → 成果物をワークフローのartifactに保存。
3. `publish`（このジョブだけ `contents: write`。プロジェクトのコードは実行しない）— artifactのSHA-256を照合し、`gh release create` でZIPと `.sha256` を添付。v0.x は Pre-release として公開。

`verify-release.mjs` が確認する内容: `package.json`・`src/version.ts`・ビルドしたmanifest・タグのバージョンが一致、ZIPの直下に `manifest.json`、許可したファイルだけ（source map・テスト・fixture・想定外のファイルなし）、`LICENSE.txt`・`THIRD_PARTY_NOTICES.txt`・アイコン4種あり、権限は `sidePanel` のみ、content scriptはNovelAIの画像生成ページのみ、認証情報らしき文字列なし。

リリースノートは `CHANGELOG.md` の `## [X.Y.Z]` の節から作ります（節が無いと失敗）。確認できていないこと・制限もその節に書きます。

### 手順

1. `src/version.ts` と `package.json` の `version` を更新する（単体テストが一致を確認）。
2. `CHANGELOG.md` の `## [Unreleased]` の内容を `## [X.Y.Z]` の節にまとめる。
3. PRでmainにマージし、CIと「Security」ワークフローの成功、Security タブに未対応の警告がないことを確認する（リリースのワークフローはSecurityの検査を実行しない）。
4. 手動確認（[release-checklist.md](release-checklist.md)）。事前にZIPを確認したい場合は、Actions の「Release」→「Run workflow」（dry run。ZIPを検証してartifactに保存するだけで、リリースは作らない）を使う。
5. `git tag vX.Y.Z <mainのコミット>` → `git push origin vX.Y.Z`。
6. Actions の「Release」が成功したら、Releases ページで内容を確認する。

ローカルでの確認: `corepack pnpm zip && node scripts/verify-release.mjs`（`.output/` にZIPと `.sha256`）。`tests/e2e/release.spec.ts` は、実際にZIPを展開して読み込み、再起動後のデータ保持と、同じフォルダへの更新でデータが保たれることを確認します。
