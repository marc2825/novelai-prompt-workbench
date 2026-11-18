# Prompt Shuffle — テスト計画と網羅表

配置は既存規約に合わせる: Vitest は `tests/unit/shuffle/*.test.ts`（node環境、統合テストを含む）、Playwright は `tests/e2e/shuffle.spec.ts`（ローカルfixture）と `tests/e2e/extension.spec.ts`（ビルド済み拡張・実content script）。

```bash
corepack pnpm test          # Vitest（既存＋shuffle）
corepack pnpm typecheck
corepack pnpm build         # E2Eの前に必須（extension.spec が .output を読む）
corepack pnpm test:e2e      # Chromium。共有ライブラリ不足の環境では LD_LIBRARY_PATH を指定
```

## 単体（`engine.test.ts` / `compose.test.ts` / `data.test.ts`）

| 要件 | テスト |
|---|---|
| キャラクター固定情報が変化しない／固定プロンプトに副作用なし | engine「never changes character definitions」、compose「keeps fixed prompts verbatim」 |
| 役割が入れ替わる／actor-recipient対応の維持 | engine「swaps actor/recipient…both orders」、compose「maps actor/recipient prompts」 |
| 同じSeedで同じ結果 | engine「identical sequences…」「seeded random」（PRNG値を固定値で検証） |
| Shuffle Bagが1巡中に重複しない | sampling「Shuffle Bag never repeats」、engine「every 2-step cycle contains both orders」 |
| 重み付き抽選の無効な重み | sampling「treats invalid weights as zero」、data「rejects invalid/NaN weight」 |
| 制約違反の除外 | engine「excludes candidates that violate tag constraints」「allowed categories, locked tags, per-role limits」 |
| 候補0件／1件 | sampling「returns null…single candidate」、engine「safe with empty libraries…」 |
| 1・2・3・22人 | engine「handles 1, 2, 3 and 22 characters」 |
| 巨大な組合せでメモリを浪費しない | assignment「samples beyond the cap without enumerating」、engine「thousands of candidates and 22 characters」 |
| 元のプロンプトを復元 | compose「restores the original composition…re-applies history」 |
| 二重適用でタグが増殖しない | compose「no tag growth on repeated application」 |
| モデル非対応の制限 | compose「enforces model limits and never assumes undocumented features」 |
| Randomizer保持／|構文の安全性 | compose「preserves the NovelAI randomizer and refuses unsafe pipe output」 |
| ユーザーのタグを削除せず警告 | compose「warns about conflicting user tags without deleting them」 |
| 相互作用タグ・位置・カメラ | compose「generates interaction tags, camera presets and position hints」 |
| 直近N件回避／Seed変更でリセット | engine「avoids recent compositions…」「accepts a duplicate with a warning」 |
| 保存データ検証・移行・破損隔離 | data「rejects …」13ケース、「runs registered migrations」「quarantines unreadable shuffle data」「isolates corrupt shuffle data at DB load」 |

## 統合（`site.test.ts`, `data.test.ts`）

| 要件 | テスト |
|---|---|
| 設定保存と復元 | data「survives DB close/reopen and full JSON backup round trips」 |
| import/export・merge衝突 | data「merges shuffle collections」「exports shuffle-only files」 |
| Site Adapter 読込み/書込み | site「prepare never writes; apply writes every field once and verifies」 |
| ユーザー編集との競合検出 | site「aborts with zero writes when any field was edited」、統合「applies successive shuffles…stops on a user edit」 |
| 欄数不一致・書込み不可 | site「refuses when the site character slots do not match」 |
| 部分失敗時の復旧 | site「rolls back only its own unchanged writes」 |
| 生成中は書かない／期限 | site「expires previews and never writes while generation is running」 |
| 生成回数・重複イベント無視 | site「counts each successful job once…」「counts per observer, rebases on restart…」 |
| 複数パネル競合・クリーンアップ | site「grants the generation observer to one panel at a time and stops it when the lease ends」 |
| 不正メッセージ | site「multi-field protocol validation」2ケース、「rejects stale documents and unauthorized senders」 |

## E2E（Mock）

`tests/fixtures/site.tsx` は React制御textarea、キャラクター欄（追加/削除可）、モデル表示、`data-state/data-job-id` の生成状態要素（保留・失敗・非表示・再描画）を持つ模擬ページ。

| # | 依頼の手順 | テスト（shuffle.spec.ts） |
|---|---|---|
| 1–7 | 2人設定→Shuffle Now→役割変更→Applyまでサイト不変→Apply反映→Restore | 「two characters: Shuffle Now swaps roles…Restore returns the original」 |
| 8–10 | 5ジョブごと有効化→完了イベント→正しい回数で更新 | 「auto shuffle every 5 successful jobs…」（再描画・失敗は数えない、Generateは押さない、停止後は更新しない） |
| 11 | 編集中の競合では更新しない | 「edits made on the site after Apply are never overwritten…」「auto shuffle waits while generating and stops instead of overwriting」 |
| 追加 | 3人以上 | 「three characters: partial role assignment and a character-slot mismatch…」 |
| 追加 | 非対応画面で停止 | 「auto shuffle stops safely when generation cannot be detected or the page navigates away」 |
| 追加 | サイト連携なし・永続化・Undo | 「without a site connection: copy fallback, manual generation count and persisted settings」 |
| 追加 | 標準テンプレートでカテゴリ重複なし・設定export | 「standard templates: each category appears at most once…」 |
| 追加 | 実content script（read-only adapter）で安全に停止 | extension.spec「real Content Script: shuffle reports unverified…as unsupported」 |

## 2026-11-18 追加（状態の分離・自動の安全停止・生成カウント）

| 観点 | テスト |
|---|---|
| 開始時に生成中のジョブ（ID有/無）を数えない、再描画・ID再出現・失敗・欠落の遷移表 | `generation.test.ts`（表形式15行＋境界） |
| タブA→Bで反映前原文・編集検出を共有しない、再読込（documentId変化）・別プロファイルで使えない | `site-session.test.ts`、E2E「restore information is bound to the tab…」「a reloaded document and another profile…」 |
| Apply途中失敗の分類（書込み前のコード／書込み開始後は状態不明） | `site-session.test.ts`、handlerのmid-write `CONFLICT`→`WRITE_FAILED` |
| 停止後に新しい書込みを始めない（status・prepare・apply各待機中の停止）、送信済み書込みの記録 | `auto-run.test.ts` |
| 設定変更（fingerprint）・外部カーソル変更・保存エラーで停止、自分のシャッフルでは停止しない | `auto-run.test.ts`、E2E「auto shuffle freezes its configuration…」 |
| 自動開始時に生成中だったジョブを数えない（fixture） | E2E「a generation already running when auto shuffle starts…」 |
| 広いタブ（`sidepanel.html#lab`）からの実content script読取り | `extension.spec.ts`、`site-session.test.ts`（送信元URL） |

## 実NovelAIでの手動確認（未実施）

M-S1 キャラクター欄のDOM特定、M-S2 キャラクター欄への書込みとblur/再描画後の保持、M-S3 生成開始/完了の安定した表示要素、M-S4 モデル表示、M-S5 Character Positions。いずれも**未実施**。利用規約と認証情報の安全性のため、自動テストは実サイトに接続せず、有料生成も行わない。Mock E2Eの成功は実サイト対応を意味しない。
