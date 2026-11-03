# P1: プロンプト辞書 + トグルコンポーザ

## 指示

今回の機能要件 FR01〜FR07 と受入 AC01〜AC09, AC12 を満たす。P2/P3の機能を先取りせず、将来追加できるデータモデルを採用する。

## 作業順

1. Core: `src/core` のimmutable compiler、group選択・トグル、snapshot、validationをテスト駆動で実装。Rawはカンマ分割しない。
2. Storage: IndexedDB repositoryを実装、library/workspaces/categories + schemaVersion + atomic writes。ブラウザを再起動して復元できるように。
3. Library UI: CRUD、日本語タイトル検索、タグ、カテゴリ、複製、削除確認、再編集。1000件で実用的な応答。
4. Workspace UI: create/rename/delete; positive/negative; multi/exclusive; group parent switch; member switch; reorder; preview; copy.
5. Export/import: schema-version JSON、内容プレビュー、merge/replace、atomic transactionとバリデーション、テスト。
6. Error states, keyboard handling, empty state. P1実装のcoverageをレポート。

## テストケース

- exclusive A→BでAが消え、Bのみ表示。
- group enabled off/onで選択Bが戻る。
- multiのON/OFF、negative分離、raw維持、削除した辞書のsnapshot維持。
- 不正JSONで永続データ無変更。日本語検索。
- 1000件で表示・検索可能。

## 完了条件

自動テスト+ビルド成功、Side Panelローカル操作可能、データの永続化確認。サイト連携なしで動く。
