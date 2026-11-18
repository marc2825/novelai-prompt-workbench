import { describe, expect, it } from 'vitest';
import type { FieldKey } from '../../../src/core/shuffle/fields';
import {
  afterApplyAttempt, afterRestore, editedFields, emptySessions, getSession, hasRestoreText, MAX_SITE_SESSIONS, NO_WRITE_CODES,
  observeExpected, otherRestoreSessions, putSession, restoreWrites, sessionKey, updateSession, withBaseline, type SiteDocumentRef,
} from '../../../src/core/shuffle/site-session';
import { createSiteHandler } from '../../../src/platform/novelai/handler';
import { PROTOCOL } from '../../../src/platform/novelai/protocol';
import { fakeSite, sender } from './fake-site';

const URL_ = 'https://novelai.net/image';
const tabA: SiteDocumentRef = { tabId: 1, documentId: 'doc-a', url: URL_ };
const tabB: SiteDocumentRef = { tabId: 2, documentId: 'doc-b', url: URL_ };
const tabAReloaded: SiteDocumentRef = { tabId: 1, documentId: 'doc-a2', url: URL_ };
const change = (field: FieldKey, before: string, after = 'new') => ({ field, before, after });
const applied = (fields: [FieldKey, string][]) => ({ ok: true as const, values: fields.map(([field, raw]) => ({ field, raw })) });

describe('site sessions are scoped to tab, document and profile', () => {
  const applyOnA = () => updateSession(emptySessions(), tabA, 'p1', session => afterApplyAttempt(session, [change('base:positive', 'original A')], applied([['base:positive', 'shuffled A']])));

  it('Restore text recorded on tab A is not available on tab B', () => {
    const store = applyOnA();
    expect(restoreWrites(getSession(store, tabA, 'p1'))).toEqual([{ field: 'base:positive', text: 'original A' }]);
    const onB = getSession(store, tabB, 'p1');
    expect(hasRestoreText(onB)).toBe(false);
    expect(restoreWrites(onB)).toEqual([]);
    // Tab A's last write does not make tab B's content look "edited".
    expect(editedFields(onB, [change('base:positive', 'site B text')])).toEqual([]);
  });

  it('a reloaded document (same tab, new documentId) starts a fresh session; the old text stays copy-only', () => {
    const store = applyOnA();
    expect(hasRestoreText(getSession(store, tabAReloaded, 'p1'))).toBe(false);
    const current = getSession(store, tabAReloaded, 'p1');
    expect(otherRestoreSessions(store, current.key).map(item => item.target.documentId)).toEqual(['doc-a']);
  });

  it('another profile cannot use the reflection info of the first profile', () => {
    const store = applyOnA();
    expect(hasRestoreText(getSession(store, tabA, 'p2'))).toBe(false);
    expect(getSession(store, tabA, 'p2').lastWritten).toEqual({});
    expect(sessionKey(tabA, 'p1')).not.toBe(sessionKey(tabA, 'p2'));
  });

  it('detects edits made on the site after the last verified write', () => {
    const session = getSession(applyOnA(), tabA, 'p1');
    expect(editedFields(session, [change('base:positive', 'shuffled A')])).toEqual([]);
    expect(editedFields(session, [change('base:positive', 'user edit')]).map(item => item.field)).toEqual(['base:positive']);
  });

  it('the first write keeps the baseline; later writes never replace it', () => {
    let store = applyOnA();
    store = updateSession(store, tabA, 'p1', session => afterApplyAttempt(session, [change('base:positive', 'shuffled A')], applied([['base:positive', 'shuffled again']])));
    expect(getSession(store, tabA, 'p1').baseline).toEqual({ 'base:positive': 'original A' });
  });
});

describe('apply failures', () => {
  it('a failure before any write changes nothing (no baseline, nothing uncertain)', () => {
    for (const code of NO_WRITE_CODES) {
      const session = afterApplyAttempt(getSession(emptySessions(), tabA, 'p1'), [change('base:positive', 'original')], { ok: false, code });
      expect(hasRestoreText(session)).toBe(false);
      expect(session.uncertain).toEqual([]);
    }
  });
  it('a failure that may have written keeps the baseline and marks every field uncertain', () => {
    for (const code of ['WRITE_FAILED', 'VERIFY_FAILED', 'DISCONNECTED', 'INVALID_MESSAGE', 'SOMETHING_NEW']) {
      const session = afterApplyAttempt(getSession(emptySessions(), tabA, 'p1'), [change('base:positive', 'original'), change('character:1:positive', 'char')], { ok: false, code });
      expect(session.baseline).toEqual({ 'base:positive': 'original', 'character:1:positive': 'char' });
      expect(session.uncertain).toEqual(['base:positive', 'character:1:positive']);
      // Uncertain fields always need consent, even when the text looks unchanged.
      expect(editedFields(session, [change('base:positive', 'original')])).toHaveLength(1);
    }
  });
  it('a later verified write clears uncertainty for that field only', () => {
    let session = afterApplyAttempt(getSession(emptySessions(), tabA, 'p1'), [change('base:positive', 'o'), change('character:1:positive', 'c')], { ok: false, code: 'WRITE_FAILED' });
    session = afterApplyAttempt(session, [change('base:positive', 'o')], applied([['base:positive', 'x']]));
    expect(session.uncertain).toEqual(['character:1:positive']);
  });
  it('restore clears only restored fields and records them as the known state', () => {
    let session = afterApplyAttempt(getSession(emptySessions(), tabA, 'p1'), [change('base:positive', 'o'), change('character:1:positive', 'c')], applied([['base:positive', 'x'], ['character:1:positive', 'y']]));
    session = afterRestore(session, [{ field: 'base:positive', raw: 'o' }]);
    expect(session.baseline).toEqual({ 'character:1:positive': 'c' });
    expect(session.lastWritten['base:positive']).toBe('o');
  });
  it('values observed at auto start never override a recorded write', () => {
    let session = afterApplyAttempt(getSession(emptySessions(), tabA, 'p1'), [change('base:positive', 'o')], applied([['base:positive', 'x']]));
    session = observeExpected(session, [{ field: 'base:positive', raw: 'user edit' }, { field: 'character:1:positive', raw: 'seen' }]);
    expect(session.lastWritten).toEqual({ 'base:positive': 'x', 'character:1:positive': 'seen' });
  });
});

describe('bounded retention', () => {
  it('keeps at most MAX_SITE_SESSIONS and drops sessions without Restore text first', () => {
    let store = updateSession(emptySessions(), tabA, 'keep', session => withBaseline(session, [change('base:positive', 'precious')]));
    for (let index = 0; index < MAX_SITE_SESSIONS + 5; index++) store = putSession(store, getSession(store, { tabId: 100 + index, documentId: `d${index}`, url: URL_ }, 'p'));
    expect(store.sessions).toHaveLength(MAX_SITE_SESSIONS);
    expect(getSession(store, tabA, 'keep').baseline).toEqual({ 'base:positive': 'precious' });
  });
});

describe('handler: CONFLICT from applyFields means nothing was written', () => {
  it('a conflict detected while writing is reported as WRITE_FAILED after rolling back', async () => {
    const site = fakeSite(2);
    const writes = [{ field: 'base:positive' as const, text: 'new base' }, { field: 'character:1:positive' as const, text: 'new A' }, { field: 'character:2:positive' as const, text: 'new B' }];
    const prepared = await site.client.prepareFields(site.target, 2, writes);
    if (!prepared.ok || prepared.type !== 'prepareFields') throw new Error('prepare failed');
    site.state.conflictWrite = 'character:2:positive';
    const result = await site.client.applyFields(prepared.preview);
    expect(result).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
    expect(site.values.get('base:positive')).toBe('site base');
    expect(site.values.get('character:1:positive')).toBe('site char 1');
  });
  it('a compare-and-swap conflict before writing stays CONFLICT with zero writes', async () => {
    const site = fakeSite(1);
    const prepared = await site.client.prepareFields(site.target, 1, [{ field: 'base:positive', text: 'x' }]);
    if (!prepared.ok || prepared.type !== 'prepareFields') throw new Error('prepare failed');
    site.values.set('base:positive', 'user');
    expect(await site.client.applyFields(prepared.preview)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(site.state.writes).toEqual([]);
  });
  it('sender URLs with a fragment or query are still the panel; other pages are not', async () => {
    const site = fakeSite(1);
    const handler = createSiteHandler(site.adapter, { extensionId: sender.id, panelUrl: sender.url, documentId: site.target.documentId, isTopFrame: true, url: () => URL_, title: () => '', now: () => 0, ticket: () => 't' });
    const request = { protocol: PROTOCOL, ...site.target, type: 'readFields', fields: ['base:positive'] };
    expect(await handler(request, { id: sender.id, url: `${sender.url}#lab` })).toMatchObject({ ok: true });
    expect(await handler(request, { id: sender.id, url: `${sender.url}?wide=1` })).toMatchObject({ ok: true });
    for (const url of ['chrome-extension://ext/other.html', 'chrome-extension://other/sidepanel.html', 'https://novelai.net/image', 'not a url']) {
      expect(await handler(request, { id: sender.id, url })).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    }
    expect(await handler(request, { id: 'other', url: sender.url })).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });
});
