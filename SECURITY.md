# Security Policy / セキュリティ報告

## 報告方法（非公開）

脆弱性は **公開のIssue・Pull Request・Discussionに書かないでください。** GitHubの非公開の脆弱性報告を使ってください。

- [Report a vulnerability（新しい非公開の報告を作成）](https://github.com/marc2825/novelai-prompt-workbench/security/advisories/new)
- 画面からは: リポジトリの **Security** タブ → **Report a vulnerability**

報告に含めてほしいもの: 影響する機能、再現手順、想定される影響、確認したバージョンまたはコミット（`chrome://extensions` の詳細画面のバージョン、または `main` のコミット）。

報告に含めないでください: 実際のパスワード・Cookie・トークンなどの認証情報、個人的なプロンプトや生成画像、他人の個人情報。再現にはダミーのデータを使ってください。

報告を受け取ったら内容を確認し、非公開のまま修正方針をやり取りします。修正の公開後、必要に応じてGitHub Security Advisoryとして公開します（個人で保守しているため、対応時間は保証できません）。

## 対象

- このリポジトリのコード（`src/`, `entrypoints/`, `scripts/`, `.github/`）と、そこからビルドした拡張機能
- 例: 取込ファイル（JSON・完全バックアップZIP・PNG）の検証の不備、NovelAIページとのメッセージ検証の不備、意図しないページ書込み・外部通信・データ消失、権限の過剰

NovelAIのサービス自体の脆弱性は、NovelAIに報告してください。

## サポートするバージョン

| バージョン | 対応 |
|---|---|
| 最新の [GitHub Release](https://github.com/marc2825/novelai-prompt-workbench/releases)（0.2.0 ベータ）と `main` ブランチ | 修正対象 |
| それより前のリリース・過去のコミット | 対象外（最新のリリースに更新してください） |

安全性の設計（権限、メッセージ検証、取込データの扱い）は [docs/security.md](docs/security.md) を参照してください。
