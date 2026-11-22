import { useMemo, useState } from 'react';
import type { GenerationSettings, ImageMetadata } from '../core/types';
import { candidatePrompts, candidateSettings, hasPromptCandidates, hasSettingCandidates, novelaiView, type NovelAICandidate, type NovelAISourceView } from '../data/novelai-metadata';
import { InfoTip } from './InfoTip';

type Translate = (ja: string, en: string) => string;
const japanese: Translate = ja => ja;
const MAX_VALUE = 1000; const MAX_CELL = 300; const MAX_ROWS = 200;
const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max)}…（${value.length}文字）` : value;
const shown = (value: string | number | null, t: Translate) => value === '' ? t('（空文字）', '(empty string)') : clip(String(value), MAX_CELL);
const cell = (item: NovelAICandidate, t: Translate) => item.status === 'ok' ? shown(item.value, t) : item.status === 'missing' ? t('なし', 'none') : t(`採用しない（型・範囲が想定外: ${item.found}）`, `not used (unexpected type/range: ${item.found})`);
const raw = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);

function AllFields({ source, suffix, t }: { source: NovelAISourceView; suffix: string; t: Translate }) {
  const rows: [string, string][] = [...source.fields];
  if (source.comment.status === 'ok') for (const [key, value] of Object.entries(source.comment.value)) rows.push([`Comment.${key}`, raw(value)]);
  return <details><summary>{t(`画像情報の全項目（${source.label}${suffix}）`, `All fields (${source.label}${suffix})`)}</summary>
    <div className="table-scroll"><table><thead><tr><th>{t('キー', 'Key')}</th><th>{t('値（信頼されないテキスト）', 'Value (untrusted text)')}</th></tr></thead>
      <tbody>{rows.slice(0, MAX_ROWS).map(([key, value]) => <tr key={key}><th>{clip(key, 120)}</th><td>{clip(value, MAX_VALUE)}</td></tr>)}</tbody></table></div>
    {rows.length > MAX_ROWS && <p className="hint">{t(`先頭${MAX_ROWS}件を表示しています（全${rows.length}件）。`, `Showing the first ${MAX_ROWS} of ${rows.length}.`)}</p>}
  </details>;
}

/**
 * NovelAI's official PNG containers as *unverified candidates*. Nothing is adopted without an
 * explicit button and confirm(). Values are rendered as plain text only.
 */
export function NovelAIInfo({ metadata, slot, t = japanese, compareSeed, onAdoptSettings, onAdoptPrompts }: {
  metadata: Pick<ImageMetadata, 'texts' | 'novelai'>; slot?: string; t?: Translate; compareSeed?: string;
  onAdoptSettings?: (settings: GenerationSettings) => void;
  onAdoptPrompts?: (prompts: { positive: string | null; negative: string | null }) => void;
}) {
  const view = useMemo(() => novelaiView(metadata), [metadata.texts, metadata.novelai]);
  const [choice, setChoice] = useState('');
  if (!view) return null;
  const suffix = slot ? `・${slot}` : ''; const paren = slot ? `（${slot}）` : '';
  const chosen = view.sources.length === 1 ? view.sources[0] : view.sources.find(source => source.id === choice);
  return <section className="notice stack" aria-label={t(`NovelAIの画像情報（候補${suffix}）`, `NovelAI image info (candidates${suffix})`)}>
    <div className="section-title"><h4>{t(`NovelAIの画像情報（候補${suffix}）`, `NovelAI image info (candidates${suffix})`)}</h4><InfoTip label={t(`NovelAIの画像情報${paren}`, `NovelAI image info${paren}`)}>{t(
      'NovelAIが公開しているスクリプト（novelai-image-metadata）の形式に従い、PNGテキストのComment等と、アルファチャンネルに埋め込まれた情報（stealth_pngcomp）を読み取ります。Comment内の各項目の意味は公式文書で説明されておらず、実際のNovelAI画像でも確認していないため、生成条件には自動で採用しません。候補表はキー名から想定した対応で、型と範囲が合う値だけを示します。採用すると取得元はpng-metadata、追加条件は未確認として記録し、候補のない項目は不明のままにします。比較の固定プロンプトは変更しません。',
      'Reads PNG text keys such as Comment and the alpha-channel payload (stealth_pngcomp) in the format of NovelAI\'s published scripts (novelai-image-metadata). The meaning of the fields inside Comment is not officially documented and was not checked against real NovelAI images, so nothing is adopted automatically. The candidate table maps key names by assumption and lists only values with the expected type and range. Adopting records evidence png-metadata, leaves extra conditions unconfirmed and keeps fields without a candidate unknown. Fixed prompts are never changed.')}</InfoTip></div>
    <p><strong>{t('NovelAIの公式文書で意味が確認されていない項目です。値を確認してから採用してください。', 'These fields are not confirmed by NovelAI documentation. Check the values before adopting them.')}</strong></p>
    {view.legacy && <p className="hint">{t('以前の版で取り込んだ画像のため、PNGテキストだけを表示しています（アルファチャンネルは未確認）。', 'Imported by an earlier version: only PNG text is shown (alpha channel not checked).')}</p>}
    {view.agreement === 'mismatch' && <p role="alert">{t('PNGテキストとアルファチャンネルで内容が異なります。採用する場合は取得元を選んでください。', 'PNG text and alpha channel differ. Choose a source before adopting.')}</p>}
    {view.sources.map(source => <div className="stack" key={source.id}>
      <p>{t('取得元', 'Source')}: {source.label}</p>
      {source.comment.status === 'missing' && <p>{t('Commentがありません。', 'No Comment.')}</p>}
      {source.comment.status === 'invalid' && <p>{t(`Commentを読み取れません: ${source.comment.reason}`, `Cannot read Comment: ${source.comment.reason}`)}</p>}
      <div className="table-scroll"><table><caption className="hint">{t(`候補（${source.label}${suffix}）`, `Candidates (${source.label}${suffix})`)}</caption>
        <thead><tr><th>{t('設定', 'Setting')}</th><th>{t('元のキー', 'Key')}</th><th>{t('候補（未確認）', 'Candidate (unverified)')}</th></tr></thead>
        <tbody>{source.candidates.map(item => <tr key={item.field}><th>{item.label}</th><td>{item.from}</td><td>{cell(item, t)}</td></tr>)}</tbody></table></div>
      {compareSeed !== undefined && (() => { const seed = source.candidates.find(item => item.field === 'seed'); return <p>{t('条件のSeedとSeed候補', 'Condition seed vs. seed candidate')}: {seed?.status !== 'ok' ? t('候補なし', 'no candidate') : seed.value === compareSeed ? t('一致（未確認の値）', 'match (unverified value)') : t('不一致（未確認の値）', 'mismatch (unverified value)')}</p>; })()}
      <AllFields source={source} suffix={suffix} t={t} />
    </div>)}
    {view.sources.length > 1 && <label>{t(`採用する取得元${paren}`, `Source to adopt${paren}`)}<select value={choice} onChange={event => setChoice(event.target.value)}><option value="">{t('選択してください', 'Choose')}</option>{view.sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>}
    {(onAdoptSettings || onAdoptPrompts) && <div className="actions">
      {onAdoptSettings && <button type="button" disabled={!chosen || !hasSettingCandidates(chosen)} onClick={() => {
        if (!chosen || !confirm(t(`${slot ?? ''}の生成設定を、NovelAIの画像情報の候補（${chosen.label}）で置き換えますか？\n公式に意味が確認されていない値です。候補のない項目は不明になり、追加条件は未確認のままです。固定プロンプトは変更しません。`, `Replace the ${slot ?? ''} generation settings with the NovelAI candidates (${chosen.label})?\nThese values are not officially confirmed. Fields without a candidate become unknown. Fixed prompts are not changed.`))) return;
        onAdoptSettings(candidateSettings(chosen));
      }}>{t(`NovelAIの候補を確認して採用${paren}`, `Review and adopt NovelAI candidates${paren}`)}</button>}
      {onAdoptPrompts && <button type="button" disabled={!chosen || !hasPromptCandidates(chosen)} onClick={() => {
        if (!chosen || !confirm(t(`画像の Positive / Negative 注記を、NovelAIの画像情報の候補（${chosen.label}: Comment.prompt / Comment.uc）で置き換えますか？\n公式に意味が確認されていない値です。候補のない欄は不明になります。比較の固定プロンプトは変更しません。`, `Replace the image Positive / Negative notes with the NovelAI candidates (${chosen.label}: Comment.prompt / Comment.uc)?\nThese values are not officially confirmed. Fixed prompts are not changed.`))) return;
        onAdoptPrompts(candidatePrompts(chosen));
      }}>{t(`NovelAIのPrompt候補を画像の注記に採用${paren}`, `Adopt NovelAI prompt candidates as image notes${paren}`)}</button>}
    </div>}
  </section>;
}
