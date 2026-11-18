import type { FieldKey, FieldWrite } from './fields';

// What the panel remembers about its own writes to one NovelAI document, scoped to
// one shuffle profile. Pure, immutable and memory-only (never persisted): a
// document reload, another tab or another profile always gets a separate session,
// so Restore text or edit detection from one target can never be applied to another.

/** Identity of one loaded document in one tab. A reload produces a new documentId. */
export interface SiteDocumentRef { tabId: number; documentId: string; url: string }
export type FieldValues = Partial<Record<FieldKey, string>>;

export interface SiteSession {
  key: string;
  target: SiteDocumentRef;
  profileId: string;
  /** Site text before the extension's first write to each field. Used only by Restore. */
  baseline: FieldValues;
  /** Text the extension last wrote and verified (or observed when auto shuffle started). */
  lastWritten: FieldValues;
  /** Fields whose content is unknown after a failed / unverified write. Always need consent. */
  uncertain: FieldKey[];
  /** Monotonic order for bounded retention. */
  touched: number;
}
export interface SiteSessions { sessions: SiteSession[]; clock: number }

export const MAX_SITE_SESSIONS = 20;

export function emptySessions(): SiteSessions { return { sessions: [], clock: 0 }; }
export function sessionKey(target: SiteDocumentRef, profileId: string): string {
  return JSON.stringify([target.tabId, target.documentId, target.url, profileId]);
}
export function sameDocument(a: SiteDocumentRef, b: SiteDocumentRef): boolean {
  return a.tabId === b.tabId && a.documentId === b.documentId && a.url === b.url;
}
function emptySession(target: SiteDocumentRef, profileId: string): SiteSession {
  return { key: sessionKey(target, profileId), target: { tabId: target.tabId, documentId: target.documentId, url: target.url }, profileId, baseline: {}, lastWritten: {}, uncertain: [], touched: 0 };
}

/** The session for exactly this document and profile (empty when none exists). */
export function getSession(store: SiteSessions, target: SiteDocumentRef, profileId: string): SiteSession {
  const key = sessionKey(target, profileId);
  return store.sessions.find(item => item.key === key) ?? emptySession(target, profileId);
}

/** Replace the session for its key. Keeps at most MAX_SITE_SESSIONS, dropping the least recently used empty ones first. */
export function putSession(store: SiteSessions, session: SiteSession): SiteSessions {
  const clock = store.clock + 1;
  const next = [...store.sessions.filter(item => item.key !== session.key), { ...session, touched: clock }];
  while (next.length > MAX_SITE_SESSIONS) {
    const victims = [...next].sort((a, b) => Number(hasRestoreText(a)) - Number(hasRestoreText(b)) || a.touched - b.touched);
    next.splice(next.indexOf(victims[0]!), 1);
  }
  return { sessions: next, clock };
}
export function updateSession(store: SiteSessions, target: SiteDocumentRef, profileId: string, change: (session: SiteSession) => SiteSession): SiteSessions {
  return putSession(store, change(getSession(store, target, profileId)));
}

export function hasRestoreText(session: SiteSession): boolean { return Object.keys(session.baseline).length > 0; }

/** Remember the pre-write text of fields that have no baseline yet (first write wins). */
export function withBaseline(session: SiteSession, changes: readonly { field: FieldKey; before: string }[]): SiteSession {
  const baseline = { ...session.baseline };
  for (const change of changes) if (baseline[change.field] === undefined) baseline[change.field] = change.before;
  return { ...session, baseline };
}
/** Record verified writes. A verified field is no longer uncertain. */
export function recordWritten(session: SiteSession, values: readonly { field: FieldKey; raw: string }[]): SiteSession {
  const fields = new Set(values.map(value => value.field));
  return { ...session, lastWritten: { ...session.lastWritten, ...Object.fromEntries(values.map(value => [value.field, value.raw])) }, uncertain: session.uncertain.filter(field => !fields.has(field)) };
}
/** Values observed (not written) at a known point, e.g. when auto shuffle starts. Never overrides a recorded write. */
export function observeExpected(session: SiteSession, values: readonly { field: FieldKey; raw: string }[]): SiteSession {
  const lastWritten = { ...session.lastWritten };
  for (const value of values) if (lastWritten[value.field] === undefined) lastWritten[value.field] = value.raw;
  return { ...session, lastWritten };
}
export function markUncertain(session: SiteSession, fields: readonly FieldKey[]): SiteSession {
  return { ...session, uncertain: [...new Set([...session.uncertain, ...fields])] };
}

/**
 * Fields that changed on the site after the extension's last known state, or whose
 * state is unknown. Writing them requires explicit consent; auto shuffle stops.
 */
export function editedFields<T extends { field: FieldKey; before: string }>(session: SiteSession, changes: readonly T[]): T[] {
  return changes.filter(change => session.uncertain.includes(change.field) || (session.lastWritten[change.field] !== undefined && session.lastWritten[change.field] !== change.before));
}

/** Writes that return every remembered field to its pre-write text. */
export function restoreWrites(session: SiteSession): FieldWrite[] {
  return (Object.entries(session.baseline) as [FieldKey, string][]).map(([field, text]) => ({ field, text }));
}
/** After a verified restore the restored text is the known state and Restore has nothing left to do. */
export function afterRestore(session: SiteSession, values: readonly { field: FieldKey; raw: string }[]): SiteSession {
  const restored = new Set(values.map(value => value.field));
  const baseline = Object.fromEntries((Object.entries(session.baseline) as [FieldKey, string][]).filter(([field]) => !restored.has(field))) as FieldValues;
  return { ...recordWritten(session, values), baseline };
}

/**
 * Multi-field apply error codes that the site handler returns only before its
 * first write (ticket, sender, page, lease and compare-and-swap checks). Any
 * failure after a write starts is reported as WRITE_FAILED / VERIFY_FAILED, and a
 * lost or malformed response (DISCONNECTED / INVALID_MESSAGE) may follow a write.
 * Every code not listed here — including unknown ones — leaves the fields uncertain.
 */
export const NO_WRITE_CODES: readonly string[] = ['EXPIRED', 'BUSY', 'UNAUTHORIZED', 'UNSUPPORTED_PAGE', 'STALE_DOCUMENT', 'CONFLICT', 'NOT_FOUND', 'AMBIGUOUS', 'UNSUPPORTED'];

/** Outcome of an apply attempt folded into the session. */
export function afterApplyAttempt(session: SiteSession, changes: readonly { field: FieldKey; before: string }[], outcome: { ok: true; values: readonly { field: FieldKey; raw: string }[] } | { ok: false; code: string }): SiteSession {
  if (outcome.ok) return recordWritten(withBaseline(session, changes), outcome.values);
  if (NO_WRITE_CODES.includes(outcome.code)) return session;
  // Possibly partially written: keep the pre-write text for Restore and demand consent next time.
  return markUncertain(withBaseline(session, changes), changes.map(change => change.field));
}

/** Sessions other than the current one that still hold Restore text (copy-only for the user). */
export function otherRestoreSessions(store: SiteSessions, currentKey: string | null): SiteSession[] {
  return store.sessions.filter(item => item.key !== currentKey && hasRestoreText(item)).sort((a, b) => b.touched - a.touched);
}
