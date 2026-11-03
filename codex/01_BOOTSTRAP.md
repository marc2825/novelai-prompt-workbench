# P0: リポジトリ基盤とビルド

## 指示

`AGENTS.md`、README、要件定義書を読んだ後、WXTの生成manifestを確認しつつReact sidepanelが動く最小基盤を構築する。WXT 0.21+を想定するが、依存互換が取れなければ必要最小限だけ更新する。

1. `pnpm install` → lockfile生成、`pnpm test`、`pnpm typecheck`、`pnpm build`成功。
2. `.output/chrome-mv3/manifest.json`で不要なサイト権限がないこと、sidepanel/contentのentrypointを確認。
3. テスト/型検査/ビルドをCIに追加（lockfileありで`--frozen-lockfile`）。
4. `docs/DECISIONS.md`に実際の版と選定理由を追記。
5. `tasks/STATUS.md`更新。

## 完了条件

- 実測コマンドの成功。
- Chromeにunpacked loadできる成果物が生成される（ブラウザで動かした場合のみ「起動検証済」と記載）。
- NovelAIへ副作用を発生させるコードは未導入。
