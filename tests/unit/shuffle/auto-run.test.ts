import { describe, expect, it } from 'vitest';
import type { ComposeResult } from '../../../src/core/shuffle/compose';
import { emptySessions, getSession, updateSession, type SiteSessions } from '../../../src/core/shuffle/site-session';
import type { SiteRequest } from '../../../src/platform/novelai/protocol';
import { AutoShuffleRun, CONFIG_CHANGED, STEP_CHANGED } from '../../../src/ui/shuffle/auto-run';
import { fakeSite } from './fake-site';

const composed = (text: string): ComposeResult => ({
  base: { positive: `base ${text}`, negative: '' },
  characters: [{ characterId: 'a', name: 'A', positive: `A ${text}`, negative: null, side: null }, { characterId: 'b', name: 'B', positive: `B ${text}`, negative: null, side: null }],
  pipe: null, warnings: [], errors: [], notes: [],
} as unknown as ComposeResult);

/** A gate that holds requests of chosen types until released. */
function gates() {
  const held = new Map<string, () => void>();
  const blocked = new Set<SiteRequest['type']>();
  return {
    block: (type: SiteRequest['type']) => blocked.add(type),
    release: (type: SiteRequest['type']) => { blocked.delete(type); held.get(type)?.(); held.delete(type); },
    gate: (request: SiteRequest) => blocked.has(request.type) ? new Promise<void>(resolve => held.set(request.type, resolve)) : Promise.resolve(),
    waiting: (type: SiteRequest['type']) => held.has(type),
  };
}
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

function setup(options: { every?: number } = {}) {
  const gate = gates();
  const site = fakeSite(2, { gate: gate.gate });
  const config = { fingerprint: 'cfg-1', step: 0, blocked: null as string | null };
  let sessions: SiteSessions = emptySessions();
  let shuffles = 0;
  const stops: { reason: string; isError: boolean }[] = [];
  const written: number[] = [];
  const run = new AutoShuffleRun({
    client: site.client, target: site.target, profileId: 'p1', every: options.every ?? 1, session: 'run-1', fingerprint: 'cfg-1', step: 0,
    current: () => ({ ...config }),
    shuffle: () => { shuffles++; config.step++; return { composed: composed(`#${shuffles}`), step: config.step }; },
    getSession: () => getSession(sessions, site.target, 'p1'),
    setSession: change => { sessions = updateSession(sessions, site.target, 'p1', change); },
    onProgress: () => undefined,
    onWritten: count => written.push(count),
    onStop: (reason, isError) => stops.push({ reason, isError }),
  });
  const complete = () => { site.state.completed++; };
  return { site, gate, config, run, stops, written, complete, shuffles: () => shuffles, session: () => getSession(sessions, site.target, 'p1') };
}

describe('auto shuffle run', () => {
  it('writes once per due job and records the verified write in the session', async () => {
    const t = setup();
    await t.run.tick(); // rebases on the first status
    expect(t.site.state.writes).toEqual([]);
    t.complete();
    await t.run.tick();
    expect(t.site.values.get('character:1:positive')).toBe('A #1');
    expect(t.written).toEqual([3]);
    expect(t.session().lastWritten['character:1:positive']).toBe('A #1');
    expect(t.session().baseline['character:1:positive']).toBe('site char 1');
  });

  it('stop while the status request is in flight: no prepare, no write', async () => {
    const t = setup();
    await t.run.tick();
    t.complete();
    t.gate.block('generationStatus');
    const pending = t.run.tick();
    await flush();
    expect(t.gate.waiting('generationStatus')).toBe(true);
    t.run.stop('user stop', false);
    t.gate.release('generationStatus');
    await pending;
    expect(t.site.sent.filter(type => type === 'prepareFields' || type === 'applyFields')).toEqual([]);
    expect(t.shuffles()).toBe(0);
    expect(t.site.state.writes).toEqual([]);
  });

  it('stop while the preview is being prepared: the write never starts', async () => {
    const t = setup();
    await t.run.tick();
    t.complete();
    t.gate.block('prepareFields');
    const pending = t.run.tick();
    await flush();
    expect(t.gate.waiting('prepareFields')).toBe(true);
    t.run.stop('user stop', false);
    t.gate.release('prepareFields');
    await pending;
    expect(t.site.sent).not.toContain('applyFields');
    expect(t.site.state.writes).toEqual([]);
    // Later ticks of a stopped run do nothing.
    await t.run.tick();
    expect(t.site.sent.filter(type => type === 'applyFields')).toEqual([]);
  });

  it('stop while a write is in flight: the result is still recorded, and nothing further is written', async () => {
    const t = setup();
    await t.run.tick();
    t.complete();
    t.gate.block('applyFields');
    const pending = t.run.tick();
    await flush();
    expect(t.gate.waiting('applyFields')).toBe(true);
    t.run.stop('user stop', false);
    t.gate.release('applyFields');
    await pending;
    expect(t.site.values.get('character:1:positive')).toBe('A #1');
    expect(t.session().lastWritten['character:1:positive']).toBe('A #1');
    expect(t.written).toEqual([]);
    t.complete();
    await t.run.tick();
    expect(t.site.sent.filter(type => type === 'applyFields')).toHaveLength(1);
  });

  it('a configuration change stops before shuffling or writing, even mid-tick', async () => {
    const t = setup();
    await t.run.tick();
    t.complete();
    t.gate.block('generationStatus');
    const pending = t.run.tick();
    await flush();
    t.config.fingerprint = 'cfg-2'; // e.g. seed, template, character or base prompt edited
    t.gate.release('generationStatus');
    await pending;
    expect(t.stops).toEqual([{ reason: CONFIG_CHANGED, isError: true }]);
    expect(t.shuffles()).toBe(0);
    expect(t.site.state.writes).toEqual([]);
  });

  it('a configuration change while the preview is prepared stops before the write', async () => {
    const t = setup();
    await t.run.tick();
    t.complete();
    t.gate.block('prepareFields');
    const pending = t.run.tick();
    await flush();
    t.config.fingerprint = 'cfg-2';
    t.gate.release('prepareFields');
    await pending;
    expect(t.stops[0]?.reason).toBe(CONFIG_CHANGED);
    expect(t.site.sent).not.toContain('applyFields');
  });

  it('its own shuffles never stop the run, but an external cursor change does', async () => {
    const t = setup();
    await t.run.tick();
    for (let round = 1; round <= 3; round++) { t.complete(); await t.run.tick(); }
    expect(t.stops).toEqual([]);
    expect(t.shuffles()).toBe(3);
    t.config.step = 0; // e.g. "ステップ0に戻す" or Undo
    t.complete();
    await t.run.tick();
    expect(t.stops[0]?.reason).toBe(STEP_CHANGED);
    expect(t.shuffles()).toBe(3);
  });

  it('stops instead of overwriting a site edit made after its last write', async () => {
    const t = setup();
    await t.run.tick();
    t.complete(); await t.run.tick();
    t.site.values.set('character:2:positive', 'user tweak');
    t.complete(); await t.run.tick();
    expect(t.stops[0]?.reason).toContain('キャラクター2 Prompt');
    expect(t.site.values.get('character:2:positive')).toBe('user tweak');
  });

  it('a blocked precondition (storage error, profile switch) stops without writing', async () => {
    const t = setup();
    await t.run.tick();
    t.config.blocked = '保存エラーのため履歴を保存できません';
    t.complete();
    await t.run.tick();
    expect(t.stops[0]?.reason).toContain('保存エラー');
    expect(t.site.state.writes).toEqual([]);
  });

  it('waits while generating and keeps the pending result for the next tick', async () => {
    const t = setup();
    await t.run.tick();
    t.complete();
    t.site.state.generating = true;
    await t.run.tick();
    expect(t.site.state.writes).toEqual([]);
    t.site.state.generating = false;
    await t.run.tick();
    expect(t.site.values.get('base:positive')).toBe('base #1');
    expect(t.shuffles()).toBe(1);
  });

  it('a failed write marks the fields uncertain and stops', async () => {
    const t = setup();
    await t.run.tick();
    t.complete();
    t.site.state.failWrite = 'character:2:positive';
    await t.run.tick();
    expect(t.stops).toHaveLength(1);
    expect(t.session().uncertain).toContain('character:2:positive');
    expect(t.site.values.get('base:positive')).toBe('site base');
  });

  it('stop is idempotent and releases the lease once', async () => {
    const t = setup();
    await t.run.tick();
    expect(t.site.state.running).toBe(true);
    t.run.stop('a', false); t.run.stop('b', false);
    await flush();
    expect(t.stops).toHaveLength(1);
    expect(t.site.sent.filter(type => type === 'releaseGeneration')).toHaveLength(1);
    expect(t.site.state.running).toBe(false);
  });
});

it('session helper keeps sessions for different runs separate', () => {
  expect(getSession(emptySessions(), { tabId: 1, documentId: 'x', url: 'https://novelai.net/image' }, 'p').lastWritten).toEqual({});
});
