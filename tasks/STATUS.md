# 現在の状態と今後の作業

更新: 2026-11-22。

## 機能の状態

| 機能 | 状態 | 実NovelAI |
|---|---|---|
| ライブラリ・ワークスペース・範囲コメント・Undo | 実装・自動テスト済み | — |
| タグ辞書・入力補完・表記ゆれの候補 | 実装・自動テスト済み（2026-11-22） | — |
| プリセット（保存履歴・タグ単位の差分）・タグ重み | 実装・自動テスト済み | — |
| A/B比較・PNG取込・画像比較・画像ライブラリ（一括取込・評価・タグ） | 実装・自動テスト済み | NovelAIのPNG情報は公式の入れ物の形式で読み、**未確認の候補**として表示。実際にNovelAIで保存したPNGでは未確認 |
| Prompt Shuffle | 実装・自動テスト済み（Mock E2E） | 読取りとコピーのみ。書込み・キャラクター欄・生成検知は**無効** |
| Experiment Lab | 実装・自動テスト済み | 読取りとコピーのみ。設定の自動同期なし |
| 完全バックアップ（画像原本込みZIP・任意の暗号化）・未保存の変更の復元 | 実装・自動テスト済み | — |
| サイトとの読取り | 実装（観測済みの単純なProseMirrorのみ、英語・日本語） | 英語は公開ページで確認（2026-11-03）。日本語は実ページの構造報告（issue #4）を模擬ページで再現して検証。ログイン後の英語UI・修正後の日本語UIは**未確認**（手順は [REAL_SITE_CHECK.md](../docs/REAL_SITE_CHECK.md)） |
| サイトへの書込み | fixtureのみ | **未検証・無効** |
| サイドパネル起動 | ツールバーボタンで開く | 設定値をWindows・macOS・LinuxのChromiumで自動確認。実ボタンのクリックは手動確認待ち |
| GitHub Releases配布 | タグのpushで自動公開。リリースZIPのインストール・同じフォルダへの更新・公開版からの更新を Windows・macOS・Linux で自動確認 | v0.2.1（名前を Spellbinder for NovelAI に変更）を Pre-release として公開済み（2026-11-22、[Release](https://github.com/marc2825/spellbinder-for-novelai/releases/tag/v0.2.1)、SHA-256 `df6bcc2c…3390` はローカルのビルドと同一）。v0.2.0・v0.1.0 は旧名 |
| UI（4つの領域・広いタブの2列表示・ホバー説明） | 実装・自動テスト済み（400px・1280px幅のスクリーンショットで目視確認） | Google Chrome・高DPIでの目視は未実施 |

## 検証結果（最新）

2026-11-22、Linux（WSL2）、Node 24.21.0、pnpm 10.34.5、Playwright 1.64.1（Chromium 156）。E2Eは共有ライブラリ（libnspr4/libnss3/libasound2t64）を作業用ディレクトリに展開して実行（OSへのインストールなし）。

| 検査 | 結果 |
|---|---|
| `corepack pnpm test` | 668 PASS / 0 FAIL |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm build` | PASS（permissions は `sidePanel` のみ） |
| `corepack pnpm test:e2e` | 79 PASS / 1 SKIP / 0 FAIL（Mock E2E。SKIPは `PREVIOUS_RELEASE_ZIP` 未設定時の公開版からの更新テストで、手元ではv0.1.0のZIPを指定して PASS を確認） |
| Cross-platform（GitHub Actions、2026-11-22） | Windows（windows-2025）・macOS・Ubuntu で release・extension の7件 PASS。公開済み v0.1.0 のZIP（`.sha256` 一致）からの同じフォルダでの更新でデータ保持を確認 |
| Security（GitHub Actions） | 依存関係の監査・依存関係のレビュー・Gitleaks（全履歴）・CodeQL（JavaScript/TypeScript・Actions）すべて PASS |
| `corepack pnpm audit` | 既知の脆弱性 0件（実行時・開発時とも） |
| 性能（`corepack pnpm bench:chromium`） | 2,000件で編集→保存済み 約24ms、Undo 30回のヒープ増加 約0.3MiB（[性能の目安](../docs/development.md#性能の目安)） |

E2EはすべてMock（ローカルfixture、または `https://novelai.net/**` を模擬HTMLに差し替えた実content script）。**実NovelAIのログイン後の環境での確認は実施していない。** 変更の経緯は [CHANGELOG.md](../CHANGELOG.md)・[docs/DECISIONS.md](../docs/DECISIONS.md)、過去の検証ログは [docs/archive/status-history.md](../docs/archive/status-history.md)。

## 既知の制限

- 実NovelAIへの書込み・ログイン後UIのキャラクター欄・生成検知は未検証のため無効。読取りは英語・日本語のみ。
- NovelAIのPNG情報は、項目の意味が公式に確認されていないため、生成条件として自動では使わない（候補として表示し、確認してから採用）。
- サイドパネルと広いタブを同時に開き、両方で編集すると、後から保存した側が保存エラーになる（データは失われず、通知から最新を読み込める。保存エラー中も未保存分を含む完全バックアップを保存できる）。他の画面が開いている間は「画像バイナリを整理」を実行できない。
- 元に戻す・やり直すは直近30操作まで。パネルを閉じると履歴は消える（未保存だった変更は次に開いたときに復元できる）。NovelAIのページへの操作は戻らない。
- 完全バックアップは最大2GiB。「追加」モードで同じ画像を共有するデータは統合できない（全置換を使う）。暗号化したバックアップはパスワードを忘れると復元できない。
- 上限（10MiB）付近のデータでは、入力欄の1文字ごとに約0.1秒かかる（毎回の全体検証）。
- そのほかシャッフルの制約は [docs/shuffle/limitations.md](../docs/shuffle/limitations.md)。

## 今後の作業

予定・保留は [ROADMAP.md](../ROADMAP.md) にまとめています。メンテナーが行う作業:

| 作業 | 備考 |
|---|---|
| 実NovelAIでの読取りの確認（英語・日本語、ログイン後） | [REAL_SITE_CHECK.md](../docs/REAL_SITE_CHECK.md)。結果はIssueの「実サイト確認の報告」へ |
| 実機での手動確認（実際のツールバーボタン・Google Chrome・高DPI・別プロファイルでの復元） | [release-checklist](../docs/release-checklist.md) |
| NovelAIサポートへの問い合わせ | Chrome Web Store公開・書込みの検討の前に推奨。質問案は release-checklist |
| ストア用の連絡先・掲載文・スクリーンショット | 連絡先はメンテナーが決定 |

### GitHubの設定（2026-11-21に設定済み）

| 設定 | 状態 |
|---|---|
| Description・Topics | 設定済み（`chrome-extension`, `manifest-v3`, `novelai`, `prompt-engineering`, `prompt-manager`, `side-panel`, `react`, `typescript`, `wxt`, `local-first`） |
| Private vulnerability reporting | 有効 |
| Dependabot alerts・security updates | 有効（npmはセキュリティ更新のみ、Actionsは月1回まとめて更新。初回の更新PR #8 は公式タグとの一致を確認してマージ済み） |
| Secret scanning・Push protection | 有効 |
| `main` のルールセット「Protect main」 | 有効: ブランチ削除と force push を禁止。CI成功の必須化は付けていない（付けると `main` への直接pushができなくなるため。PR経由の運用に限定するなら追加可） |
| Actions の権限 | 既定トークンは読取りのみ、PRの承認不可、初回コントリビューターのPRは承認後に実行（変更なし） |

## 決定事項

- ライセンス: MIT（`LICENSE`、2026-11-18）。配布物に `LICENSE.txt` と `THIRD_PARTY_NOTICES.txt` を同梱（2026-11-21）。
- リポジトリはPublic（2026-11-21時点）。コミット作者のメールアドレスの公開はメンテナーが許容済み（履歴は書き換えない）。
- NovelAI利用規約: 拡張機能への言及なし。読取り・コピーのみの現行機能を維持し、書込み・自動化の実サイト対応は無効のまま（[security.md](../docs/security.md)）。
