# テスト計画と受入チェック

## 自動: pure domain (Vitest)

- C01 group disabled masks children without mutating their flags.
- C02 exclusive selects at most one; invalid memberId does not leak other entries.
- C03 multi returns only enabled items in exact order.
- C04 positive and negative remain separate.
- C05 raw syntax containing `{}`, `[]`, `::`, `|`, `!macro:...!`, Unicode preserved.
- C06 commas at entry boundaries do not corrupt custom raw content.
- C07 compile does not mutate input.
- C08 preset snapshots reproduce the same output even if library entry later changes.
- C09 comment-out and undo restore original string.
- C10 invalid JSON, duplicate IDs, oversized payload, unsupported schema version are rejected atomically.
- C11 import-export preserves IDs, titles, descriptions and raw text.
- C12 snapshot validation catches missing IDs; metadata unknown doesn't become confirmed.
- C13 optional 1000-item search benchmark (informational; do not hard fail slow CI).

## 統合: storage/UI (Playwright on local fixture)

- U01 Library CRUD persists after refresh.
- U02 Search by Japanese title, English raw, tags and category.
- U03 Checkbox toggles and exclusive radio work using keyboard and mouse.
- U04 Group off/on retains child choices.
- U05 Preset A→B→A restores A with no library side effects.
- U06 Preview/copy corresponds to compiled output.
- U07 Import invalid JSON displays non-destructive error.
- U08 AB images persist/compare; missing metadata marked unknown.

## NovelAI実サイト手動確認（ログインユーザーが実施）

- M01 Domain/path matches image generator only.
- M02 Positive/negative input fields can be identified unambiguously.
- M03 Existing prompt is read without mutation.
- M04 Write operation asks confirmation; only target field changes.
- M05 NovelAI React/state management keeps inserted value after blur and following rerender.
- M06 SPA navigation/remount and duplicate inputs yield safe fallback.
- M07 Button does **not** generate an image automatically.
- M08 Chrome extension disabled/re-enabled; previously saved library remains.
- M09 If adapter unsupported, copy remains available and user edit remains untouched.

## Acceptance

P1 must cover AC01〜AC12 except P3-specific AC10/11 (P3で実施); P2 AC13/14; P3 AC10/11/15/16/17. For any unmet acceptance criterion, leave TODO and explain in phase report rather than claiming completion.

## Reporting template

```text
Phase: P1
Implemented: ...
Tests: pnpm test (n passed), pnpm typecheck (pass/fail), pnpm build (pass/fail)
Manual tested: ...
Not tested: real NovelAI page (requires user account)
Open issues: ...
Next: ...
```

## P0/P1 自動テストの配置

- `tests/unit/compose.test.ts`: C01〜C07、排他の参照欠落・グループ非干渉・空override・境界カンマ。
- `tests/unit/commands.test.ts`: 選択・snapshot独立性・部品削除・安定IDでの順序・Undo/Redo・Unicode検索・1000件検索の参考計測。
- `tests/unit/backup.test.ts`: v1 fixture互換、全P1資産のroundtrip、未知安全フィールド、型/日時/UUID/参照/重複/危険キー/UTF-8サイズ/深さ/総件数の検証、merge/replace。
- `tests/unit/repository.test.ts`: 空DB、close/reopen、キー順によらない配列順復元、全削除後の取込、書込途中quota例外の全store rollback、stale write、破損dump/明示復旧、未知DB版拒否。
- `tests/e2e/workbench.spec.ts`: ローカルfixtureでU01/U03/U04/U06/U07とU02の日本語名検索、snapshot原本独立性、1000件検索と選択、保存失敗からの再試行、2パネル競合、破損起動からの復旧、HTML文字列の非実行、コピー失敗時の出力保持。9ケース。U02の原文・タグ・カテゴリ検索は単体テストで検証。
- `tests/e2e/extension.spec.ts`: 生成manifestの最小権限/entrypointを検査。Chromiumへunpacked loadし、拡張ページで保存→Chrome完全終了→再起動後にデータと出力を確認。1ケース。

`pnpm build`の後に`pnpm test:e2e`を実行する。fixtureサーバーは127.0.0.1のみ。P0/P1実測: Vitest **57件成功**、Playwright **10件成功**。性能数値・環境・未検証範囲は`tasks/STATUS.md`を参照。

C08/U05（プリセット）は下記P3で実装。U08（画像A/B）は未実装。実ChromeウィンドウでのSide Panelドッキング、手動拡張再有効化は未実施。スクリーンショット目視と自動ブラウザ操作は実サイトの手動検証に数えない。

## P2追加テストと実サイト調査の区別

- `tests/unit/comments.test.ts`: 原文不変、単純項目の先頭/中間/末尾/連続OFF、Unicode/特殊構文、再ON、Undo/Redo、span検証・保存/JSON復元・member/親OFF。
- `tests/unit/site.test.ts`: URL/メッセージ/sender検証、チャンネル別読取り、挿入/置換/空文字、prepare時非変更、CAS失敗、field token/selection変更、期限・再送拒否、document再読込・SPA、失敗readback、BUSY、複数タブ、通信timeout。
- `tests/e2e/site.spec.ts`: controlled React stateの更新とblur/rerender保持、確認キャンセル、片チャンネル/片タブだけ反映、未検出/曖昧/disabled、React拒否、write例外の復旧、原文・要素変更競合、再読込/SPA、範囲解除/Undo/保存復元、特殊構文拒否/全文OFF。生成ボタン未実行を確認。
- `tests/e2e/extension.spec.ts`のP2ケース: 本物のChrome tab 2個と製品content script/メッセージを使用。NovelAI URLへのアクセスはPlaywrightで模擬HTMLへ完全に差し替える。tabごとの読取り、query URL、hidden/visible重複、未知rich node、書込み不可、再読込・対象外ページの失敗、コピー利用可を確認。

自動テストは合計Vitest **102件**（既存57 + P2追加45）、Chromium **21件**（既存10 + P2追加11）。通常のE2Eから実NovelAIへの通信は行わない。

別途、公開NovelAI DOMを一時Chromiumで読取り専用調査し、生成済み拡張経由で空のPositive/Negativeを取得できた。非空rawの実エディタ内部stateとの一致、ログイン後UI、実サイトへの挿入/置換・blur/rerenderは未検証。M02/M03の限定的な自動読取り実測として記録し、M04〜M06を完了扱いにしない。詳しい観測構造と制限は`docs/DOM_ADAPTER_CHECKLIST.md`。

## P3プリセット追加

- `tests/unit/presets.test.ts`: AC10/AC11、deep snapshot、A/B/A、複数group・exclusive/multi/親OFF/順序/channel、dirty、1回Undo/Redo、rename/copy/overwrite/delete、辞書/作成元削除・変更、別workspaceのID再採番、P2 spanとv1/v2 JSON、scope/選択/binding/循環の異常系。
- `tests/unit/preset-storage.test.ts`: v1→v2、移行前バックアップ・旧metadata・順序・P2 span保持、新規v2、破損v1、backup/schema途中失敗の完全rollback、blocked upgrade、preset再開、presets store失敗の全store rollback。
- `tests/unit/recovery.test.ts`: 正常JSON/共有参照の原状保持、破損dumpの循環/BigInt/過深構造の診断markerと元オブジェクト不変。
- `tests/fixtures/legacy-db.ts`: P1/P2の正確なv1 store layoutをfake-IDB/Chromiumの両方へseedする。アプリ起動前に`blank.html`で準備する。
- `tests/e2e/presets.spec.ts`: 複数groupの適用preview/cancel/A/B/A/Undo、全CRUD/検索、参照診断、workspace削除後復元、span付きJSON復元/不正preset拒否、実Chromeのv1→v2と破損/循環v1の非破壊エラー・dump。
- 既存`extension.spec.ts`のChrome完全再起動ケースにpreset保存・binding・再読込を追加。実content scriptのwrite能力false、既存P1/P2の21 E2Eケースも維持。

現在の単体テストは129件（既存102 + 追加27）、ブラウザテストは27件（既存21 + 追加6）。future-versionテストは現在版+1、未対応資産テストはpresetsから未実装experimentsへ対象を更新し、元の拒否検証を維持している。実サイトwrite・画像・A/Bは完了扱いにしない。
