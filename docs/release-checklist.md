# 公開前チェックリスト

2026-11-18時点の監査結果と、公開前に人が判断・確認すべき事項です。チェックの済んだ項目は理由とともに記録してください。

## 自動確認済み（このリポジトリで再現可能）

- [x] `permissions: ["sidePanel"]` のみ、host_permissionsなし、content scriptは `https://novelai.net/image*` のみ（`extension.spec.ts` が検証）
- [x] ツールバーボタンでサイドパネルを開く設定（`getPanelBehavior().openPanelOnActionClick === true` を実Chromiumで確認）
- [x] 配布ZIPにテスト・fixture・source mapを含まない（`corepack pnpm zip` の中身を確認）
- [x] リポジトリ・Git履歴に秘密情報（APIキー・トークン・秘密鍵）なし（`git log -p` を検索）
- [x] 実行時依存（React）に既知の脆弱性なし。開発用ツールの `picomatch` ReDoSは配布物外（[security.md](security.md)）
- [x] CI（GitHub Actions）は main / PR で test・typecheck・build・E2E を実行し成功している

## 公開前に決めること（未完了）

### ライセンス（決定済み）

- [x] **MIT**（2026-11-18、メンテナー決定）。`LICENSE` と `package.json` の `license` を追加。依存（React・WXT等、MIT）と両立する。

### NovelAI利用規約（確認済み・要フォロー）

- [x] 利用規約（Effective: December 8th, 2025）を確認。ブラウザ拡張については**言及なし**（許可も禁止もしていない）。関係しうる条項と対応は [security.md](security.md#novelai利用規約との関係2026-11-18確認)
- [ ] Chrome Web Storeで一般公開する前に、NovelAIサポートへ拡張機能の公開について問い合わせる（推奨）
- [ ] リリースごとに規約の改定を確認する
- [x] 「NovelAIの利用規約が優先される」旨をREADME・PRIVACY・画面フッター・AGENTS.md・security.mdに明記（2026-11-19）

### 名前・説明・アイコン

- [ ] 名称 `NovelAI Prompt Workbench (unofficial)` が第三者の商標の利用条件に抵触しないか確認（ストア掲載では「非公式」「提携なし」を明記）
- [ ] **アイコンが無い**（manifestに `icons` なし）。Chrome Web Storeは128px等のアイコンが必須。NovelAIのロゴ・配色を模倣しない独自デザインを用意
- [ ] 説明文（日本語/英語）、スクリーンショット
- [ ] バージョン方針（0.x ベータ → 1.0）

### Git履歴・GitHub設定（この作業では変更していない）

- [x] 一部コミットの作者メールが個人アドレスである件: メンテナーが「問題なし」と判断（2026-11-18）。履歴は書き換えない
- [ ] リポジトリは現在 **Private**。公開設定はメンテナーが判断
- [ ] `main` に **branch protection / ruleset なし**。推奨: PR必須、CI（`check` ジョブ）成功必須、force push禁止
- [ ] Private vulnerability reporting を有効化（[SECURITY.md](../SECURITY.md)）
- [ ] GitHub Actions: `actions/checkout@v4` 等をタグ指定。公開時はコミットSHA固定と `permissions: contents: read` の明示を推奨

### プライバシー・ストア申請

- [ ] [PRIVACY.md](../PRIVACY.md)（草案）に運営者名・連絡先・施行日を記入し、公開URLを用意
- [ ] Chrome Web Storeの「データの使用」申告: 収集なし・送信なし。単一用途の説明（NovelAI画像生成用プロンプトのローカル管理）
- [ ] 権限の正当化: `sidePanel`（UI表示）、content script（NovelAI画像ページのプロンプト欄の読取り）

## 手動確認項目（実機・未実施）

自動テストでは確認できない項目です。実施日・Chromeのバージョン・結果を記録してください。

### Windows / macOS の Chrome（最新安定版）

- [ ] `chrome://extensions` → デベロッパーモード → `.output/chrome-mv3` を読み込み、エラーが出ない
- [ ] ツールバーのボタンで**サイドパネル**が開く（ポップアップではない）。2回目以降・Chrome再起動後も同じ
- [ ] サイドパネルの幅を最小〜最大に変えて、タブ・ボタン・表が操作できる（400px前後）
- [ ] 「広いタブで開く」で同じデータが表示される。片方で保存すると他方に「別の画面での変更」通知が出て、読み込める
- [ ] データ入力 → Chrome完全終了 → 再起動で保持
- [ ] 完全バックアップZIPを保存 → **別のChromeプロファイル**に拡張を入れて復元 → 画像・比較・Lab・シャッフルが一致。ZIPを解凍ツール（Windows標準・7-Zip等）で開ける
- [ ] Windowsで日本語ファイル名のPNG、長いパスのダウンロード先での保存・取込
- [ ] 高DPI（125%/150%）表示で画像比較のズーム・パンが崩れない
- [ ] キーボードだけでタブ移動（←→ Home End）、Undo/Redo（Ctrl+Z/Y）、主要ボタンの操作ができる

### NovelAI実サイト（ログイン後、読取りのみ）

- [ ] 画像生成ページで「NovelAIの接続を確認」→ 対象タブ選択 → Positive/Negativeの読取りが一致する（装飾・マクロを含む場合は「推測しません」と表示される）
- [ ] 書込みボタンが無効のままで、サイトの入力・生成に影響しない
- [ ] シャッフルの「キャラクター欄: 0個（書込み不可）」「生成検知: 非対応」表示、コピーと手動記録で運用できる

書込みを有効にする場合の調査手順は [DOM_ADAPTER_CHECKLIST.md](DOM_ADAPTER_CHECKLIST.md) と [shuffle/site-adapter.md](shuffle/site-adapter.md)。
