import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Detail text that stays out of the way: a small "?" button that shows the text
 * on hover, keyboard focus or tap (touch). Escape, scrolling or moving away hides
 * it. The text is always in the DOM and linked with aria-describedby, so screen
 * readers announce it with the button. `label` must be unique on the page.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const close = () => { setOpen(false); setPinned(false); };

  // Fixed positioning keeps the tip inside narrow side panels; flip above when there is no room below.
  useLayoutEffect(() => {
    if (!open || !button.current) { setPosition(null); return; }
    const anchor = button.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8));
    const height = tip.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 && anchor.top - height - 6 > 8 ? anchor.top - height - 6 : below;
    setPosition({ top, left, width });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const hide = () => close();
    const outside = (event: PointerEvent) => { if (!button.current?.parentElement?.contains(event.target as Node)) close(); };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); document.removeEventListener('pointerdown', outside); };
  }, [open]);

  return <span className="info-tip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!pinned) setOpen(false); }}>
    <button ref={button} type="button" className="info-tip-button" aria-label={`${label}の説明`} aria-describedby={id} aria-expanded={open}
      onFocus={() => setOpen(true)} onBlur={close}
      onClick={() => { if (pinned) close(); else { setOpen(true); setPinned(true); } }}
      onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}>?</button>
    <span ref={tip} role="tooltip" id={id} className="info-tip-body" hidden={!open}
      style={position ? { top: position.top, left: position.left, width: position.width } : { visibility: 'hidden' }}>{children}</span>
  </span>;
}

/** A one-line summary with the full explanation behind an InfoTip. */
export function Hint({ label, summary, children }: { label: string; summary: ReactNode; children: ReactNode }) {
  return <p className="hint hint-line">{summary} <InfoTip label={label}>{children}</InfoTip></p>;
}
