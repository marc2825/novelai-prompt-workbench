# NovelAI DOM連携を実装する前の調査メモ（実機確認必須）

この文書は**未調査のセレクタを作り込まないため**のチェックリスト。ここに既知のCSSセレクタは置かない。

## 確認手順

1. 自分のブラウザで公式 `https://novelai.net/` を開き、画像生成タブを表示。
2. 開発者ツールで positive/negativeの入力欄の要素を特定。input/textarea/contenteditable、label/role、react controlled等の挙動を記録。
3. プロンプトチャンク/複数キャラクター/UI言語切替時のDOMの変化を確認。
4. 実際に手で入力・クリアしたときに発生するinput/change等のイベントを確認。
5. **ユーザー確認のあるテスト文字列**で、書き込み→blur→再描画後に値が保たれるか確認。
6. 機能検出失敗時のreadOnlyモード、clipboardモードを検証。
7. 確認済みのスクリーンショット・検証日・対象NovelAI表示バージョンを内部の非公開テスト記録に残す。秘密情報が含まれるキャプチャはcommitしない。

## Adapterに必要な性質

- DOM要素検出は厳格。曖昧なら失敗。
- focus/current selection/selectionStartが維持できるか試す。
- 既存文字列を予想外に破壊しない。
- 反映前の状態をスナップショットとして保持し、読み戻して成功/失敗を返す。
- ブラウザタブ内の外部状態を推測して成功扱いにしない。
- 「生成」ボタン、課金ボタン、APIリクエストへの操作は実装しない。

## P2調査記録（2026-11-03 / Asia/Tokyo）

対象: 公開 `https://novelai.net/image`（タイトル `Image Generation - NovelAI`）。ログイン情報を持たない一時Chromiumプロファイルで、公開DOMを読取り専用調査。ログイン・入力・生成・API操作はしていない。製品の表示バージョン番号は確認できなかった。

確認できた構造:

```html
<div class="prompt-input-box-prompt" data-prompt-input="true">
  <!-- 中間のwrapper -->
  <div contenteditable="true" translate="no" class="ProseMirror">
    <p><br class="ProseMirror-trailingBreak"></p>
  </div>
</div>
<div class="prompt-input-box-undesired-content" data-prompt-input="true">
  <!-- 同じProseMirror構造 -->
</div>
```

画面上の `Prompt` / `Undesired Content` と対応するwrapper名を確認。表示中の2欄に加え、非表示の複製編集欄2個も存在した。textareaは非表示であり、見つかったtextareaへの安易な書込みは不適切。ハッシュclassやDOM位置はセレクタに採用していない。

- 実装: `src/platform/novelai/live.ts`。上記wrapper・data属性・ProseMirror/contenteditableを組み合わせ、**表示中の候補がチャンネルごとに一意**の場合だけ読取りを検討する。
- 単純な属性なし`p`、テキストノード、末尾の単一`br.ProseMirror-trailingBreak`のみ抽出。装飾・マクロノード・未知の構造・重複チャンネルは推測せずエラー。複数段落は改行で結ぶ。これはDOM上のテキスト投影であり、エディタ内部モデルとの完全一致を保証しない。
- 生成済みMV3拡張をロードし、実際のContent Script経由で公開ページのPositive/Negativeを自動読取り実測。両方とも空文字（0文字）を読み取れ、両方の書込み能力はfalse。サイトの入力は変更していない。
- クエリ付き`/image?…`はChromeのcontent matchで別途カバーが必要だったため`/image?*`を追加。runtimeではoriginとpathnameを再検証し、`/imagery`等は拒否する。
- 書込みアダプターは**未検証・無効**。ProseMirrorへの`textContent`/`innerHTML`代入、`execCommand`、ページ内部JSや非公開editor stateへの介入は実装していない。
- `TextareaAdapter`は検証済みprofileを明示注入するローカルReact fixture専用。profileは`src/platform/novelai/testing.ts`に分離し、製品entryからimportしない。

未確認: ログイン後のDOM、UI言語切替、Character Prompts、装飾・マクロの原文抽出、実サイトのinput/changeイベント、書込み→blur→再描画後の保持。チェックリストの書込み手順は未実施なので、実NovelAIの挿入/置換を完了扱いにしない。ユーザー確認を伴う実機検証後に別のwrite profileを追加する。

## Prompt Shuffle（2026-11-14）

実サイトへのアクセスは行っていない。次は**未調査**で、製品adapterでは扱わない（能力false）: Character Prompts欄（追加/削除ボタン・各欄のエディタ構造・UC欄）、モデル選択表示、生成ボタンの状態と完了表示、Character Positionsのキャンバス。調査・検証手順は `docs/shuffle/site-adapter.md` の「実NovelAI対応を追加する手順」。

## 静的監査（2026-11-18、実サイトへのアクセスなし）

コードの監査結果。実NovelAIでの確認は引き続き未実施で、製品の書込みは無効のまま。

| 観点 | 現状 | 判定 |
|---|---|---|
| 未確認DOMへの依存 | `LiveReadOnlyAdapter` は観測済みの単純なProseMirror（`<p>`＋テキスト＋末尾の `ProseMirror-trailingBreak`）だけを読む。それ以外の子要素・属性があれば `UNSUPPORTED` で推測しない。表示中の候補が複数なら `AMBIGUOUS` | OK |
| 書込み | `write` / `writeField` は常に `UNSUPPORTED`。capabilityも `canWrite: false` | OK（無効のまま） |
| 対象の照合 | 要求ごとに tabId・documentId（起動ごとの乱数）・URLを照合。トップフレームかつ `/image` 系URLのみ | OK |
| 送信元の検証 | 拡張ID・自拡張の `sidepanel.html`・`sender.tab` なし。フラグメント付きURL（`#lab`）を誤って拒否していたため修正 | 修正済み |
| 上書き検出 | 書込み前に全欄をCAS（要素ごとのtoken＋原文）、書込み後に再読取り。パネル側は対象別セッションで「最後の書込み後の編集」を検出 | OK（fixture検証） |
| 失敗時の復旧 | 自分が書いた未変更の欄だけを戻す。書込み開始後の失敗は `WRITE_FAILED` で返し、パネルは状態不明として扱う | 修正済み |
| 例外 | handler全体を `try/catch` し、確認チケットを破棄して `WRITE_FAILED` | OK |
| 非同期競合 | 書込み中の要求は `BUSY`。チケットは1回限り・60秒。生成中は書込みを拒否。自動シャッフルは停止後に新しい書込みを始めない | OK |
| 生成検知 | 製品は非対応（`GENERATION_REASON`）。監視はlease中だけ | OK |
| 最小権限 | `sidePanel` のみ。content scriptは静的宣言 | OK |

### 書込みを有効にするために実機で確認すること

ログイン後の画像生成ページで、利用者の同意を得たテスト用の文字列だけを使って確認する。

1. **エディタ構造**: Positive/UC/各キャラクター欄のProseMirrorのDOM（段落・装飾・マクロ・強調表示の要素とclass/属性）、言語切替・プロンプトチャンク時の変化、欄が複数表示される条件。
2. **入力方法の選定**: ProseMirrorは内部状態（EditorState）からDOMを描画するため、DOMを直接書き換えても内部状態に反映されず、次の再描画で戻る・送信値と表示が食い違う可能性がある。候補（`beforeinput`/`insertText` 相当のイベント、選択範囲＋`execCommand('insertText')`、クリップボード経由）ごとに、blur・タブ切替・再描画・生成送信後も値が保たれ、送信されたプロンプトが表示と一致するかを確認する。内部APIへの直接アクセス（React/ProseMirrorの非公開オブジェクト）は使わない。
3. **Undo**: サイト側のUndo履歴が壊れないか、元に戻せるか。
4. **キャラクター欄**: 欄の数・順序の取得方法、追加・削除をしないこと、UC欄の有無。
5. **生成状態**: 生成ボタン・進行表示・完了表示に、ジョブを一意に識別できる安定した信号（属性・ID）があるか。無ければ自動検知は実装しない（手動記録のまま）。
6. **モデル表示**: 表示ラベルの要素と、言語・バージョンでの変化。

確認結果（日付・NovelAIの表示バージョン・Chromeのバージョン・手順・結果）をこの文書に追記し、検証済みprofileを `src/platform/novelai/` に追加してから、fixture E2Eを実構造に合わせて拡張する。一つでも確認できない項目があれば、その能力は `false` のままにする。

### 対応可能性の見込み

- ベースPrompt/UCの読取り: 現状で可能（単純な構造のみ）。
- 書込み: ProseMirrorの内部状態と一致させられる公開された入力経路（イベント）が実機で確認できれば可能。確認できなければコピー運用を継続する。
- キャラクター欄・モデル表示: DOM調査次第。セレクタが安定していれば読取りは比較的容易。
- 生成完了の自動検知: 一意なジョブ識別子が無い場合は不可（誤カウントの危険があるため推測実装しない）。
- NovelAI固有のPNGメタデータ: 公式に保存された実サンプルで項目を確認するまで解析しない。

## 日本語UIでの観測（2026-11-19〜20、issue #4）

外部レビュー（実機、ログイン後、日本語UI、v0.1.0 / HEAD `28d5e21`）の報告。DevToolsコンソールでの読取りのみの計数で、こちらでは実サイトに接続していない。

- `.prompt-input-box-prompt` 0件、`.prompt-input-box-undesired-content` 0件 → 英語ラベル前提のセレクタでは両チャンネルとも `NOT_FOUND`。
- `[data-prompt-input="true"]` 14件、`.ProseMirror[contenteditable="true"]` 14件。
- ラッパのクラスは `prompt-input-box-<表示ラベル>`: `prompt-input-box-ベースプロンプト`、`prompt-input-box-除外したい要素`、`prompt-input-box-キャラクタープロンプト-1`〜`6` と各 `-除外したい要素`。
- 構文装飾のある実プロンプトは段落構造の判定で `UNSUPPORTED` になる見込み（目視で装飾区間を確認）。現行設計どおり。

対応（2026-11-20）: 位置やDOM順による推測ではなく、**観測済みのラベルだけを確認済みロケールとして列挙**する方式にした（`src/platform/novelai/live.ts` の `VERIFIED_FIELD_LABELS`）。クラスは完全一致（`[class~=...]`）で照合するため、キャラクター欄（`…キャラクタープロンプト-1-除外したい要素` 等）をベース欄と取り違えない。未掲載の言語は従来どおり `NOT_FOUND`（読取り不可・コピー案内）。日本語構造の模擬HTMLで実content scriptのE2Eを追加した。

| 表示言語 | Positive | Negative | 確認 |
|---|---|---|---|
| 英語（未ログインの公開ページ） | `prompt` | `undesired-content` | 2026-11-03（P2） |
| 日本語（ログイン後） | `ベースプロンプト` | `除外したい要素` | 2026-11-19（issue #4） |
| 英語（ログイン後） | 未確認 | 未確認 | — |
| その他の言語 | 未確認 | 未確認 | — |

新しい言語を追加する場合は、実機で上記と同じ計数・クラス名を確認し、この表と `VERIFIED_FIELD_LABELS`、E2Eの模擬HTMLを同時に更新する。キャラクター欄のラッパも観測されたが、読取り・書込みは引き続き対象外（DOM構造・欄数の扱いを未検証）。
