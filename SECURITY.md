# Security Policy / セキュリティ報告

## 報告方法

脆弱性は**公開Issueに書かず**、GitHubの非公開の脆弱性報告（Repository → Security → Report a vulnerability）から報告してください。

> メンテナー向け: 公開前に GitHub の Settings → Code security → **Private vulnerability reporting** を有効にしてください（現在は未設定）。有効にできない場合は、このファイルに別の連絡窓口を記載してください。

報告には、再現手順・影響範囲・使用したバージョン（拡張機能の詳細画面のバージョン）を含めてください。認証情報・実際のプロンプト・生成画像など個人的なデータは送らないでください。

## 対象

- この拡張機能のコード（`src/`, `entrypoints/`）と配布用ZIP
- 取込ファイル（JSON・完全バックアップZIP・PNG）の検証の不備、サイトとのメッセージ検証の不備、意図しない書込み・データ消失

NovelAIのサービス自体の脆弱性はNovelAIに報告してください。

## サポートするバージョン

最新のリリースのみ修正します（現在 0.x のベータ段階）。

設計上の安全方針は [docs/security.md](docs/security.md) を参照してください。
