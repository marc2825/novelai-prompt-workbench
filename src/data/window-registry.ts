// Which extension pages (side panel, wide tab) are open right now (issue #16).
// Each page holds a Web Lock named after a random window ID for its whole
// lifetime; the browser releases it when the page closes or crashes. Undo/Redo
// history lives only in each page's memory, so operations that would break
// another page's history (purging image binaries) are refused while other pages
// are open. Local to this browser profile; nothing is sent anywhere.

export const WINDOW_LOCK_PREFIX = 'nai-prompt-workbench:window:';

type Locks = Pick<LockManager, 'request' | 'query'>;
const locks = (): Locks | undefined => (typeof navigator !== 'undefined' ? navigator.locks : undefined) ?? undefined;

export interface WindowPresence { release(): void; ready: Promise<boolean> }

/** Holds this page's presence lock until `release()` (or until the page goes away). */
export function registerWindow(windowId: string, manager: Locks | undefined = locks()): WindowPresence {
  if (!manager) return { release() {}, ready: Promise.resolve(false) };
  let release = () => {};
  let acquired: (value: boolean) => void = () => {};
  const ready = new Promise<boolean>(resolve => { acquired = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  manager.request(`${WINDOW_LOCK_PREFIX}${windowId}`, () => { acquired(true); return held; }).catch(() => acquired(false));
  return { release: () => release(), ready };
}

/**
 * Number of other open extension pages, or null when it cannot be determined
 * (no Web Locks, or this page's own lock is not held): callers must then treat
 * the situation as unsafe.
 */
export async function otherWindows(windowId: string, manager: Locks | undefined = locks()): Promise<number | null> {
  if (!manager) return null;
  try {
    const snapshot = await manager.query();
    const names = [...(snapshot.held ?? []), ...(snapshot.pending ?? [])].map(lock => lock.name ?? '').filter(name => name.startsWith(WINDOW_LOCK_PREFIX));
    const mine = `${WINDOW_LOCK_PREFIX}${windowId}`;
    if (!names.includes(mine)) return null;
    return new Set(names.filter(name => name !== mine)).size;
  } catch { return null; }
}
