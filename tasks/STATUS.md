# 現在の状態と今後の作業

更新: 2026-11-21。

## 機能の状態

| 機能 | 状態 | 実NovelAI |
|---|---|---|
| ライブラリ・ワークスペース・範囲コメント・Undo | 実装・自動テスト済み | — |
| プリセット・タグ重み | 実装・自動テスト済み | — |
| A/B比較・PNG取込・画像比較 | 実装・自動テスト済み | NovelAI固有PNGメタデータは未対応 |
| Prompt Shuffle | 実装・自動テスト済み（Mock E2E） | 読取りとコピーのみ。書込み・キャラクター欄・生成検知は**無効** |
| Experiment Lab | 実装・自動テスト済み | 読取りとコピーのみ。設定の自動同期なし |
| 完全バックアップ（画像原本込みZIP） | 実装・自動テスト済み | — |
| サイトとの読取り | 実装（観測済みの単純なProseMirrorのみ、英語・日本語） | 英語は公開ページで確認（2026-11-03）。日本語は実ページの構造報告（2026-11-19、issue #4）を模擬ページで再現して検証。修正後の実ページでの再確認・ログイン後の英語UIは未確認 |
| サイトへの書込み | fixtureのみ | **未検証・無効** |
| サイドパネル起動 | ツールバーボタンで開く | 実ボタンのクリックは手動確認待ち |
| UI（ホバー説明・段階的表示） | 実装・自動テスト済み（400px幅のスクリーンショットで目視確認） | 実ブラウザ（Windows/macOS・高DPI）での目視は未実施 |

## 検証結果（最新）

2026-11-21、Linux（WSL2）、Node 24.21.0、pnpm 10.34.5、Playwright 1.64.1 Chromium。E2Eは共有ライブラリ（libnspr4/libnss3/libasound2t64）を作業用ディレクトリに展開して実行（OSへのインストールなし）。

| 検査 | 結果 |
|---|---|
| `corepack pnpm install --frozen-lockfile` | PASS（lockfile・依存の変更なし） |
| `corepack pnpm test` | 423 PASS / 0 FAIL（24ファイル） |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm build` | PASS（permissions は `sidePanel` のみ） |
| `corepack pnpm test:e2e` | 64 PASS / 0 FAIL（Mock E2E） |
| `corepack pnpm audit` | 既知の脆弱性 0件（実行時・開発時とも） |
| Gitleaks 8.30.1（全コミット・作業ツリー） | 検出なし |
| 配布ZIPの内容 | 拡張機能のファイル＋`LICENSE.txt`・`THIRD_PARTY_NOTICES.txt`のみ。source map・テスト・fixtureなし |
| Markdownの相対リンク・アンカー | 切れなし |

E2EはすべてMock（ローカルfixture、または `https://novelai.net/**` を模擬HTMLに差し替えた実content script）。**実NovelAIのログイン後の環境での確認は実施していない。** 変更の経緯は [CHANGELOG.md](../CHANGELOG.md)・[docs/DECISIONS.md](../docs/DECISIONS.md)、過去の検証ログは [docs/archive/status-history.md](../docs/archive/status-history.md)。

## 既知の制限

- 実NovelAIへの書込み・ログイン後UIのキャラクター欄・生成検知は未検証のため無効。読取りは英語（公開ページで確認）・日本語（実ページの構造報告を模擬ページで再現して検証、修正後の実ページでの再確認は未実施）のみ。
- サイドパネルと広いタブを同時に開き、両方で編集すると、後から保存した側が保存エラーになる（データは失われず、通知から最新を読み込めるほか、JSONで退避できる）。
- 元に戻す・やり直すは直近30操作まで。パネルを閉じると履歴は消え、NovelAIのページへの操作は戻らない。
- 完全バックアップは最大2GiB。「追加」モードで同じ画像を共有するデータは統合できない（全置換を使う）。
- 数千件規模のデータでは1回の編集ごとの保存に時間がかかり、元に戻す履歴が多くのメモリを使う（目安は [docs/development.md](../docs/development.md#性能の目安)）。
- そのほかシャッフルの制約は [docs/shuffle/limitations.md](../docs/shuffle/limitations.md)。

## 今後の作業

評価: 価値・コスト・リスクは 高/中/低。

### P1（配布前に必要）

| 作業 | 価値 | コスト | リスク | 備考 |
|---|---|---|---|---|
| Windows/macOSのChromeで手動確認（サイドパネル起動・別プロファイル復元・高DPI） | 高 | 中 | 低 | Releases配布の前に。手順は [release-checklist](../docs/release-checklist.md) |
| NovelAIサポートへの問い合わせ | 高 | 低 | 低 | 規約は拡張機能に言及なし（[security.md](../docs/security.md)）。Chrome Web Store公開の前に推奨。質問案は release-checklist |
| ストア用の連絡先・掲載文・スクリーンショット（アイコンは2026-11-21に作成済み） | 中 | 中 | 低 | 連絡先はメンテナーが決定（PRIVACY.mdはGitHub Issuesを窓口として記載） |

### GitHubの設定（2026-11-21に設定済み）

| 設定 | 状態 |
|---|---|
| Description・Topics | 設定済み（`chrome-extension`, `manifest-v3`, `novelai`, `prompt-engineering`, `prompt-manager`, `side-panel`, `react`, `typescript`, `wxt`, `local-first`） |
| Private vulnerability reporting | 有効 |
| Dependabot alerts・security updates | 有効（npmはセキュリティ更新のみ、Actionsは月1回まとめて更新。初回の更新PR #8 は公式タグとの一致を確認してマージ済み） |
| Secret scanning・Push protection | 有効 |
| `main` のルールセット「Protect main」 | 有効: ブランチ削除と force push を禁止。CI成功の必須化は付けていない（付けると `main` への直接pushができなくなるため。PR経由の運用に限定するなら追加可） |
| Actions の権限 | 既定トークンは読取りのみ、PRの承認不可、初回コントリビューターのPRは承認後に実行（変更なし） |

### P2（品質・使い勝手）

| 作業 | 価値 | コスト | リスク | 備考 |
|---|---|---|---|---|
| Undo履歴の構造共有（全コピー31世代をやめる） | 中 | 中 | 中 | 2,000件で約42MiB、10MiB上限付近で約310MiB。`validateData` の複製方針の見直しが必要 |
| 差分保存（変更レコードだけput） | 中 | 中 | 中 | 実ChromeのIndexedDBで計測してから判断 |
| 完全バックアップの「追加」で同一画像を共有するデータの統合（ID付け替え） | 中 | 中 | 中 | 現在はエラーで中止 |
| UIのi18n整理（Labの日英切替を全体へ） | 中 | 高 | 低 | |
| Experiment Lab の設定画面の整理（生成設定・軸の段階的表示） | 中 | 中 | 低 | シャッフル・比較・ワークスペースは2026-11-21に整理済み。Labは軸の説明と容量欄のみ |
| 大きな画面（Lab・比較）の部品共通化、狭い幅での表の操作性 | 中 | 中 | 低 | |
| 別画面の保存を、未編集時に自動で読み込むオプション | 低 | 低 | 中 | 現在は明示操作（Undo履歴が消えるため） |

### P3（実機検証が前提・将来）

| 作業 | 価値 | コスト | リスク | 備考 |
|---|---|---|---|---|
| 実NovelAIの書込みprofile（ProseMirror）の検証と有効化 | 高 | 高 | 高 | 手順は [DOM_ADAPTER_CHECKLIST.md](../docs/DOM_ADAPTER_CHECKLIST.md)。確認できなければ無効のまま |
| キャラクター欄・モデル表示・生成完了の実機調査 | 中 | 中 | 高 | 一意なジョブIDが無ければ自動検知は実装しない |
| NovelAI固有PNGメタデータの解析 | 中 | 中 | 中 | 公式に保存された実サンプルが必要 |
| ZIP64（2GiB超）の完全バックアップ | 低 | 中 | 中 | |

## 決定事項

- ライセンス: MIT（`LICENSE`、2026-11-18）。配布物に `LICENSE.txt` と `THIRD_PARTY_NOTICES.txt` を同梱（2026-11-21）。
- リポジトリはPublic（2026-11-21時点）。コミット作者のメールアドレスの公開はメンテナーが許容済み（履歴は書き換えない）。
- NovelAI利用規約: 拡張機能への言及なし。読取り・コピーのみの現行機能を維持し、書込み・自動化の実サイト対応は無効のまま（[security.md](../docs/security.md)）。
