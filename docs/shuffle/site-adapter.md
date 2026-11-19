# Prompt Shuffle — Site Adapter

NovelAI依存はすべて `src/platform/novelai/` に閉じ込める。セレクタは adapter 内だけに置き、未確認のセレクタを推測して追加しない（`docs/DOM_ADAPTER_CHECKLIST.md`）。

## 対応状況（2026-11-14、2026-11-18に変更なしを確認）

| 能力 | 実NovelAI（`LiveReadOnlyAdapter`） | ローカルfixture（`TextareaAdapter` + `fixtureProfile`） |
|---|---|---|
| ベース Prompt / UC 読取り | 観測済みの単純ProseMirror構造のみ。確認済みの表示言語は英語（公開ページ、2026-11-03）と日本語（ログイン後、2026-11-19・issue #4） | ○ |
| ベース書込み | **×（未検証のため無効）** | ○（native setter + input/change + 80ms readback） |
| キャラクター欄 読取り/書込み | **×（DOM未調査）** `slots: 0` | ○（最大6欄、`{n}`テンプレートのセレクタ） |
| モデル検出 | **×** `label: null` → ユーザーがモデルを選択 | ○（表示ラベルを `detectModel` で解釈） |
| 生成状態の検知 | **×** `GENERATION_REASON` | ○（`data-state`/`data-job-id` 要素） |
| Character Positions 座標 | **×（全adapterで非対応）** `positions.supported: false` 固定 | × |

fixtureでの成功は実サイト対応の根拠にしない。実サイトでは「読取りのみ・コピーで手動反映・手動で生成回数を記録」が利用可能な範囲。

## メッセージ（`protocol.ts`、既存 site-v1 に追加）

| type | 内容 | 主な検証 |
|---|---|---|
| `inspectFields` | ベース2欄・キャラクター欄数・モデル表示・位置/生成の能力 | `positions.supported` は `false` 以外を拒否 |
| `readFields` | 指定欄の現在値 | フィールドキー形式、重複なし、最大45欄 |
| `prepareFields` | `characterSlots` と書込み一覧 → 変更前後と60秒ticket | サイトの欄数 ≠ 構成人数なら `CONFLICT`。書込み不可欄は `UNSUPPORTED`。生成中は `BUSY` |
| `applyFields` | ticketで全欄を書込み | 一回限り・期限・タブ一致。**書く前に全欄をCAS**（token+原文）→ 1欄でも変化なら0件書込みで中止（`CONFLICT`）。途中失敗は自分が書いた未変更欄だけ元に戻し、**書込み開始後の失敗は常に `WRITE_FAILED`**（2026-11-18）。全欄readback一致で成功 |
| `generationStatus` | `{supported, observerId, generating, completed, failed}` | パネルごとのlease（15秒）。別パネル使用中は `BUSY`。lease中だけオブザーバを起動 |
| `releaseGeneration` | lease解放・オブザーバ停止 | 同じsessionのみ |

既存の単一チャンネル `prepare/apply` は変更していない（生成中ならapplyを拒否する検査だけ追加。オブザーバ非稼働時は影響なし）。送信元（拡張ID・sidepanel URL・tabなし）、URL（`https://novelai.net/image*`）、documentId の検証は既存と同じ。送信元URLはスキーム・ホスト・パスで比較し、フラグメント・クエリの違いは許容する（広いタブの `sidepanel.html#lab` が拒否されていた不具合を2026-11-18に修正）。

### パネル側の状態（2026-11-18）

- **サイトセッション**（`src/core/shuffle/site-session.ts`）: 反映前原文（baseline）・拡張が最後に書いた値（lastWritten）・状態不明の欄（uncertain）を **(tabId, documentId, url, profileId)** ごとに保持する。別タブ・再読込後のドキュメント・別プロファイルでは空のセッションになり、Restoreや編集検出に他の対象の情報を使わない。他のセッションの反映前原文は「コピー専用」として表示し、反映ボタンは出さない（最大20件、Restore用の原文を持つものを優先して保持）。
- Applyの結果はセッションに畳み込む: 成功 → baseline（初回の値のみ）とlastWritten。`EXPIRED`/`BUSY`/`UNAUTHORIZED`/`UNSUPPORTED_PAGE`/`STALE_DOCUMENT`/`CONFLICT`/`NOT_FOUND`/`AMBIGUOUS`/`UNSUPPORTED`（書込み前にだけ返る）→ 変更なし。それ以外（`WRITE_FAILED`/`VERIFY_FAILED`/`DISCONNECTED`/`INVALID_MESSAGE`/未知）→ baselineを保持し全欄をuncertainにする（次回は上書きの明示同意が必要）。
- **自動シャッフルの実行単位**（`src/ui/shuffle/auto-run.ts`）: 開始時に対象・lease session・カウンタ・`shuffleConfigFingerprint`（キャラクター・テンプレート・候補プール・カメラ・プロファイルの参加者と全設定〔Seed・方式・対象カテゴリ・モデル・出力形式・間隔等〕・ベースプロンプト）とカーソル位置を固定する。各ステップと書込み直前に、最新のコミット済みデータ（React描画を待たない同期読取り）と比較し、変化・別プロファイルへの切替・保存エラーがあれば書かずに停止する。自分のシャッフルによるカーソル・現在選択・履歴の更新では停止しない。外部のカーソル変更（Shuffle Now・ステップ0・元に戻す）では停止する。実行中は Shuffle Now・ステップ0・解除・履歴の再適用・プロファイル切替を無効化する。
- 停止は冪等でleaseを解放する。すべての `await` の後に実行中か確認するため、停止後に新しい書込みは始まらない。停止時に送信済みだった書込みの結果はセッションに記録する（編集検出を正しく保つため）。

## 生成回数の判定

1. 自動シャッフルを開始すると、パネルが `generationStatus` を1秒ごとに送る（ポーリング）。content script は初回で `DomGenerationObserver` を開始し、lease切れ（15秒）・解放・ページ移動で停止する。常時稼働しない。
2. オブザーバは2属性（`data-state`, `data-job-id`）だけを `MutationObserver` で監視し、status要求時にも同期で再読取りする（要素の差替えはこの再読取りで検出）。
3. `track()`（純粋）: 開始時に表示中のジョブは、完了済み・**生成中のどちらでも**基準として数えない（生成中のジョブが完了時に数えられていた不具合を2026-11-18に修正）。開始時にID無しで生成中だった場合は、最初の完了（またはidle）までを基準ジョブとみなし、その間に現れたIDも基準扱いにする。`succeeded` を**未見のjob ID**で観測したときだけ `completed+1`。同じIDの再描画・ID無しの完了・`failed` は成功として数えない。曖昧な場合は数えない（少なく数えると次のシャッフルが遅れるだけだが、多く数えると予期せずプロンプトが変わるため）。記憶するIDは直近500件。要素が一意に見つからなければ `supported:false` を返し、パネルは自動を停止。
4. パネルの `observeStatus()`: `observerId` が変わる（再読込・再起動）と数えずに基準を取り直す。複数完了が一度に届いても1回だけシャッフル。
5. 1ジョブで複数枚を生成しても1回と数える（ジョブ単位）。
6. 期限到達時、`generating` 中は書かずに待つ。書込み直前に `before ≠ lastWritten`（拡張の最後の書込み後に編集された）なら上書きせず停止。前回の反映が失敗・未確認の欄も同様に確認を要求する。

実NovelAIの生成ボタン・完了表示は**未調査**のため、推測実装はしていない。代替は「生成完了を手動で記録（+1）」で、規定回数に達するとShuffleだけ行い（サイトは変更しない）、Applyまたはコピーを促す。

## 実NovelAI対応を追加する手順（未実施）

1. `DOM_ADAPTER_CHECKLIST.md` に従い、ログイン後UIでキャラクター欄・生成ボタン/完了表示・モデル表示を実機調査し、検証日とバージョンを記録する。
2. 新しい検証済みprofile/adapterを `src/platform/novelai/` に追加。`fields`（describe/readField/writeField）と、安定した完了信号がある場合だけ `generation` を実装する。
3. ProseMirrorへの書込み方法を実機で検証（blur・再描画後の保持、内部state）。未検証なら `canWrite: false` のまま。
4. 実機での手動確認結果を test-plan.md の M 系項目に記録し、limitations.md を更新。fixture E2Eを本物の構造に合わせて追加する。
