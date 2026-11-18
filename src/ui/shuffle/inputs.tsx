import { useEffect, useState } from 'react';

// Draft-then-commit inputs: one undo entry / save per finished edit, not per keystroke.

export function TextCommit({ label, value, onCommit, multiline = false, rows = 2, maxLength = 100_000, required = false, placeholder }: {
  label: string; value: string; onCommit: (value: string) => void; multiline?: boolean; rows?: number; maxLength?: number; required?: boolean; placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (required && !draft.trim()) { setDraft(value); return; }
    if (draft !== value) onCommit(draft);
  };
  return <label>{label}{multiline
    ? <textarea rows={rows} maxLength={maxLength} value={draft} placeholder={placeholder} onChange={event => setDraft(event.target.value)} onBlur={commit} />
    : <input maxLength={maxLength} value={draft} placeholder={placeholder} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />}
  </label>;
}

/** Comma-separated labels (constraint tags, locked tags). Trimmed, empty and duplicate entries removed. */
export function ListCommit({ label, values, onCommit, max = 50 }: { label: string; values: string[]; onCommit: (values: string[]) => void; max?: number }) {
  const text = values.join(', ');
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return <label>{label}<input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} onBlur={() => {
    const next = [...new Set(draft.split(',').map(item => item.trim().slice(0, 64)).filter(Boolean))].slice(0, max);
    if (next.join(', ') !== text) onCommit(next); else setDraft(text);
  }} /></label>;
}

export function NumberCommit({ label, value, onCommit, min, max, step = 1 }: { label: string; value: number; onCommit: (value: number) => void; min: number; max: number; step?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label>{label}<input type="number" min={min} max={max} step={step} value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, step === 1 ? Math.round(parsed) : parsed)) : value;
    if (next !== value) onCommit(next);
    setDraft(String(next));
  }} /></label>;
}

/** null = every character; otherwise an explicit subset. */
export function CharacterLimit({ label, characters, value, onChange }: { label: string; characters: { id: string; name: string }[]; value: string[] | null; onChange: (value: string[] | null) => void }) {
  return <fieldset className="stack"><legend>{label}</legend>
    <label className="inline"><input type="checkbox" checked={value === null} onChange={event => onChange(event.target.checked ? null : characters.map(item => item.id))} />{label}: 全員</label>
    {value !== null && <div className="actions">{characters.map(item => <label className="inline" key={item.id}><input type="checkbox" checked={value.includes(item.id)} onChange={event => onChange(event.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))} />{label}: {item.name}</label>)}</div>}
  </fieldset>;
}
