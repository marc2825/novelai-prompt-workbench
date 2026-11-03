import { useEffect, useRef, useState } from 'react';
import type { Channel, CompiledPrompts } from '../core/types';
import type { SiteClient } from '../platform/novelai/client';
import type { SiteInspection, WriteMode, WritePreview } from '../platform/novelai/protocol';

export function SiteConnection({ client, compiled, onImport }: { client?: SiteClient; compiled: CompiledPrompts; onImport: (channel: Channel, raw: string) => void }) {
  const [sites, setSites] = useState<SiteInspection[]>([]);
  const [selected, setSelected] = useState('');
  const [channel, setChannel] = useState<Channel>('positive');
  const [mode, setMode] = useState<WriteMode>('insert');
  const [preview, setPreview] = useState<WritePreview | null>(null);
  const [lastAttempt, setLastAttempt] = useState<WritePreview | null>(null);
  const [read, setRead] = useState<{ channel: Channel; raw: string; tabId: number; documentId: string } | null>(null);
  const [issue, setIssue] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const site = sites.find(item => String(item.tabId) === selected);
  useEffect(() => { version.current++; setPreview(null); setRead(null); setNotice(''); }, [compiled.positive, compiled.negative, selected, channel, mode]);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => { setPreview(null); setIssue('プレビューの有効期限が切れました。作成し直してください'); }, Math.max(0, preview.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [preview]);

  if (!client) return <div className="stack"><button type="button" disabled>NovelAIに反映（P2）</button><small>サイト連携はChrome拡張から利用できます。ローカルfixtureではコピーを使用してください。</small></div>;
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setIssue(''); setNotice('');
    try { await action(); } catch { setIssue('サイトとの通信に失敗しました。コピーを使用してください'); }
    finally { setBusy(false); }
  };

  return <section className="stack site-connection" aria-label="NovelAIサイト連携">
    <h2>NovelAIサイト連携</h2><p className="hint">対象タブを選択してください。トグル変更だけではサイトを書き換えません。入力はチャンネルごとに確認して反映します。</p>
    <button type="button" disabled={busy} onClick={() => void perform(async () => {
      version.current++; setPreview(null); setRead(null);
      const result = await client.discover();
      if (!result.ok) { setSites([]); setIssue(result.reason); return; }
      setSites(result.sites);
      setSelected(''); // Never auto-select a tab, including when only one exists.
      setNotice(result.sites.length ? `${result.sites.length}個の画像ページを検出しました。対象を選択してください。` : 'NovelAI画像ページに接続できません。ページを開くか再読込してください。コピーは利用できます。');
    })}>NovelAIの接続を確認</button>
    <label>対象タブ<select value={selected} disabled={busy} onChange={event => { version.current++; setSelected(event.target.value); setIssue(''); }}><option value="">対象を選択</option>{sites.map(item => <option key={item.tabId} value={item.tabId}>タブ {item.tabId}: {item.title} — {item.url}</option>)}</select></label>
    <div className="columns"><label>反映チャンネル<select value={channel} disabled={busy} onChange={event => { version.current++; setChannel(event.target.value as Channel); }}><option value="positive">Positive</option><option value="negative">Negative</option></select></label><label>反映方法<select value={mode} disabled={busy} onChange={event => { version.current++; setMode(event.target.value as WriteMode); }}><option value="insert">選択範囲へ原文どおり挿入</option><option value="replace">入力欄全体を置換</option></select></label></div>
    {site && <p className="hint">{site.capabilities[channel].reason}</p>}
    <div className="actions"><button type="button" disabled={busy || !site?.capabilities[channel].canRead} onClick={() => void perform(async () => {
      if (!site) return;
      setPreview(null); setRead(null); const generation = version.current;
      const result = await client.read(site, channel);
      if (generation !== version.current) return;
      if (!result.ok) { setIssue(result.reason); return; }
      if (result.type !== 'read') { setIssue('予期しない読取り応答です'); return; }
      setRead({ channel, raw: result.raw, tabId: site.tabId, documentId: site.documentId });
      setNotice('現在の入力を読み取りました。サイトは変更していません。');
    })}>サイトの現在値を読む</button>
    <button type="button" disabled={busy || !site?.capabilities[channel].canWrite || !!compiled.warnings.length} onClick={() => void perform(async () => {
      if (!site) return;
      setPreview(null); setRead(null); const generation = version.current;
      const result = await client.prepare(site, channel, mode, compiled[channel]);
      if (generation !== version.current) return;
      if (!result.ok) { setIssue(result.reason); return; }
      if (result.type !== 'prepare') { setIssue('予期しないプレビュー応答です'); return; }
      setPreview(result.preview);
    })}>反映プレビューを作成</button></div>
    {read && read.tabId === site?.tabId && read.documentId === site.documentId && <div className="stack"><label>サイトの現在値 ({read.channel})<textarea readOnly rows={3} value={read.raw} /></label><button type="button" disabled={busy} onClick={() => {
      if (confirm(`${read.channel}の自由入力をサイトから読んだ内容に置換しますか？コメント範囲も解除します。Undoで戻せます。`)) onImport(read.channel, read.raw);
    }}>読取り結果を自由入力へ取り込む</button></div>}
    {preview && <div className="panel stack" aria-label="サイト反映前の確認"><p>タブ{preview.tabId} / {preview.channel} / {preview.mode === 'replace' ? '全置換' : '選択範囲に挿入'}</p><small>{preview.url}</small><label>反映前<textarea readOnly value={preview.before} /></label><label>反映後<textarea readOnly value={preview.after} /></label><p className="hint">挿入時も区切り文字を自動補完しません。表示された全文で正しいことを確認してください。有効期限60秒。</p><div className="actions"><button type="button" disabled={busy} onClick={() => void perform(async () => {
      if (!confirm(`タブ${preview.tabId}の${preview.channel}を、表示した反映後の内容に変更しますか？`)) return;
      const accepted = preview; setLastAttempt(accepted); setPreview(null);
      const result = await client.apply(accepted);
      if (!result.ok) { setIssue(result.reason); return; }
      if (result.type !== 'apply') { setIssue('反映結果を確認できません'); return; }
      setNotice(`タブ${result.target.tabId}の${result.channel}を反映し、再読取りで一致を確認しました。生成操作は行っていません。`);
    })}>確認してサイトに反映</button><button type="button" disabled={busy} onClick={() => setPreview(null)}>反映をキャンセル</button></div></div>}
    {lastAttempt && <details><summary>直前のサイト操作の復旧用原文（タブ{lastAttempt.tabId} / {lastAttempt.channel}）</summary><div className="stack"><label>直前の反映前原文<textarea readOnly value={lastAttempt.before} /></label><p className="hint">画面を閉じるまで保持します。復旧が必要なら原文を選択してコピーしてください。Undoはサイト操作を戻しません。</p><button type="button" onClick={() => setLastAttempt(null)}>復旧用原文を閉じる</button></div></details>}
    {issue && <p role="alert">{issue}</p>}{notice && <p role="status">{notice}</p>}
    <small>読取り専用・未検出・曖昧な入力欄には書き込みません。コピーは上のボタンから利用できます。</small>
  </section>;
}
