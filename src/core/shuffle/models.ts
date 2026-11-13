import type { ModelId } from './types';

/**
 * Model capabilities as stated by the official NovelAI docs (checked 2026-11-14):
 * docs.novelai.net/en/image/multiplecharacters/ and /en/image/models/.
 * "documented" means the docs state it; nothing here has been exercised against
 * the live site by this extension. Unknown values stay null and are never assumed.
 */
export interface ModelProfile {
  id: ModelId;
  label: string;
  characterPrompts: boolean;
  /** Officially documented maximum, or null when the docs do not state it. */
  documentedMaxCharacters: number | null;
  /** Limit the composer enforces. Conservative when the documented value is unknown. */
  enforcedMaxCharacters: number;
  /** The `|` multi-character syntax in the base prompt (docs: V4 and higher). */
  pipeSyntax: boolean;
  /** Character position grid, when documented. Positions are never written by this extension. */
  positionGrid: string | null;
  /** V4/V4.5 use a T5 tokenizer; most non-ASCII characters are unsupported (docs). */
  asciiOnly: boolean;
  notes: string[];
}

const SHARED_NOTE = 'source#/target#/mutual# は公式にも「常に信頼できるわけではない」と記載されています。';
export const MODEL_PROFILES: Record<ModelId, ModelProfile> = {
  unknown: {
    id: 'unknown', label: 'モデル未選択', characterPrompts: true, documentedMaxCharacters: null, enforcedMaxCharacters: 6,
    pipeSyntax: false, positionGrid: null, asciiOnly: false,
    notes: ['モデルが未選択のため、公式に記載された最小のキャラクター上限（V4の6人）で検証します。|構文は使用しません。'],
  },
  v3: {
    id: 'v3', label: 'NovelAI Diffusion V3 (Anime/Furry)', characterPrompts: false, documentedMaxCharacters: null, enforcedMaxCharacters: 0,
    pipeSyntax: false, positionGrid: null, asciiOnly: false,
    notes: ['キャラクタープロンプトはV4以降の機能です（公式）。V3ではキャラクター欄を使用しません。'],
  },
  v4: {
    id: 'v4', label: 'NovelAI Diffusion V4', characterPrompts: true, documentedMaxCharacters: 6, enforcedMaxCharacters: 6,
    pipeSyntax: true, positionGrid: '5x5', asciiOnly: true, notes: [SHARED_NOTE],
  },
  'v4.5': {
    id: 'v4.5', label: 'NovelAI Diffusion V4.5', characterPrompts: true, documentedMaxCharacters: null, enforcedMaxCharacters: 6,
    pipeSyntax: true, positionGrid: '5x5', asciiOnly: true,
    notes: ['V4.5のキャラクター上限は公式に未記載のため、V4と同じ6人を保守的な上限にしています。', SHARED_NOTE],
  },
  v5: {
    id: 'v5', label: 'NovelAI Diffusion V5', characterPrompts: true, documentedMaxCharacters: 22, enforcedMaxCharacters: 22,
    pipeSyntax: true, positionGrid: null, asciiOnly: false,
    notes: ['V5の位置グリッドは「reworked」とだけ記載され詳細は未確認です。', SHARED_NOTE],
  },
};
export const MODEL_IDS = Object.keys(MODEL_PROFILES) as ModelId[];

/** Map a verified site label to a model ID. Unrecognised labels stay unknown. */
export function detectModel(label: string | null | undefined): ModelId {
  if (!label) return 'unknown';
  const text = label.toLowerCase();
  if (/\bv\s?5(?![.\d])/.test(text)) return 'v5';
  if (/\bv\s?4\.5\b/.test(text)) return 'v4.5';
  if (/\bv\s?4(?![.\d])/.test(text)) return 'v4';
  if (/\bv\s?3(?![.\d])/.test(text)) return 'v3';
  return 'unknown';
}
