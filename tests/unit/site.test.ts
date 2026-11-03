import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '../../src/core/types';
import type { NovelAIAdapter } from '../../src/platform/novelai/adapter';
import { SiteClient } from '../../src/platform/novelai/client';
import { createSiteHandler } from '../../src/platform/novelai/handler';
import { failure, isImageUrl, isSiteRequest, isSiteResponse, planSiteText, PROTOCOL, type Capabilities, type FieldSnapshot, type SiteRequest, type WritePreview } from '../../src/platform/novelai/protocol';

const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/sidepanel.html' };
function setup(tabId = 1) {
  const location = { url: 'https://novelai.net/image', clock: 1000 };
  const states: Record<Channel, FieldSnapshot> = {
    positive: { raw: 'before 🌟', start: 6, end: 6, token: 'positive-field' },
    negative: { raw: 'negative', start: 8, end: 8, token: 'negative-field' },
  };
  const caps: Capabilities = { positive: { canRead: true, canWrite: true, reason: 'fixture' }, negative: { canRead: true, canWrite: true, reason: 'fixture' } };
  const adapter: NovelAIAdapter = {
    capabilities: vi.fn(async () => caps),
    read: vi.fn<NovelAIAdapter['read']>(async channel => ({ ok: true, snapshot: { ...states[channel] } })),
    write: vi.fn<NovelAIAdapter['write']>(async (channel, expected, next, mode) => {
      const state = states[channel];
      if (state.raw !== expected.raw || state.token !== expected.token || (mode === 'insert' && (state.start !== expected.start || state.end !== expected.end))) return failure('CONFLICT', 'changed');
      states[channel] = { ...state, raw: next };
      return { ok: true, snapshot: { ...states[channel] } };
    }),
  };
  const environment = { extensionId: sender.id, panelUrl: sender.url, documentId: `document-${tabId}`, isTopFrame: true, url: () => location.url, title: () => 'Fixture', now: () => location.clock, ticket: () => `ticket-${Math.random()}` };
  const handler = createSiteHandler(adapter, environment);
  const target = { tabId, documentId: environment.documentId, url: location.url };
  const send = (extra: Record<string, unknown>, source = sender) => handler({ protocol: PROTOCOL, ...target, ...extra }, source);
  const prepare = async (channel: Channel = 'positive', mode: 'insert' | 'replace' = 'replace', text = 'after') => {
    const response = await send({ type: 'prepare', channel, mode, text });
    if (!response.ok || response.type !== 'prepare') throw new Error('Failed to prepare');
    return response.preview;
  };
  return { adapter, states, caps, environment, location, target, handler, send, prepare };
}

describe('P2 message schema and literal insertion', () => {
  it.each(['https://novelai.net/image', 'https://novelai.net/image/', 'https://novelai.net/image/path?x=1#test'])('accepts the exact image path only: %s', url => expect(isImageUrl(url)).toBe(true));
  it.each(['https://evil.test/image', 'https://novelai.net/imagery', 'https://novelai.net/', 'http://novelai.net/image', 'https://novelai.net.evil.test/image', 'https://user:password@novelai.net/image', 'not-url'])('rejects unsupported URLs: %s', url => expect(isImageUrl(url)).toBe(false));
  it('rejects malformed messages, unknown operations, extra fields and oversize input', () => {
    expect(isSiteRequest({ protocol: PROTOCOL, type: 'inspect', tabId: 1 })).toBe(true);
    for (const input of [null, [], { protocol: PROTOCOL, type: 'inspect', tabId: -1 }, { protocol: PROTOCOL, type: 'generate', tabId: 1 }, { protocol: PROTOCOL, type: 'inspect', tabId: 1, selector: 'textarea' }]) expect(isSiteRequest(input)).toBe(false);
    const target = setup().target;
    expect(isSiteRequest({ protocol: PROTOCOL, ...target, type: 'prepare', channel: 'positive', mode: 'replace', text: 'x'.repeat(1_000_001) })).toBe(false);
    expect(isSiteResponse({ ok: false, code: 'UNKNOWN', reason: 'test' })).toBe(false);
    expect(isSiteResponse({ ok: true, type: 'apply', target, channel: 'unknown', raw: '' })).toBe(false);
  });
  it('inserts exactly at the selection without parsing weights, macros or commas', () => {
    const snapshot = { raw: 'a🌟z', start: 1, end: 3, token: 'field' };
    const raw = '{{髪}}, [tag], 1.2::light:: | !macro:Name!';
    expect(planSiteText(snapshot, raw, 'insert')).toBe(`a${raw}z`);
    expect(planSiteText(snapshot, '', 'replace')).toBe('');
    expect(() => planSiteText({ ...snapshot, end: 999 }, 'x', 'insert')).toThrow();
    expect(() => planSiteText({ ...snapshot, start: 2, end: 2 }, 'x', 'insert')).toThrow('Unicode');
  });
});

describe('P2 content handler / AC13–AC14', () => {
  it('requires extension-panel sender, top frame and supported origin/path', async () => {
    const instance = setup();
    for (const source of [{}, { id: sender.id, url: 'https://novelai.net/image' }, { ...sender, tab: { id: 1 } }]) {
      expect(await instance.handler({ protocol: PROTOCOL, type: 'inspect', tabId: 1 }, source)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    }
    instance.environment.isTopFrame = false;
    expect(await instance.handler({ protocol: PROTOCOL, type: 'inspect', tabId: 1 }, sender)).toMatchObject({ code: 'UNSUPPORTED_PAGE' });
    instance.environment.isTopFrame = true; instance.location.url = 'https://novelai.net/stories';
    expect(await instance.send({ type: 'read', channel: 'positive' })).toMatchObject({ code: 'UNSUPPORTED_PAGE' });
    expect(instance.adapter.write).not.toHaveBeenCalled();
  });
  it('inspect exposes only capabilities; read is channel-specific and neither mutates the site', async () => {
    const instance = setup();
    expect(await instance.handler({ protocol: PROTOCOL, type: 'inspect', tabId: 1 }, sender)).toEqual({ ok: true, type: 'inspect', inspection: { ...instance.target, title: 'Fixture', capabilities: instance.caps } });
    expect(await instance.send({ type: 'read', channel: 'negative' })).toMatchObject({ ok: true, raw: 'negative', channel: 'negative' });
    expect(instance.adapter.write).not.toHaveBeenCalled();
  });
  it.each(['insert', 'replace'] as const)('prepares without writing, then applies %s with CAS and independent channel readback', async mode => {
    const instance = setup();
    const preview = await instance.prepare('positive', mode, '{{after}}');
    expect(instance.states.positive.raw).toBe('before 🌟');
    expect(instance.adapter.write).not.toHaveBeenCalled();
    const applied = await instance.send({ type: 'apply', ticket: preview.ticket });
    expect(applied).toMatchObject({ ok: true, channel: 'positive', raw: mode === 'insert' ? 'before{{after}} 🌟' : '{{after}}' });
    expect(instance.states.negative.raw).toBe('negative');
    expect(instance.adapter.write).toHaveBeenCalledTimes(1);
    expect(await instance.send({ type: 'apply', ticket: preview.ticket })).toMatchObject({ code: 'EXPIRED' });
  });
  it('allows explicit empty replacement on negative without touching positive', async () => {
    const instance = setup(); const preview = await instance.prepare('negative', 'replace', '');
    expect(await instance.send({ type: 'apply', ticket: preview.ticket })).toMatchObject({ ok: true, raw: '' });
    expect(instance.states.positive.raw).toBe('before 🌟');
  });
  it.each(['raw', 'token', 'selection'] as const)('rejects a changed %s after preview', async change => {
    const instance = setup(); const preview = await instance.prepare('positive', 'insert');
    if (change === 'raw') instance.states.positive.raw = 'user edit';
    if (change === 'token') instance.states.positive.token = 'replacement-field';
    if (change === 'selection') instance.states.positive.start = 0;
    const before = { ...instance.states.positive };
    expect(await instance.send({ type: 'apply', ticket: preview.ticket })).toMatchObject({ code: 'CONFLICT' });
    expect(instance.states.positive).toEqual(before);
  });
  it('rejects timeout, wrong tab, SPA navigation and full reload tickets', async () => {
    const instance = setup(); let preview = await instance.prepare();
    instance.location.clock = preview.expiresAt;
    expect(await instance.send({ type: 'apply', ticket: preview.ticket })).toMatchObject({ code: 'EXPIRED' });
    preview = await instance.prepare();
    expect(await instance.send({ type: 'apply', ticket: preview.ticket, tabId: 2 })).toMatchObject({ code: 'EXPIRED' });
    preview = await instance.prepare(); instance.location.url += '#changed';
    expect(await instance.send({ type: 'apply', ticket: preview.ticket })).toMatchObject({ code: 'STALE_DOCUMENT' });
    const reloaded = createSiteHandler(instance.adapter, { ...instance.environment, documentId: 'new-document' });
    expect(await reloaded({ protocol: PROTOCOL, ...instance.target, type: 'apply', ticket: preview.ticket }, sender)).toMatchObject({ code: 'STALE_DOCUMENT' });
    expect(instance.adapter.write).not.toHaveBeenCalled();
  });
  it('handles missing input and read-only capability without writing', async () => {
    const instance = setup();
    vi.mocked(instance.adapter.read).mockResolvedValue(failure('NOT_FOUND', 'missing'));
    expect(await instance.send({ type: 'read', channel: 'positive' })).toMatchObject({ code: 'NOT_FOUND' });
    instance.caps.positive.canWrite = false;
    expect(await instance.send({ type: 'prepare', channel: 'positive', mode: 'replace', text: 'x' })).toMatchObject({ code: 'UNSUPPORTED' });
    expect(instance.adapter.write).not.toHaveBeenCalled();
  });
  it('reports write failure or mismatching readback without retrying', async () => {
    const instance = setup(); let preview = await instance.prepare();
    vi.mocked(instance.adapter.write).mockResolvedValue(failure('WRITE_FAILED', 'failure'));
    expect(await instance.send({ type: 'apply', ticket: preview.ticket })).toMatchObject({ code: 'WRITE_FAILED' });
    preview = await instance.prepare();
    vi.mocked(instance.adapter.write).mockResolvedValue({ ok: true, snapshot: instance.states.positive });
    expect(await instance.send({ type: 'apply', ticket: preview.ticket })).toMatchObject({ code: 'VERIFY_FAILED' });
    expect(instance.adapter.write).toHaveBeenCalledTimes(2);
    expect(instance.states.positive.raw).toBe('before 🌟');
  });
  it('serializes apply operations while the readback is pending', async () => {
    const instance = setup(); const preview = await instance.prepare();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(instance.adapter.write).mockImplementation(async () => { await gate; return failure('WRITE_FAILED', 'test'); });
    const applying = instance.send({ type: 'apply', ticket: preview.ticket });
    expect(await instance.send({ type: 'apply', ticket: preview.ticket })).toMatchObject({ code: 'BUSY' });
    release(); await applying;
    expect(instance.adapter.write).toHaveBeenCalledTimes(1);
  });
});

describe('P2 tab transport', () => {
  it('discovers multiple tabs without prompt read and writes only the explicitly selected target', async () => {
    const first = setup(1); const second = setup(2);
    const send = vi.fn(async (tabId: number, request: SiteRequest) => {
      if (tabId === 3) throw new Error('No content script');
      return (tabId === 1 ? first : second).handler(request, sender);
    });
    const client = new SiteClient({ listTabIds: async () => [1, 2, 3], send });
    const result = await client.discover();
    expect(result).toMatchObject({ ok: true, sites: [{ tabId: 1 }, { tabId: 2 }] });
    expect(send.mock.calls.every(([, request]) => request.type === 'inspect')).toBe(true);
    if (!result.ok) throw new Error('Missing inspection');
    const inspected = result.sites.find(site => site.tabId === 2)!;
    expect(await client.read(inspected, 'negative')).toMatchObject({ ok: true, raw: 'negative' });
    const prepared = await client.prepare(inspected, 'negative', 'replace', 'only tab 2');
    expect(prepared.ok && prepared.type === 'prepare').toBe(true);
    await client.apply((prepared as { preview: WritePreview }).preview);
    expect(second.states.negative.raw).toBe('only tab 2');
    expect(first.states.negative.raw).toBe('negative');
  });
  it('rejects forged targets, channels, response types and unverifiable write success', async () => {
    const target = setup().target;
    const transport = { listTabIds: async () => [1], send: vi.fn(async () => ({ ok: true, type: 'read', target: { ...target, tabId: 2 }, channel: 'positive', raw: '' })) };
    const client = new SiteClient(transport);
    expect(await client.read(target, 'positive')).toMatchObject({ code: 'STALE_DOCUMENT' });
    transport.send.mockResolvedValue({ ok: true, type: 'read', target, channel: 'negative', raw: '' });
    expect(await client.read(target, 'positive')).toMatchObject({ code: 'INVALID_MESSAGE' });
    expect(await client.prepare(target, 'positive', 'replace', '')).toMatchObject({ code: 'INVALID_MESSAGE' });
    transport.send.mockResolvedValue({ ok: true, type: 'apply', target, channel: 'positive', raw: 'wrong' });
    expect(await client.apply({ ...target, ticket: 'ticket', before: '', after: 'expected', channel: 'positive', mode: 'replace', expiresAt: 99 })).toMatchObject({ code: 'VERIFY_FAILED' });
  });
  it('reports disconnected tabs and bounds an unresponsive receiver', async () => {
    vi.useFakeTimers();
    try {
      const client = new SiteClient({ listTabIds: async () => [1], send: () => new Promise(() => {}) });
      const waiting = client.read(setup().target, 'positive');
      await vi.advanceTimersByTimeAsync(5000);
      expect(await waiting).toMatchObject({ code: 'DISCONNECTED' });
    } finally { vi.useRealTimers(); }
  });
});
