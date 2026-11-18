import { useEffect, useState, type ReactNode } from 'react';

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  // Large backups can take a while to start downloading; release the URL later for them.
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), blob.size > 50 * 1024 * 1024 ? 60_000 : 1000);
}

export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Rename({ value, label, onSave }: { value: string; label: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <label>{label}<input value={draft} maxLength={200} required onChange={event => setDraft(event.target.value)} onBlur={() => {
    if (draft.trim() && draft !== value) onSave(draft);
    else if (!draft.trim()) setDraft(value);
  }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}

export function Reorder({ name, first, last, onMove }: { name: string; first: boolean; last: boolean; onMove: (direction: -1 | 1) => void }) {
  return <span className="reorder"><button type="button" disabled={first} aria-label={`${name}を上へ`} onClick={() => onMove(-1)}>↑</button><button type="button" disabled={last} aria-label={`${name}を下へ`} onClick={() => onMove(1)}>↓</button></span>;
}

export function Empty({ children }: { children: ReactNode }) { return <p className="empty">{children}</p>; }
