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
11. NovelAI公式「novelai-image-metadata」（MIT License、Copyright (c) 2023 NovelAI）— `README.md`・`nai_meta.py`・`nai_meta_writer.py` を2026-11-22に確認: https://github.com/NovelAI/novelai-image-metadata 。PNGテキストのキー（Title / Description / Software / Source / Generation time / Comment、Commentは文字列のJSON）と、アルファチャンネルの形式（最下位ビットを列優先で8ビットずつ、`stealth_pngcomp`・32ビットのビット長・gzip圧縮JSON、任意の誤り訂正データ）を参照し、この拡張では同じ形式を独自に実装した（コードの複製ではない）。**実際にNovelAIで保存したPNGのサンプルは入手できておらず、`Comment` 内の各項目（prompt・uc・seed・steps・scale・sampler等）の意味は公式に文書化されていないため未検証**。拡張はこれらを「候補」としてだけ表示する（ADR-099）。

これらは実装時にも再確認。DOMセレクタ、実行可能API、自動化の許可、PNGメタデータ内の各項目の意味などは**ここでは検証済みとしない**（PNGの入れ物の形式は11の公式スクリプトで確認）。
