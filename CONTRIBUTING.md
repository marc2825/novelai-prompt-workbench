# コントリビュートについて

Issue・Pull Requestを歓迎します。小さな修正でも構いません。

## はじめに

- この拡張機能は**非公式**です。[NovelAIの利用規約](https://novelai.net/terms)とNovelAIのルールが、このリポジトリのどの要件より優先されます。
- 次の変更は受け付けません: 画像生成の自動実行・生成ボタンの操作、NovelAIの非公開APIの呼出し、ログイン情報・Cookie・トークンの取得、外部へのデータ送信（解析・同期を含む）、実サイトで検証していないページ書込みの有効化。
- 脆弱性は公開Issueではなく[非公開の報告](SECURITY.md)を使ってください。
- Issue・PR・テストデータに、個人的なプロンプト・生成画像・認証情報を含めないでください（ダミーの文字列や合成PNGを使います）。

## 開発

手順は [docs/development.md](docs/development.md) にあります。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test && corepack pnpm typecheck && corepack pnpm build && corepack pnpm test:e2e
```

- 設計と境界: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（`src/core` は純粋関数、NovelAIのDOM依存は `src/platform/novelai/` だけ）
- 安全方針: [docs/security.md](docs/security.md)、データ形式と互換性: [docs/DATA_MODEL.md](docs/DATA_MODEL.md)・[docs/backup.md](docs/backup.md)
- UIの方針: [docs/UX_FLOWS.md](docs/UX_FLOWS.md)（説明は「?」の中へ、アクセシブルネームは一意に）
- コーディングエージェント向けの規約（人にも有用です）: [AGENTS.md](AGENTS.md)

## Pull Request

- 1つのPRは1つの目的に絞ってください。
- 不具合の修正には、可能なら先に失敗するテストを追加してください。既存のテストを削除・無効化して通すことはしないでください。
- ローカル模擬ページ（fixture）での結果を、実NovelAIで確認したこととして書かないでください。
- 実行時の依存を追加する場合は、その理由を書き、`public/THIRD_PARTY_NOTICES.txt` にライセンス表示を追加してください。

## ライセンス

コントリビュートした内容は、このリポジトリと同じ [MIT License](LICENSE) で提供されるものとします。
