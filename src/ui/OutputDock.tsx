import { useMemo, useState, type CSSProperties } from 'react';
import { compileSegments } from '../core/compose';
import { splitTags } from '../core/prompt-diff';
import type { CompiledPrompts, PromptWorkspace } from '../core/types';
import { groupColor } from './groupColors';
import { InfoTip } from './InfoTip';

type Channel = 'positive' | 'negative';

/**
 * The output band (docs/design/UI_REDESIGN.md): always visible, it shows the composed prompt
 * with each part underlined in its group's color, and the copy buttons. The raw text fields and
 * the NovelAI site connection stay in the 「出力プレビュー」 fold.
 */
export function OutputDock({ workspace, compiled, onCopy }: { workspace?: PromptWorkspace; compiled: CompiledPrompts; onCopy: (channel: Channel) => void }) {
  const [channel, setChannel] = useState<Channel>('positive');
  const segments = useMemo(() => workspace ? compileSegments(workspace) : { positive: [], negative: [] }, [workspace]);
  const groups = useMemo(() => new Map((workspace?.groups ?? []).map((group, index) => [group.id, { name: group.name, color: groupColor(index) }])), [workspace]);
  const text = compiled[channel];
  const tags = splitTags(text);
  const label = channel === 'positive' ? 'Positive' : 'Negative';
  return <section className="output-dock" aria-label="出力">
    <div className="dock-head">
      <div className="dock-switch" role="group" aria-label="表示する出力">
        {(['positive', 'negative'] as const).map(value => <button key={value} type="button" aria-pressed={channel === value} onClick={() => setChannel(value)}>{value === 'positive' ? 'Positive' : 'Negative'}</button>)}
      </div>
      <span className="dock-count">{text ? tags ? `${tags.length}個のタグ` : `${text.length}文字` : ''}</span>
      <InfoTip label="出力プレビュー">現在のワークスペースから合成したプロンプトです。コピーしてNovelAIに貼り付け、NovelAI上で生成してください。OFFにした部品・範囲は出力しません。下線の色はワークスペースのグループの色に対応し（点線は自由入力）、各部分にマウスを乗せるとグループ名が出ます。原文の欄とNovelAIのページへの反映は「出力プレビュー」にあります。</InfoTip>
    </div>
    <p className="dock-prompt" aria-label={`${label}の出力`}>
      {!text && <span className="dock-empty">{workspace ? '部品をONにすると、ここにプロンプトが表示されます' : 'ワークスペースを作ると、ここにプロンプトが表示されます'}</span>}
      {segments[channel].map((segment, index) => {
        if (segment.separator) return <span key={index} className="seg-joint">{segment.text}</span>;
        const group = segment.groupId ? groups.get(segment.groupId) : undefined;
        const name = group ? `グループ「${group.name}」` : '自由入力';
        return <span key={index} className={group ? 'seg' : 'seg seg-free'} style={group ? { '--seg': group.color } as CSSProperties : undefined} title={name}>{segment.text}<span className="sr-only">（{name}）</span></span>;
      })}
    </p>
    <div className="dock-actions">
      <button type="button" className="dock-copy" onClick={() => onCopy('positive')}>Positiveをコピー</button>
      <button type="button" className="dock-copy-secondary" onClick={() => onCopy('negative')}>Negativeをコピー</button>
    </div>
  </section>;
}
