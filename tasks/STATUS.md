# 現在の状態と今後の作業

更新: 2026-11-18（Asia/Tokyo）。過去の各フェーズの記録・検証ログは [docs/archive/status-history.md](../docs/archive/status-history.md)。

## 機能の状態

| 機能 | 状態 | 実NovelAI |
|---|---|---|
| ライブラリ・ワークスペース・範囲コメント・Undo | 実装・自動テスト済み | — |
| プリセット・タグ重み | 実装・自動テスト済み | — |
| A/B比較・PNG取込・画像比較 | 実装・自動テスト済み | NovelAI固有PNGメタデータは未対応 |
| Prompt Shuffle | 実装・自動テスト済み（Mock E2E） | 読取りとコピーのみ。書込み・キャラクター欄・生成検知は**無効** |
| Experiment Lab | 実装・自動テスト済み | 読取りとコピーのみ。設定の自動同期なし |
| 完全バックアップ（画像原本込みZIP） | **2026-11-18 追加**・自動テスト済み | — |
| サイトとの読取り | 実装（観測済みの単純なProseMirrorのみ） | 英語の公開ページ（2026-11-03）、日本語UIの構造（2026-11-19、issue #4）を確認。ログイン後の英語UIは未確認 |
| サイトへの書込み | fixtureのみ | **未検証・無効** |
| サイドパネル起動 | ツールバーボタンで開く（2026-11-18） | 実ボタンのクリックは手動確認待ち |

## 2026-11-18の変更（監査・品質改善）

1. **シャッフルのサイト状態の分離**: 反映前原文・最後の書込み・状態不明の欄を（タブ, ドキュメント, プロファイル）単位に分離。タブAの原文がタブBのRestoreに使われ得た不具合を修正。
2. **自動シャッフルの安全停止**: 開始時に設定全体を固定し、変更・外部のカーソル変更・保存エラーで停止。停止後に新しい書込みを始めない。送信済みの書込みは記録。
3. **生成ジョブカウント**: 開始時に生成中だったジョブを数えていた不具合を修正。
4. **handler**: 書込み開始後の失敗を常に `WRITE_FAILED` に。広いタブ（`sidepanel.html#lab`）からの読取りが拒否されていた不具合を修正。
5. **完全バックアップ/復元**: ZIP（manifest・data.json・画像原本・サムネイル）、検証→プレビュー→1トランザクションで復元、Undo可能。
6. **UX**: ツールバーボタンでサイドパネル（popup廃止、最小のbackground）、別画面の保存通知、タブ順の整理・キーボード操作、初回ガイド、「広いタブで開く」。
7. **性能**: 保存時の全ストア読込みと二重検証をなくした（2,000件で1編集 約74ms→約33ms、fake-indexeddb上）。
8. **文書**: READMEを利用者向けに再構成。development / security / backup / release-checklist / SECURITY / PRIVACY（草案）を追加。codex・完了済みタスク・旧ログをアーカイブ。

## 検証結果（2026-11-18）

環境: Linux（WSL2）、Node 24.21.0、pnpm 10.34.5、Playwright 1.64.1 Chromium。E2Eは共有ライブラリ（libnspr4/libnss3/libasound2t64）を作業用ディレクトリに展開して実行（OSへのインストールなし）。

| コマンド | 作業開始時 | 作業後 |
|---|---|---|
| `corepack pnpm install --frozen-lockfile` | PASS（lockfile変更なし） | PASS（lockfile・依存の変更なし） |
| `corepack pnpm test` | 333 PASS / 0 FAIL（18ファイル） | 418 PASS / 0 FAIL（23ファイル） |
| `corepack pnpm typecheck` | PASS | PASS |
| `corepack pnpm build` | PASS | PASS（permissions は `sidePanel` のみ、background追加） |
| `corepack pnpm test:e2e` | 53 PASS / 0 FAIL | 62 PASS / 0 FAIL |

E2EはすべてMock（ローカルfixture、または `https://novelai.net/**` を模擬HTMLに差し替えた実content script）。**実NovelAIでの確認は実施していない。**

## 今後の作業

評価: 価値・コスト・リスクは 高/中/低。

### P1（公開前に必要）

| 作業 | 価値 | コスト | リスク | 備考 |
|---|---|---|---|---|
| 拡張アイコン（16/32/48/128px）の作成 | 高 | 低 | 低 | Chrome Web Storeで必須。NovelAIの意匠を模倣しない |
| Windows/macOSのChromeで手動確認（サイドパネル起動・別プロファイル復元・高DPI） | 高 | 中 | 低 | 手順は release-checklist |
| GitHub設定（branch protection、private vulnerability reporting） | 中 | 低 | 低 | 設定はメンテナーが実施 |
| NovelAIサポートへの拡張機能公開の問い合わせ | 高 | 低 | 低 | 規約は拡張機能に言及なし（[security.md](../docs/security.md)）。一般公開前に推奨 |
| PRIVACY.md草案の確定 | 中 | 低 | 低 | ストア申請時に必須 |

### P2（品質・使い勝手）

| 作業 | 価値 | コスト | リスク | 備考 |
|---|---|---|---|---|
| Undo履歴の構造共有（全コピー31世代をやめる） | 中 | 中 | 中 | 2,000件で約42MiB、10MiB上限付近で約310MiB。`validateData` の複製方針の見直しが必要 |
| 差分保存（変更レコードだけput） | 中 | 中 | 中 | 実ChromeのIndexedDBで計測してから判断 |
| 完全バックアップの「追加」で同一画像を共有するデータの統合（ID付け替え） | 中 | 中 | 中 | 現在はエラーで中止 |
| UIのi18n整理（Labの日英切替を全体へ） | 中 | 高 | 低 | |
| Experiment Lab・比較の詳細画面の整理（説明のInfoTip化・段階的表示） | 中 | 中 | 低 | 2026-11-20に主要画面は整理済み（ADR-085） |
| 大きな画面（Lab・比較）の部品共通化、狭い幅での表の操作性 | 中 | 中 | 低 | |
| 別画面の保存を、未編集時に自動で読み込むオプション | 低 | 低 | 中 | 現在は明示操作（Undo履歴が消えるため） |

### P3（実機検証が前提・将来）

| 作業 | 価値 | コスト | リスク | 備考 |
|---|---|---|---|---|
| 実NovelAIの書込みprofile（ProseMirror）の検証と有効化 | 高 | 高 | 高 | 手順は [DOM_ADAPTER_CHECKLIST.md](../docs/DOM_ADAPTER_CHECKLIST.md)。確認できなければ無効のまま |
| キャラクター欄・モデル表示・生成完了の実機調査 | 中 | 中 | 高 | 一意なジョブIDが無ければ自動検知は実装しない |
| NovelAI固有PNGメタデータの解析 | 中 | 中 | 中 | 公式に保存された実サンプルが必要 |
| ZIP64（2GiB超）の完全バックアップ | 低 | 中 | 中 | |

## 決定事項（2026-11-18）

- ライセンス: MIT（`LICENSE`）。
- 一部コミットの作者メール: 問題なし（履歴は書き換えない）。
- NovelAI利用規約: 拡張機能への言及なし。読取り・コピーのみの現行機能を維持し、書込み・自動化の実サイト対応は無効のまま（[security.md](../docs/security.md)）。
