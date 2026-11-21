# アーカイブ（開発履歴）

ここにあるファイルは**過去の開発フェーズの記録**で、現在の仕様ではありません。現在の仕様・制約は次を参照してください。

- 利用者向け: [README](../../README.md)
- 設計・データ・安全性: [ARCHITECTURE](../ARCHITECTURE.md) / [DATA_MODEL](../DATA_MODEL.md) / [backup](../backup.md) / [security](../security.md) / [DECISIONS](../DECISIONS.md)
- 機能別: [shuffle/](../shuffle/) / [lab/](../lab/) / [AB_COMPARISON](../AB_COMPARISON.md) / [PROMPT_SEMANTICS](../PROMPT_SEMANTICS.md)
- 現在の状態と今後の作業: [tasks/STATUS.md](../../tasks/STATUS.md)

| ファイル | 内容 | 保存理由 |
|---|---|---|
| `codex/00_FIRST_PROMPT.md`〜`06_HARDENING.md` | コーディングエージェントへのフェーズ別初期指示（P0〜P4） | 当時の要求と判断の経緯。要求事項はREQUIREMENTS / AGENTS / 各docsに統合済み |
| `tasks/P0_P1.md`〜`P4.md` | 完了済みフェーズのチェックリスト | 完了範囲の記録 |
| `status-history.md` | 2026-11-03〜11-18の実装ステータスと各回の検証ログ（件数・環境。作業用ディレクトリのパスは `<scratch>` に置換） | 過去の検証結果の記録。現在の検証結果は tasks/STATUS.md |

統合時に確認した、現在も有効な判断（各docsに反映済み）:

- 実NovelAIへの書込みは、ログイン後DOMとProseMirrorの内部状態を実機で検証するまで無効（codex/03 → DOM_ADAPTER_CHECKLIST、security）。
- NovelAI固有のPNGメタデータは公式に保存された実サンプルで確認するまで解析しない（codex/05 → AB_COMPARISON、README）。
- 自動生成・生成ボタンの操作・非公開API・トークン取得・無人キューは禁止（codex/05 → AGENTS、security）。
