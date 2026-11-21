# Changelog

このプロジェクトの利用者に関わる変更を記録します。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準じます。

## [Unreleased] — 0.1.0（未リリース）

GitHub Releases・Chrome Web Store ではまだ配布していません（ソースからビルドして利用）。

### 追加
- プロンプトのライブラリ、ワークスペース（グループ・排他/複数・範囲コメント）、プリセット、タグの重み調整
- Prompt Shuffle（役割・ポーズ・表情・カメラ・左右順の入れ替え、Seedで再現）
- 手動A/B比較（PNG取込・画像比較）、Experiment Lab（X/Y/Z条件表）
- 完全バックアップ（画像原本込みZIP）と検証付きの復元、JSONバックアップ
- NovelAI画像生成ページのプロンプト欄の読取り（英語・日本語表示。書込みは無効）
- ツールバーボタンでサイドパネルを開く、ホバー/フォーカスで表示する説明
- 配布物に `LICENSE.txt` と `THIRD_PARTY_NOTICES.txt` を同梱

### 安全性
- 権限は `sidePanel` のみ。外部通信・解析・同期なし。実NovelAIへの書込み・自動生成は無効
