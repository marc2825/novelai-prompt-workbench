# Experiment Lab 調査・実装方針（2026-11-16）

- 既存構成: WXT / React / strict TS / Chrome MV3、sidepanelとnovelai.contentのみ。権限sidePanel。IndexedDB v3に画像Blob・thumbnail、metadata.extraに拡張データを保存可能。既存辞書・preset・A/Bと独立したLab snapshotを追加する。
- 重み: https://docs.novelai.net/en/image/strengthening-weakening/ を確認。V4以降の数値重みと負値、braces/bracketsに対応。Labは最上位の完全なタグ項目を位置付きで扱い、単一タグを囲む既存ラッパーのみ置換。複雑な部分入れ子・macro・pipeは推測せず拒否し、全文候補で保持可能。既存重みスライダーの仕様は変更しない。
- モデル: https://docs.novelai.net/en/image/models/ 、 https://docs.novelai.net/en/image/effort/ 。V5 Full/Curatedを対象とする。Full Mediumは14 Steps/Euler Ancestral、UC変更不可、Rescale変更不可。High/Curated用設定は手入力して公式UIで確認する。パラメータのローカル上限は製品上の制限でありサービスの最大値とは主張しない。
- Seed: https://docs.novelai.net/en/image/seed/ 。数字文字列を保持。固定、共通Seed群、反復、XYZのSeed軸。乱数候補はUIのcryptoで事前生成し保存する。同Seedでも異なるpromptのピクセル一致は保証しない。
- A1111: https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/Features のXYZ、Prompt S/R、Matrixを確認。軸の直積・数値範囲・CSV候補を参考にし、NovelAIのpipeをMatrix区切りに転用しない。
- 料金: https://docs.novelai.net/en/subscription/ 、 https://docs.novelai.net/en/image/stepsguidance/ 。V5の利用枠・条件・契約で異なるため費用を断定しない。予定枚数を算出し、公式UIで確認した1枚あたりAnlasを利用者が入力した場合のみ参考合計を表示する。
- 規約: https://novelai.net/terms （表示上Effective December 8th 2025）を確認。アクセス制御回避は禁止。拡張からの自動生成の許可・レート・二重送信防止契約は確認できていない。Mode Bは無効。APIの存在を包括的な自動化の許諾とみなさない。
- 実機: 公開 https://novelai.net/image はテキスト取得ではDOMを検査できず、接続document sessionも0件。ログイン後V5 Full/Curated、生成設定、書込み、結果捕捉のDOMは未検証。新セレクタは追加しない。既存SiteClientとread-only adapterを使用し、fixtureのCAS/readback成功を実サイト対応とは扱わない。
- 手動連携: 明示読取りでベースへ取込。条件IDを固定表示してprompt/UCをコピーまたは既存の検証済profileで確認付き反映。設定は手動チェック。元promptは固定ベースと既存反映前原文から復元。設定の自動取得/反映/復元は未対応と表示。画像は確認したCondition IDにPNGを手動登録する。
- 保存: optional lab schemaVersion 1を既存metadata.extraで保存。JSON検証時に条件を再展開しsnapshot整合を照合。未知safe fieldを保持。画像は既存資産ストア、履歴・backup保護に乗せる。JSONは画像metadataのみ、ZIPはPNGとJSON/CSVを同梱。
