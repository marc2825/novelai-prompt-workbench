# 公開・配布チェックリスト

GitHubで公開中のリポジトリを、GitHub Releases・Chrome Web Storeで配布する前に確認する事項です。最終更新: 2026-11-22。チェックした項目は日付と根拠を残してください。

## 1. GitHub公開（Public・公開中）

### 確認済み

- [x] 秘密情報なし: Gitleaks 8.30.1 で全ブランチ・全コミット（マージを除く11件）と作業ツリーを検査し検出なし。手動でも履歴中のバイナリ・`.env`・ローカルパス・内部IP・個人情報を確認（2026-11-21）。Issue・PR・コメントにも該当なし
- [x] 履歴にバイナリ・画像・個人的なプロンプトなし（テスト用PNGはコードで合成。デモデータは汎用のサンプル）
- [x] コミット作者のメールアドレスは、メンテナーが公開を許容済み（対応不要）
- [x] ライセンス: MIT（`LICENSE`、`package.json`）。依存はすべて許容的なライセンス
- [x] セキュリティ報告: Private vulnerability reporting を有効化（2026-11-21）、[SECURITY.md](../SECURITY.md)
- [x] CI: `contents: read`、Actionをハッシュ固定、`persist-credentials: false`、Dependabot設定（`.github/dependabot.yml`）
- [x] 定期的なセキュリティ検査: `.github/workflows/security.yml`（依存関係の監査・PRの依存関係レビュー・Gitleaksによる全履歴の検査・CodeQL）を追加（2026-11-22）。方針と失敗時の対応は [security.md](security.md#セキュリティ検査ci)
- [x] `security.yml` のGitHub上での初回実行が成功（2026-11-22、PR #40: 依存関係の監査・レビュー・Gitleaks・CodeQL すべてPASS）
- [x] Issue/PRテンプレート、[CONTRIBUTING.md](../CONTRIBUTING.md)、[PRIVACY.md](../PRIVACY.md)

### GitHubの設定（2026-11-21に設定済み）

- [x] Description・Topics
- [x] Dependabot alerts / Dependabot security updates / Secret scanning・Push protection
- [x] `main` のルールセット（削除・force push の禁止。CI成功の必須化は運用に合わせて任意）

詳細は [tasks/STATUS.md](../tasks/STATUS.md) の「GitHubの設定」。

## 2. GitHub Releases での配布（v0.1.0 を公開済み）

自動化済み（2026-11-21）:

- [x] `vX.Y.Z` タグのpushで、CI → ZIP生成 → 内容・バージョンの検証 → SHA-256 → リリース作成（v0.x は Pre-release）。手順は [development.md](development.md#リリース)
- [x] `package.json`・`src/version.ts`・manifest・タグのバージョン不一致、想定外のファイル（source map・テスト・fixture）、ライセンス表示やアイコンの欠落、権限の増加は検証で失敗する（`scripts/verify-release.mjs`、単体テストあり）
- [x] ZIPを展開して読み込み、再起動後のデータ保持と、同じフォルダへの更新でのデータ保持を確認（`tests/e2e/release.spec.ts`、Chromium）
- [x] リリースノートは `CHANGELOG.md` の該当バージョンの節から生成（確認できていないこと・制限を含む）
- [x] 利用者向けのインストール・更新手順（[install.md](install.md)、README）

初回 v0.1.0:

- [x] タグ `v0.1.0`（`cd1395f`）をpushし、Actions の「Release」（ci → package → publish）が成功。[Pre-releaseとして公開](https://github.com/marc2825/spellbinder-for-novelai/releases/tag/v0.1.0)（2026-11-21）
- [x] 公開されたZIPをダウンロードし、`.sha256` と一致、`verifyReleaseZip` の検査で問題0件（14ファイル）。SHA-256 `87e2c281…d2d9` はローカル・クリーンなclone・事前の試験実行のビルドと同一
- [ ] 下の「手動確認」の主要項目を実機で実施（少なくとも: ReleasesのZIPを展開して読み込み、サイドパネルが開く、保存・再起動後の保持、同じフォルダへの更新）。公開前の実機確認は未実施

v0.2.0（2026-11-22）:

- [x] PR #51 で版を0.2.0に更新（CHANGELOG `[0.2.0]`）。タグ前に Security タブの未対応の警告 0件（Code scanning・Dependabot・Secret scanning）を確認
- [x] タグ `v0.2.0`（`06b07d7`）をpushし、「Release」（ci → package → publish）が成功。[Pre-releaseとして公開](https://github.com/marc2825/spellbinder-for-novelai/releases/tag/v0.2.0)
- [x] 公開されたZIPを `.sha256` と照合し、`verifyReleaseZip` で問題0件（14ファイル、権限 `sidePanel` のみ）。SHA-256 `39fd5a0d…03d3` はローカルのビルドと同一
- [x] 公開版 v0.1.0 のZIPから同じフォルダで0.2.0に更新し、データが残ることを確認（手元のE2E、Cross-platformワークフローの Windows・macOS・Linux）
- [x] v0.1.0 のリリースノートに「Source code のZIPは読み込めない」の注意と、v0.2.0 への案内を追記（ZIP・タグは変更なし）
- [ ] 実機での手動確認（下記）は未実施

次のバージョンからの手順: `CHANGELOG.md` に `## [X.Y.Z]` を追加し、`package.json`・`src/version.ts` を更新してmainにマージ → `git tag vX.Y.Z` → `git push origin vX.Y.Z`（[development.md](development.md#リリース)）

タグを打つ前に: `main` の最新の「Security」ワークフロー（push時または週1回の実行）が成功していて、Security タブに未対応の Code scanning・Dependabot・Secret scanning の警告がないこと（ある場合は対応するか、[既知の例外](security.md#既知の例外)として記録する）。リリースのワークフロー自体はこの検査を実行しません。

## 3. Chrome Web Store での一般公開（未実施）

- [x] アイコン 16/32/48/128px（2026-11-21、独自デザイン: 青の角丸に部品のバー3本、下の1本がOFF。NovelAIのロゴ・意匠は不使用。原本は `scripts/icon/*.svg`、`node scripts/render-icons.mjs` で再生成）
- [ ] ストア掲載文（日本語/英語）・スクリーンショット。名称・説明に「非公式」「NovelAIとは提携していない」を明記
- [ ] プライバシーポリシーの公開URL（[PRIVACY.md](../PRIVACY.md) のGitHub上のURLで可）と、ストアの「データの使用」申告（収集なし）、単一用途の説明
- [ ] 権限の正当化: `sidePanel`（UI表示）、content script（NovelAI画像生成ページのプロンプト欄の読取り）
- [ ] 開発者アカウントの連絡先（ストアで必須。メンテナーが用意）
- [ ] NovelAIサポートへの確認（下記）

### NovelAIへの確認事項（推奨）

利用規約（2025-12-08施行、2026-11-21再確認）はブラウザ拡張機能に言及していません（[security.md](security.md#novelai利用規約との関係)）。一般公開の前に、次をNovelAIサポートに問い合わせることを推奨します。

1. NovelAIのページ上でプロンプト欄を**読み取るだけ**の非公式拡張機能を公開・配布してよいか
2. 利用者の明示的な操作でプロンプト欄に**書き込む**機能（現在は無効）を将来有効にすることに問題はないか
3. 拡張機能の名称・説明にサービス名「NovelAI」を使う際の条件（ロゴは使用しない）

回答を得るまで、書込み・自動化の実サイト対応は無効のままにします。

## 自動で確認している項目（Windows / macOS / Linux）

`.github/workflows/cross-platform.yml`（「Cross-platform」、週1回・手動・配布物に関わるPR）が、GitHubの Windows・macOS・Linux のランナーで、PlaywrightのChromiumを使って次を確認します（issue #35）。

- リリースZIPを展開したフォルダを読み込める、サイドパネルの「ツールバーのボタンで開く」設定が有効、データの保存・再起動後の保持
- 同じフォルダへの上書き更新でデータが残り、別のフォルダだと別の拡張機能になる
- **公開済みの最新リリースのZIP**（ダウンロード後に `.sha256` を照合）から、ビルドしたZIPへの同じフォルダでの更新で、データと拡張機能IDが残り、版が更新される
- 拡張機能のファイル構成・権限・アイコン、別のタブとの保存通知、NovelAIページの読取り（模擬ページ）

初回の結果（2026-11-22、PR #46・#50）: Windows（windows-2025）・macOS・Ubuntu で release・extension の7件 PASS。公開済み v0.1.0 のZIP（`.sha256` 一致）から同じフォルダへ更新してデータ保持を確認。

これは**Chromeそのもの（Google Chrome）ではなくChromium**での確認です。Google Chromeはコマンドラインからの未パッケージ拡張機能の読み込みに対応しないため、次の手動確認は残ります。

## 手動確認項目（実機・未実施）

自動テストでは確認できない項目です。実施日・Chromeのバージョン・結果を記録してください。未実施の項目を確認済みとして扱わないでください。

### Windows / macOS の Chrome（最新安定版）

- [ ] `chrome://extensions` で `.output/chrome-mv3` を読み込み、エラーが出ない
- [ ] ツールバーのボタンで**サイドパネル**が開く（ポップアップではない）。Chrome再起動後も同じ
- [ ] サイドパネルの幅を変えても、タブ・ボタン・「?」の説明・表が操作できる（400px前後）
- [ ] 「広いタブで開く」で同じデータが表示される。片方で保存すると他方に「別の画面での変更」通知が出て、読み込める
- [ ] データ入力 → Chrome完全終了 → 再起動で保持
- [ ] 完全バックアップZIPを保存 → **別のChromeプロファイル**で復元 → 画像・比較・Lab・シャッフルが一致。ZIPを解凍ツール（Windows標準・7-Zip等）で開ける
- [ ] Windowsで日本語ファイル名のPNG、長いパスのダウンロード先での保存・取込
- [ ] 高DPI（125%/150%）表示で画像比較のズーム・パン、説明の表示位置が崩れない
- [ ] キーボードだけでタブ移動（←→ Home End）、Undo/Redo（Ctrl+Z/Y）、主要ボタン・「?」の操作ができる

### NovelAI実サイト（ログイン後、読取りのみ）

手順・記録の仕方は [REAL_SITE_CHECK.md](REAL_SITE_CHECK.md)。結果はIssueの「実サイト確認の報告」フォームに記録します。

- [ ] 画像生成ページで「NovelAIの接続を確認」→ 対象タブ選択 → Positive/Negativeの読取りが一致する。**表示言語ごと**に確認する（英語: 公開ページで確認済み。日本語: 構造を外部レビューで確認し模擬ページで検証済み、実ページでの再確認は未実施。ログイン後の英語UI: 未確認）
- [ ] 装飾・マクロを含むプロンプトは「推測しません」と表示され、読み取らない
- [ ] 書込みボタンが無効のままで、サイトの入力・生成に影響しない
- [ ] シャッフルの「キャラクター欄: 0個（書込み不可）」「生成検知: 非対応」表示、コピーと手動記録で運用できる

書込みを有効にする場合の調査手順は [DOM_ADAPTER_CHECKLIST.md](DOM_ADAPTER_CHECKLIST.md) と [shuffle/site-adapter.md](shuffle/site-adapter.md)。
