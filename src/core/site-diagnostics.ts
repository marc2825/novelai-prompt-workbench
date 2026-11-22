import type { Capabilities } from '../platform/novelai/protocol';

// Diagnostics for a manual real-site check (issue #26). Only what the extension detected —
// capabilities, their reasons, field lengths — never prompt text, page titles, URLs, tab IDs or
// account details, so the result can be pasted into a public issue.

export interface DiagnosticSite { capabilities: Capabilities; path: string }
export interface DiagnosticRead { channel: 'positive' | 'negative'; length: number; lines: number }

export function siteDiagnostics(input: { appVersion: string; at: string; browser: string; uiLanguage: string; sites: readonly DiagnosticSite[]; reads: readonly DiagnosticRead[] }): string {
  const lines = [
    '## NovelAI Prompt Workbench 実サイト確認の診断情報',
    `- アプリの版: ${input.appVersion}`,
    `- 日時: ${input.at}`,
    `- ブラウザ: ${input.browser || '不明'}`,
    `- ブラウザの表示言語: ${input.uiLanguage || '不明'}`,
    `- 検出した画像生成ページ: ${input.sites.length}`,
  ];
  input.sites.forEach((site, index) => {
    lines.push(`- ページ${index + 1}（パス ${site.path}）`);
    for (const channel of ['positive', 'negative'] as const) {
      const value = site.capabilities[channel];
      lines.push(`  - ${channel}: 読取り ${value.canRead ? '可' : '不可'} / 書込み ${value.canWrite ? '可' : '不可'} — ${value.reason}`);
    }
  });
  for (const read of input.reads) lines.push(`- 読み取った ${read.channel}: ${read.length}文字・${read.lines}行（内容は含めていません）`);
  lines.push('', '（プロンプトの内容・URLのクエリ・タブのタイトル・アカウント情報は含みません）');
  return lines.join('\n');
}

/** Path of a NovelAI page without query or fragment (they may contain user data). */
export function safePath(url: string): string {
  try { const parsed = new URL(url); return parsed.hostname === 'novelai.net' ? parsed.pathname : '(NovelAI以外)'; } catch { return '(不明)'; }
}
