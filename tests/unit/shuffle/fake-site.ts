import { vi } from 'vitest';
import { parseFieldKey, type FieldKey } from '../../../src/core/shuffle/fields';
import type { GenerationStatus } from '../../../src/core/shuffle/generation';
import type { GenerationObserverPort, NovelAIAdapter, PromptFieldsAdapter } from '../../../src/platform/novelai/adapter';
import { SiteClient } from '../../../src/platform/novelai/client';
import { createSiteHandler } from '../../../src/platform/novelai/handler';
import { failure, type FieldSnapshot, type SiteRequest } from '../../../src/platform/novelai/protocol';

export const sender = { id: 'ext', url: 'chrome-extension://ext/sidepanel.html' };

/** In-memory site with N character slots, a controllable generation observer and failure hooks. */
export function fakeSite(slots = 2, options: { tabId?: number; documentId?: string; gate?: (request: SiteRequest) => Promise<void> } = {}) {
  const values = new Map<FieldKey, string>([['base:positive', 'site base'], ['base:negative', 'site uc']]);
  for (let index = 1; index <= slots; index++) { values.set(`character:${index}:positive`, `site char ${index}`); values.set(`character:${index}:negative`, ''); }
  const state = { slots, failWrite: null as FieldKey | null, conflictWrite: null as FieldKey | null, generating: false, completed: 0, observerId: 'obs-1', running: false, writes: [] as FieldKey[] };
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
      if (state.conflictWrite === field) return failure('CONFLICT', 'changed between check and write');
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
  const tabId = options.tabId ?? 7;
  environment.documentId = options.documentId ?? 'doc-1';
  const handler = createSiteHandler(adapter, environment);
  const target = { tabId, documentId: environment.documentId, url: 'https://novelai.net/image' };
  const sent: SiteRequest['type'][] = [];
  const client = new SiteClient({ listTabIds: async () => [tabId], send: async (_tabId, request) => { sent.push(request.type); await options.gate?.(request); return handler(request, sender); } });
  return { values, state, adapter, fields, generation, clock, scheduled, handler, target, client, sent };
}

