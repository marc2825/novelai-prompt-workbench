# P2: NovelAIサイト連携 + 任意範囲コメント

実施前: `AGENTS.md` と `docs/DOM_ADAPTER_CHECKLIST.md` を読み、ログインユーザーの実サイトのDOMを**実機で確認できる場合のみ**書込アダプタを実装。実サイトへアクセスできないなら、DOM Adapter interface、ローカルの模擬HTML fixture、未対応時copy fallbackまで実装し、実DOM書込はTODOのままにする（推測したセレクタを入れない）。

## 仕様

1. Content scriptはNovelAIの画像生成ページだけで動作。サイドパネルから明示送信したpositive/negativeを受け取る。型検証・タブ/オリジン確認。
2. Adapterは capability detection→read current→diff confirmation→compare-and-swap書込→readback verification。曖昧/未検出/途中変更なら失敗。自動Generate禁止。
3. UIに `反映` と `コピー` を分ける。無効時は理由を示す。
4. 範囲コメントアウトは `docs/PROMPT_SEMANTICS.md` に従う。原文を内部spanに保存し、ON/OFFとUndo/Redoで完全復元。複雑構文・曖昧な区切り境界では破損する変換を行わず警告。
5. site integrationテストはMock DOM + 実サイトで分ける。実機なしなら正直に未検証と報告。

## 完了条件

AC13/AC14、曖昧DOMに書き込まないこと、OFF原文復元、コピーfallback、P1回帰を確認。`tasks/STATUS.md`を更新。
