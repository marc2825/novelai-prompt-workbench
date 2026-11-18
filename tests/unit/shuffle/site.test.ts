import { describe, expect, it, vi } from 'vitest';
import { composeShuffle } from '../../../src/core/shuffle/compose';
import { shuffleStep } from '../../../src/core/shuffle/engine';
import { parseFieldKey, planFieldWrites, type FieldKey } from '../../../src/core/shuffle/fields';
import { observeStatus, recordManual, resetAfterShuffle, startCounter, startTracker, track, type GenerationStatus } from '../../../src/core/shuffle/generation';
import type { GenerationObserverPort, NovelAIAdapter, PromptFieldsAdapter } from '../../../src/platform/novelai/adapter';
import { SiteClient } from '../../../src/platform/novelai/client';
import { createSiteHandler, LEASE_MS } from '../../../src/platform/novelai/handler';
import { failure, isSiteRequest, isSiteResponse, PROTOCOL, type FieldSnapshot } from '../../../src/platform/novelai/protocol';
import { BASE, pointingSetup } from './helpers';

const sender = { id: 'ext', url: 'chrome-extension://ext/sidepanel.html' };

/** In-memory site with N character slots, a controllable generation observer and failure hooks. */
function fakeSite(slots = 2) {
  const values = new Map<FieldKey, string>([['base:positive', 'site base'], ['base:negative', 'site uc']]);
  for (let index = 1; index <= slots; index++) { values.set(`character:${index}:positive`, `site char ${index}`); values.set(`character:${index}:negative`, ''); }
  const state = { slots, failWrite: null as FieldKey | null, generating: false, completed: 0, observerId: 'obs-1', running: false, writes: [] as FieldKey[] };
  const snapshot = (field: FieldKey): FieldSnapshot => ({ raw: values.get(field)!, start: 0, end: 0, token: `token-${field}` });
  const fields: PromptFieldsAdapter = {
    describe: async () => ({
      base: { positive: { canRead: true, canWrite: true, reason: 'fake' }, negative: { canRead: true, canWrite: true, reason: 'fake' } },
      characters: { slots: state.slots, canRead: state.slots > 0, canWrite: state.slots > 0, reason: 'fake' },
      model: { label: 'NAI Diffusion V4 Full', reason: 'fake' },
    }),
    readField: async field => {
      const parsed = parseFieldKey(field);
      if (parsed.kind === 'character' && parsed.index > state.slots) return failure('NOT_FOUND', 'missing');
      return { ok: true, snapshot: snapshot(field) };
    },
    writeField: vi.fn(async (field: FieldKey, expected: FieldSnapshot, next: string) => {
      if (state.failWrite === field) return failure('WRITE_FAILED', 'synthetic');
      if (values.get(field) !== expected.raw) return failure('CONFLICT', 'changed');
      values.set(field, next); state.writes.push(field);
      return { ok: true as const, snapshot: snapshot(field) };
    }),
  };
  const generation: GenerationObserverPort = {
    supported: true, reason: 'fake observer',
    get running() { return state.running; },
    start: vi.fn(() => { state.running = true; }),
    stop: vi.fn(() => { state.running = false; }),
    status: (): GenerationStatus => ({ supported: true, reason: 'fake', observerId: state.observerId, generating: state.generating, completed: state.completed, failed: 0 }),
  };
  const adapter: NovelAIAdapter = {
    capabilities: async () => ({ positive: { canRead: true, canWrite: true, reason: 'fake' }, negative: { canRead: true, canWrite: true, reason: 'fake' } }),
    read: async channel => ({ ok: true, snapshot: snapshot(`base:${channel}`) }),
    write: async () => failure('UNSUPPORTED', 'not used'),
    fields, generation,
  };
  const clock = { now: 1000 };
  const scheduled: { callback: () => void; ms: number }[] = [];
  const environment = {
    extensionId: sender.id, panelUrl: sender.url, documentId: 'doc-1', isTopFrame: true,
    url: () => 'https://novelai.net/image', title: () => 'Fake', now: () => clock.now, ticket: () => `ticket-${Math.random()}`,
    schedule: (callback: () => void, ms: number) => { const entry = { callback, ms }; scheduled.push(entry); return () => { scheduled.splice(scheduled.indexOf(entry), 1); }; },
  };
  const handler = createSiteHandler(adapter, environment);
  const target = { tabId: 7, documentId: 'doc-1', url: 'https://novelai.net/image' };
  const client = new SiteClient({ listTabIds: async () => [7], send: async (_tabId, request) => handler(request, sender) });
  return { values, state, adapter, fields, generation, clock, scheduled, handler, target, client };
}

describe('multi-field protocol validation', () => {
  const target = { tabId: 1, documentId: 'd', url: 'https://novelai.net/image' };
  it('accepts well-formed field requests and rejects malformed ones', () => {
    expect(isSiteRequest({ protocol: PROTOCOL, ...target, type: 'prepareFields', characterSlots: 2, writes: [{ field: 'base:positive', text: 'x' }] })).toBe(true);
    for (const bad of [
      { type: 'prepareFields', characterSlots: 2, writes: [{ field: 'character:0:positive', text: 'x' }] },
      { type: 'prepareFields', characterSlots: 2, writes: [{ field: 'base:positive', text: 'x' }, { field: 'base:positive', text: 'y' }] },
      { type: 'prepareFields', characterSlots: 23, writes: [{ field: 'base:positive', text: 'x' }] },
      { type: 'prepareFields', characterSlots: 1, writes: [{ field: 'base:positive', text: 'x', selector: 'textarea' }] },
      { type: 'prepareFields', characterSlots: 1, writes: [] },
      { type: 'prepareFields', characterSlots: 1, writes: [{ field: 'base:positive', text: 'x'.repeat(1_000_001) }] },
      { type: 'readFields', fields: [] },
      { type: 'generationStatus', session: '' },
      { type: 'generationStatus', session: 's', click: true },
      { type: 'generate' },
    ]) expect(isSiteRequest({ protocol: PROTOCOL, ...target, ...bad })).toBe(false);
  });
  it('rejects responses that claim position control or malformed statuses', () => {
    const inspection = { ...target, base: { positive: { canRead: true, canWrite: false, reason: '' }, negative: { canRead: true, canWrite: false, reason: '' } }, characters: { slots: 0, canRead: false, canWrite: false, reason: '' }, model: { label: null, reason: '' }, positions: { supported: false, reason: '' }, generation: { supported: false, reason: '' } };
    expect(isSiteResponse({ ok: true, type: 'inspectFields', inspection })).toBe(true);
    expect(isSiteResponse({ ok: true, type: 'inspectFields', inspection: { ...inspection, positions: { supported: true, reason: '' } } })).toBe(false);
    expect(isSiteResponse({ ok: true, type: 'generationStatus', target, status: { supported: true, reason: '', observerId: 'o', generating: false, completed: -1, failed: 0 } })).toBe(false);
  });
});

describe('multi-field site handler', () => {
  const writes = [
    { field: 'base:positive' as const, text: 'new base' },
    { field: 'character:1:positive' as const, text: 'new A' },
    { field: 'character:2:positive' as const, text: 'new B' },
  ];
  it('reports adapters without field support as character-incapable, never position-capable', async () => {
    const site = fakeSite();
    const { fields: _fields, generation: _generation, ...plain } = site.adapter;
    const handler = createSiteHandler(plain, { extensionId: sender.id, panelUrl: sender.url, documentId: 'doc-1', isTopFrame: true, url: () => 'https://novelai.net/image', title: () => '', now: () => 0, ticket: () => 't' });
    const response = await handler({ protocol: PROTOCOL, ...site.target, type: 'inspectFields' }, sender);
    expect(response).toMatchObject({ ok: true, inspection: { characters: { slots: 0, canWrite: false }, positions: { supported: false }, generation: { supported: false } } });
    expect(await handler({ protocol: PROTOCOL, ...site.target, type: 'prepareFields', characterSlots: 0, writes: [writes[0]] }, sender)).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
  });

  it('prepare never writes; apply writes every field once and verifies by re-reading', async () => {
    const site = fakeSite();
    const prepared = await site.client.prepareFields(site.target, 2, writes);
    if (!prepared.ok || prepared.type !== 'prepareFields') throw new Error('prepare failed');
    expect(prepared.preview.writes.map(change => change.before)).toEqual(['site base', 'site char 1', 'site char 2']);
    expect(site.values.get('character:1:positive')).toBe('site char 1');
    const applied = await site.client.applyFields(prepared.preview);
    expect(applied).toMatchObject({ ok: true, type: 'applyFields' });
    expect(site.values.get('base:positive')).toBe('new base');
    expect(site.values.get('base:negative')).toBe('site uc');
    expect(site.state.writes).toEqual(['base:positive', 'character:1:positive', 'character:2:positive']);
    // Tickets are single-use.
    expect(await site.client.applyFields(prepared.preview)).toMatchObject({ ok: false, code: 'EXPIRED' });
  });

  it('refuses when the site character slots do not match the composition', async () => {
    const site = fakeSite(3);
    expect(await site.client.prepareFields(site.target, 2, writes)).toMatchObject({ ok: false, code: 'CONFLICT' });
    const fewer = fakeSite(1);
    expect(await fewer.client.prepareFields(fewer.target, 1, writes)).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
  });

  it('aborts with zero writes when any field was edited after the preview', async () => {
    const site = fakeSite();
    const prepared = await site.client.prepareFields(site.target, 2, writes);
    if (!prepared.ok || prepared.type !== 'prepareFields') throw new Error('prepare failed');
    site.values.set('character:2:positive', 'user edit');
    expect(await site.client.applyFields(prepared.preview)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(site.state.writes).toEqual([]);
    expect(site.values.get('character:2:positive')).toBe('user edit');
  });

  it('rolls back only its own unchanged writes when a later field fails', async () => {
    const site = fakeSite();
    const prepared = await site.client.prepareFields(site.target, 2, writes);
    if (!prepared.ok || prepared.type !== 'prepareFields') throw new Error('prepare failed');
    site.state.failWrite = 'character:2:positive';
    const result = await site.client.applyFields(prepared.preview);
    expect(result).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
    expect(site.values.get('base:positive')).toBe('site base');
    expect(site.values.get('character:1:positive')).toBe('site char 1');
  });

  it('expires previews and never writes while generation is running', async () => {
    const site = fakeSite();
    const prepared = await site.client.prepareFields(site.target, 2, writes);
    if (!prepared.ok || prepared.type !== 'prepareFields') throw new Error('prepare failed');
    site.clock.now += 60_000;
    expect(await site.client.applyFields(prepared.preview)).toMatchObject({ ok: false, code: 'EXPIRED' });
    site.clock.now = 1000;
    await site.client.generationStatus(site.target, 'panel-a');
    site.state.generating = true;
    expect(await site.client.prepareFields(site.target, 2, writes)).toMatchObject({ ok: false, code: 'BUSY' });
    site.state.generating = false;
    const again = await site.client.prepareFields(site.target, 2, writes);
    if (!again.ok || again.type !== 'prepareFields') throw new Error('prepare failed');
    site.state.generating = true;
    expect(await site.client.applyFields(again.preview)).toMatchObject({ ok: false, code: 'BUSY' });
    expect(site.state.writes).toEqual([]);
  });

  it('grants the generation observer to one panel at a time and stops it when the lease ends', async () => {
    const site = fakeSite();
    expect(site.state.running).toBe(false);
    expect(await site.client.generationStatus(site.target, 'panel-a')).toMatchObject({ ok: true, status: { supported: true, completed: 0 } });
    expect(site.state.running).toBe(true);
    expect(await site.client.generationStatus(site.target, 'panel-b')).toMatchObject({ ok: false, code: 'BUSY' });
    // An expired lease can be taken over; the scheduled check stops an unused observer.
    site.clock.now += LEASE_MS + 1;
    site.scheduled.at(-1)!.callback();
    expect(site.state.running).toBe(false);
    expect(await site.client.generationStatus(site.target, 'panel-b')).toMatchObject({ ok: true });
    expect(await site.client.releaseGeneration(site.target, 'panel-a')).toMatchObject({ ok: true });
    expect(site.state.running).toBe(true);
    await site.client.releaseGeneration(site.target, 'panel-b');
    expect(site.state.running).toBe(false);
  });

  it('rejects stale documents and unauthorized senders for field operations', async () => {
    const site = fakeSite();
    expect(await site.handler({ protocol: PROTOCOL, ...site.target, documentId: 'old', type: 'readFields', fields: ['base:positive'] }, sender)).toMatchObject({ ok: false, code: 'STALE_DOCUMENT' });
    expect(await site.handler({ protocol: PROTOCOL, ...site.target, type: 'readFields', fields: ['base:positive'] }, { id: 'ext', url: 'https://evil.test/' })).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });
});

describe('generation tracking', () => {
  it('counts each successful job once, ignores re-renders, baselines and failures', () => {
    let state = startTracker({ phase: 'succeeded', jobId: 'old' });
    state = track(state, { phase: 'succeeded', jobId: 'old' });
    expect(state.completed).toBe(0);
    state = track(state, { phase: 'generating', jobId: 'j1' });
    expect(state.phase).toBe('generating');
    state = track(state, { phase: 'succeeded', jobId: 'j1' });
    state = track(state, { phase: 'succeeded', jobId: 'j1' });
    state = track(state, { phase: 'missing', jobId: null });
    expect(state.phase).toBe('unknown');
    state = track(state, { phase: 'succeeded', jobId: 'j1' });
    state = track(state, { phase: 'failed', jobId: 'j2' });
    state = track(state, { phase: 'succeeded', jobId: null });
    state = track(state, { phase: 'succeeded', jobId: 'j3' });
    expect(state).toMatchObject({ completed: 2, failed: 1, phase: 'idle' });
    for (let index = 0; index < 150; index++) state = track(state, { phase: 'succeeded', jobId: `bulk-${index}` });
    expect(state.settled.length).toBeLessThanOrEqual(100);
  });

  it('counts per observer, rebases on restart, and triggers one shuffle for a burst', () => {
    let counter = startCounter(5);
    let update = observeStatus(counter, { observerId: 'a', completed: 3 });
    expect(update).toMatchObject({ rebased: true, counted: 0, due: false });
    counter = update.counter;
    update = observeStatus(counter, { observerId: 'a', completed: 3 });
    expect(update.counted).toBe(0);
    update = observeStatus(update.counter, { observerId: 'a', completed: 7 });
    expect(update).toMatchObject({ counted: 4, due: false });
    update = observeStatus(update.counter, { observerId: 'a', completed: 9 });
    expect(update).toMatchObject({ counted: 2, due: true });
    counter = resetAfterShuffle(update.counter);
    expect(counter.count).toBe(0);
    expect(observeStatus(counter, { observerId: 'b', completed: 0 })).toMatchObject({ rebased: true, counted: 0 });
    expect(observeStatus(counter, { observerId: 'a', completed: 1 })).toMatchObject({ rebased: true });
    expect(recordManual(startCounter(1))).toMatchObject({ due: true, counted: 1 });
    expect(() => startCounter(0)).toThrow();
  });
});

describe('integration: shuffle → compose → safe multi-field write', () => {
  it('applies successive shuffles without tag growth and stops on a user edit', async () => {
    const { shuffle, profile } = pointingSetup();
    const site = fakeSite(2);
    let current = profile;
    let lastWritten: Partial<Record<FieldKey, string>> = {};
    for (let round = 0; round < 4; round++) {
      const outcome = shuffleStep(shuffle, current);
      current = { ...current, cursor: outcome.cursor, current: outcome.selection };
      const composed = composeShuffle({ library: shuffle, profile: current, selection: outcome.selection, base: BASE });
      const prepared = await site.client.prepareFields(site.target, composed.characters.length, planFieldWrites(composed));
      if (!prepared.ok || prepared.type !== 'prepareFields') throw new Error('prepare failed');
      if (round > 0) expect(prepared.preview.writes.every(change => lastWritten[change.field] === change.before)).toBe(true);
      const applied = await site.client.applyFields(prepared.preview);
      if (!applied.ok || applied.type !== 'applyFields') throw new Error('apply failed');
      lastWritten = Object.fromEntries(applied.values.map(value => [value.field, value.raw]));
      expect(site.values.get('base:positive')).toBe('2girls, indoors');
      expect(site.values.get('character:1:positive')!.split('#').length).toBe(2);
    }
    site.values.set('character:1:positive', 'hand edited');
    const composed = composeShuffle({ library: shuffle, profile: current, selection: shuffleStep(shuffle, current).selection, base: BASE });
    const prepared = await site.client.prepareFields(site.target, 2, planFieldWrites(composed));
    if (!prepared.ok || prepared.type !== 'prepareFields') throw new Error('prepare failed');
    const edited = prepared.preview.writes.filter(change => lastWritten[change.field] !== change.before);
    expect(edited.map(change => change.field)).toEqual(['character:1:positive']);
    expect(site.values.get('character:1:positive')).toBe('hand edited');
  });
});
