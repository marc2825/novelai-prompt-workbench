# 画面設計 / 操作フロー

## ナビゲーション

現在のタブ順（2026-11-18）: **ライブラリ → ワークスペース → プリセット → シャッフル → 比較 → Experiment Lab → 設定**（作る → 保存・切り替える → 比べる → 設定・バックアップ）。タブは ← → Home End で移動できる（WAI-ARIA tabs、roving tabindex）。初回（ライブラリ・ワークスペースが空）はライブラリタブに3手順の「はじめに」を表示する。ツールバーボタンでサイドパネルが開き、見出しの「広いタブで開く」で同じ画面をタブに開ける。下図は初期の構想図。


```text
┌─ NovelAI Prompt Workbench ───────────────┐
│ [Library] [Workspace] [Presets] [Compare]│
├───────────────────────────────────────────┤
│ Library:                                   │
│ [検索: 髪型、英語タグ、カテゴリ]             │
│  [＋新規] [json import/export]             │
│  [黒髪ロング]  black hair, long hair [＋]  │
│  [制服]        school uniform       [＋]  │
├───────────────────────────────────────────┤
│ Workspace:                                │
│ Positive / Negative                       │
│ Hair [group ON] (exclusive)               │
│   ● 黒髪ロング  ○ 金髪ショート            │
│ Outfit [group ON] (multi)                 │
│   ☑ 制服        ☐ ジャケット            │
│ Background [group OFF]                    │
│   ☑ city street (保持される)              │
├───────────────────────────────────────────┤
│ Live output: 1girl, black hair,...        │
│ [コピー] [NovelAIへ反映*]                 │
└───────────────────────────────────────────┘
* 検証済のアダプタ/サイト接続時のみ有効
```

## プリセット切り替え

- `制服`プリセット: Hair=黒髪ロング, Outfit=制服, Background=廊下。
- `私服`プリセット: Hair=黒髪ロング, Outfit=カーディガン+ジーンズ, Background=街。
- `水着`プリセット: Hair=ポニーテール, Outfit=水着, Background=プール。

切替前にA→Bの差分を表示し、現在workspaceの変更を破棄する場合は保存/確認する。適用後も元プリセットと辞書項目の原本は無変更。

## 比較画面

```text
Experiment: 髪色テスト
[Variant A]                     [Variant B]
black hair, long hair          blonde hair, long hair
Seed: 123456789                Seed: 123456789
Model: selected                Model: selected
[PNGを読み込む]                [PNGを読み込む]
[画像A]                        [画像B]
             [左右比較 / ワイプ]
Changed: black hair -> blonde hair
Settings check: [モデル確認] [Seed確認] [その他設定...]
[コピーA] [コピーB] (生成はユーザーが操作)
```

## 空/失敗UI

- 未登録: `ライブラリに最初のプロンプトを追加`。
- 未接続: `NovelAI画像生成画面を開いてください。コピーは利用できます`。
- 対象DOM不明: `入力欄を安全に特定できません。コピーを使用してください`。
- バックアップエラー: `インポートに失敗したため、元データは変更されていません`。
- PNGメタなし: `設定メタデータを確認できません（画像自体の比較は可能）`。
