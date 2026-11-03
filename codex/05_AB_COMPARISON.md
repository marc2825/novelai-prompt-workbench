# P3-B: 安全な手動A/B比較

`docs/AB_COMPARISON.md`と`docs/SECURITY_POLICY.md`を先に読む。**画像生成APIの直接呼出し、自動Generateクリック、hidden fetch interception、トークン取得、無人キューは禁止**。

1. `Experiment`（A/B各snapshot+compiled prompt+GenerationSettings）を作成。
2. Aを複製してBを編集する画面と文字列差分（added/removed）。変更グループを明示。
3. Seedは数値に丸めず文字列保存。model, size, sampler, steps, guidance, extraを記録。未設定は`unknown`扱いで、厳密比較できない理由を表示。
4. ユーザーによる A/B 各PNGの手動取り込み。画像の型/サイズを検証し、サムネイル＋原本をIndexedDBへ保存。生成画像の自動捕捉はしない。
5. 画像の並列表示、ドラッグでワイプ比較、表示範囲同期など。必ずテキストによる差分表示も残す。
6. PNGメタデータ解析は公式保存PNGの実サンプルがある場合にのみ仕様に沿って実装。サンプルがなければparser interfaceと`unknown` fallbackを実装し、解析対応とは主張しない。外部に画像を送信しない。
7. 比較画像2枚が揃っても、設定不一致/不明なら「制御された比較」と表示しない。保存/削除、エクスポート設計も行う。
8. サイトへの反映はP2の検証済アダプタ利用かコピー。生成操作はユーザー自身が行う。

AC15/AC16/AC17のテストと回帰の実測結果を示す。
