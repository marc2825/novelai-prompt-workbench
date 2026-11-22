import { describe, expect, it } from 'vitest';
import { safePath, siteDiagnostics } from '../../src/core/site-diagnostics';

describe('real-site check diagnostics (issue #26)', () => {
  const capabilities = { positive: { canRead: true, canWrite: false, reason: '読取りのみ（書込みは未検証のため無効）' }, negative: { canRead: false, canWrite: false, reason: '欄が見つかりません' } };
  it('reports capabilities, reasons and lengths without prompt text, URLs or titles', () => {
    const text = siteDiagnostics({ appVersion: '0.2.0', at: '2026-11-22T00:00:00.000Z', browser: 'Chromium 150', uiLanguage: 'ja', sites: [{ capabilities, path: safePath('https://novelai.net/image?secret=prompt#x') }], reads: [{ channel: 'positive', length: 42, lines: 2 }] });
    expect(text).toContain('アプリの版: 0.2.0');
    expect(text).toContain('positive: 読取り 可 / 書込み 不可 — 読取りのみ');
    expect(text).toContain('negative: 読取り 不可 / 書込み 不可 — 欄が見つかりません');
    expect(text).toContain('読み取った positive: 42文字・2行');
    expect(text).toContain('パス /image）');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('http');
  });
  it('keeps only the path of NovelAI pages', () => {
    expect(safePath('https://novelai.net/image/abc?q=1')).toBe('/image/abc');
    expect(safePath('https://example.com/image')).toBe('(NovelAI以外)');
    expect(safePath('not a url')).toBe('(不明)');
  });
});
