# 外部仕様の参照（2026-11-03調査）

1. NovelAI公式「プロンプトチャンク」 — @検索、カテゴリ、マクロ、サーバー保存、PNGには展開文字列だけ: https://docs.novelai.net/ja/image/promptchunks/
2. NovelAI公式FAQ — 公式保存ボタンで保存した画像のみ設定メタデータが残り得る（右クリック保存/クリップボードでは残らない）: https://docs.novelai.net/en/faq/
3. NovelAI Terms — 未承認のアクセス、自動化、負荷をかける利用等の制約: https://novelai.net/terms
4. NovelAI Image API docs — API公開は自動化の包括的許諾を意味しない: https://image.novelai.net/docs/index.html
5. Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
6. Chrome Extension Storage/IndexedDB: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
7. WXT docs — Side Panel/entrypoints: https://wxt.dev/guide/essentials/entrypoints
8. WXT docs — React module: https://wxt.dev/guide/essentials/frontend-frameworks
9. WXT docs — Manifest/permissions: https://wxt.dev/guide/essentials/config/manifest
10. Codex AGENTS.md official: https://learn.chatgpt.com/docs/agent-configuration/agents-md

これらは実装時にも再確認。DOMセレクタ、実行可能API、自動化の許可、正確なPNGキーなどは**ここでは検証済みとしない**。
