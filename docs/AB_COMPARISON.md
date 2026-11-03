# A/B比較（手動生成補助）

## なぜ「手動」なのか

NovelAIは画像生成API文書を公開しているが、APIの存在だけで任意の自動化が許諾されるわけではない。現行規約は、認可されない方法のアクセスや制限を無視した自動操作を問題視している。初期版は**画像生成リクエストを拡張から送信しない**。ユーザーが一回ずつNovelAI公式画面の生成ボタンを押す。

## フロー

1. `新しい比較`を押す。現在のworkspaceを**Aの固定スナップショット**にする。
2. Bへコピーし、髪/服/タグの一つを変更。A/Bプロンプト差分をハイライト。
3. ユーザーがSeed、モデル、Steps、Sampler、Guidance、解像度、その他重要設定を入力/確認。未設定は`unknown`。
4. `Aのプロンプトを反映`（安全なDOM Adapterが確認済の場合）、またはコピー。**ユーザー本人が画像生成**。
5. NovelAIの保存ボタンからPNGをダウンロード→`Aに画像を読み込む`。
6. 同じ設定を確認しBを反映→ユーザー本人が画像生成→`Bに画像を読み込む`。
7. 比較画面で画像を左右/ワイプで比べ、タグ差分と設定差分を並べる。
8. PNGメタデータが利用可能なら後から手入力設定とクロスチェック。なければ「未確認」のまま。

## 比較の成立条件

| 項目 | 厳密比較を名乗る条件 |
|---|---|
| Seed | A/B両方の値が判明し同じ |
| model | 同じモデル識別子。わからなければ不明 |
| width/height | 両方同じ |
| steps/sampler/guidance | 全て判明し同じ |
| negative prompt | 変更意図がない限り一致。違えば差分表示 |
| 追加設定 (smea, noise schedule, image2image 等) | 使用した設定を記録・照合 |
| 拡張が操作しない設定 | ユーザーが確認。自動的に一致とみなさない |

出力が似ない場合も不具合とは限らない。同Seedでも異なるモデルやバージョン、他設定、内部挙動に影響され得る。

## 画像取り込み

- `.png`（後でJPEG/WebP可）はユーザーがローカルファイル選択。`type`だけでなくファイル署名を確認。
- 画像最大サイズの上限と表示用縮小版を用意。
- NovelAI公式FAQにより、保存アイコンで保存した画像だけが生成メタデータを持ち得る。右クリック保存やコピー経由はメタデータを失う場合がある。
- メタデータパーサを分離し、知らないキーは安全に保持してUI上で「不明」扱い。存在しない項目を推測しない。
- メタデータのプロンプトは公式チャンク**展開後**であり、元のチャンクIDやトグル状態はこの拡張のスナップショットからしか分からない。

## 比較結果の例

```text
A: 1girl, black hair, school uniform
B: 1girl, blonde hair, school uniform
Changed: hair only
Seed: 123456789 (both confirmed)
Model: confirmed / Steps: confirmed / other settings: unverified
Status: settings incomplete — cannot claim a strictly controlled comparison
```

## 将来の自動生成対応

公式の許可範囲/使用条件/API仕様を確認し、ユーザーによる各生成の同意や課金確認を設計できるまで実装しない。APIトークンの保存や隠れたfetch横取りは禁止。

## P4実装で検証した範囲（2026-11-03）

- 現在workspace/presetからsnapshotを固定し、Bのみ変更案を編集・preview・確定できる。A/Bのrawとcompiledはsourceの変更に追従しない。再固定は明示操作で、旧画像リンクを外す。
- 生成設定はnullを不明とし、画像メタデータの採用も確認付き。取得元やextra条件が未確認なら「検証不能（厳密比較不可）」、既知不一致は差分を表示する。
- 標準PNG textと手入力を提供。**NovelAI固有PNGは実サンプル未取得のためparser interfaceとunknown fallbackに限定**。syntheticなworkbench形式の構造化抽出成功を、実NovelAI対応の根拠にしない。
- 横並び/ワイプ、同期zoom/pan、サイズ違いの警告、明示resize時のみpixel diff。原本不変。詳細な上限・保存形式はDATA_MODEL、回帰結果はtasks/STATUSを参照。
- JSONは画像metadataと比較を保存するが原本/thumbnailは含まない。元PNGは画像ライブラリから別途保存可能。復元時に欠落を検出し、同一PNGを再取込して修復する。
- P2の実サイトwriteは無効。今回の自動テストから実NovelAIへのアクセス・生成・画像送信は行っていない。
