# 公開・配布チェックリスト

GitHubで公開中のリポジトリを、GitHub Releases・Chrome Web Storeで配布する前に確認する事項です。最終更新: 2026-11-21。チェックした項目は日付と根拠を残してください。

## 1. GitHub公開（Public・公開中）

### 確認済み

- [x] 秘密情報なし: Gitleaks 8.30.1 で全ブランチ・全コミット（マージを除く11件）と作業ツリーを検査し検出なし。手動でも履歴中のバイナリ・`.env`・ローカルパス・内部IP・個人情報を確認（2026-11-21）。Issue・PR・コメントにも該当なし
- [x] 履歴にバイナリ・画像・個人的なプロンプトなし（テスト用PNGはコードで合成。デモデータは汎用のサンプル）
- [x] コミット作者のメールアドレスは、メンテナーが公開を許容済み（対応不要）
- [x] ライセンス: MIT（`LICENSE`、`package.json`）。依存はすべて許容的なライセンス
- [x] セキュリティ報告: Private vulnerability reporting を有効化（2026-11-21）、[SECURITY.md](../SECURITY.md)
- [x] CI: `contents: read`、Actionをハッシュ固定、`persist-credentials: false`、Dependabot設定（`.github/dependabot.yml`）
- [x] Issue/PRテンプレート、[CONTRIBUTING.md](../CONTRIBUTING.md)、[PRIVACY.md](../PRIVACY.md)

### GitHubの設定（2026-11-21に設定済み）

- [x] Description・Topics
- [x] Dependabot alerts / Dependabot security updates / Secret scanning・Push protection
- [x] `main` のルールセット（削除・force push の禁止。CI成功の必須化は運用に合わせて任意）

詳細は [tasks/STATUS.md](../tasks/STATUS.md) の「GitHubの設定」。

## 2. GitHub Releases での配布（未実施）

- [ ] `src/version.ts` と `package.json` のバージョンを決めて更新（テストで一致を確認）
- [ ] `CHANGELOG.md` の Unreleased をバージョン番号に置き換える
- [ ] 4つのチェック（test・typecheck・build・test:e2e）→ `corepack pnpm zip`
- [ ] ZIPの中身が `manifest.json`・`background.js`・`sidepanel.html`・`assets/`・`chunks/`・`content-scripts/`・`LICENSE.txt`・`THIRD_PARTY_NOTICES.txt` だけであることを確認（`extension.spec.ts` も検証）
- [ ] 下の「手動確認」の主要項目を、配布するZIPで実施
- [ ] リリースノートに「非公式」「書込みは無効」「実NovelAIで確認した範囲」を明記

## 3. Chrome Web Store での一般公開（未実施）

- [ ] **アイコンがない**（manifestに `icons` なし。16/32/48/128px が必要）。NovelAIのロゴ・配色を模倣しない独自デザインにする
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

## 手動確認項目（実機・未実施）

自動テストでは確認できない項目です。実施日・Chromeのバージョン・結果を記録してください。

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

- [ ] 画像生成ページで「NovelAIの接続を確認」→ 対象タブ選択 → Positive/Negativeの読取りが一致する。**表示言語ごと**に確認する（英語: 公開ページで確認済み。日本語: 構造を外部レビューで確認し模擬ページで検証済み、実ページでの再確認は未実施。ログイン後の英語UI: 未確認）
- [ ] 装飾・マクロを含むプロンプトは「推測しません」と表示され、読み取らない
- [ ] 書込みボタンが無効のままで、サイトの入力・生成に影響しない
- [ ] シャッフルの「キャラクター欄: 0個（書込み不可）」「生成検知: 非対応」表示、コピーと手動記録で運用できる

書込みを有効にする場合の調査手順は [DOM_ADAPTER_CHECKLIST.md](DOM_ADAPTER_CHECKLIST.md) と [shuffle/site-adapter.md](shuffle/site-adapter.md)。
