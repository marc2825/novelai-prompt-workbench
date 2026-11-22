import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject, type SyntheticEvent } from 'react';
import { applyCompletion, buildTagIndex, collectLibraryTags, completionTokenAt, suggestTags, type LibraryTag, type TagIndex, type TagSuggestion } from '../core/tags';
import type { LibraryEntry, TagDictionaryEntry, WorkbenchData } from '../core/types';

export interface TagCompletionSource { readonly enabled: boolean; index(): TagIndex }

/** Provided once by the App; editors without a provider simply have no completion. */
export const TagCompletionContext = createContext<TagCompletionSource | null>(null);

const NO_ENTRIES: readonly TagDictionaryEntry[] = [];
const sameLibrary = (a: readonly LibraryEntry[], b: readonly LibraryEntry[]) => a === b || (a.length === b.length && a.every((entry, index) => {
  const other = b[index]!;
  return entry.id === other.id && entry.raw === other.raw;
}));
const sameDictionary = (a: readonly TagDictionaryEntry[], b: readonly TagDictionaryEntry[]) => a === b || (a.length === b.length && a.every((entry, index) => {
  const other = b[index]!;
  return entry.id === other.id && entry.tag === other.tag && entry.note === other.note && entry.aliases.length === other.aliases.length && entry.aliases.every((alias, at) => alias === other.aliases[at]);
}));

/**
 * The suggestion index for the current data, built lazily on the first lookup and
 * rebuilt only when the library text or the dictionary actually changed (every
 * commit produces fresh validated copies, so identity alone is not enough).
 */
export function useTagCompletionSource(data: WorkbenchData | null): TagCompletionSource | null {
  const cache = useRef<{ library: readonly LibraryEntry[]; tags: LibraryTag[]; dictionary: readonly TagDictionaryEntry[]; index: TagIndex } | null>(null);
  return useMemo(() => {
    if (!data) return null;
    const library = data.libraryEntries;
    const dictionary = data.tagDictionary?.entries ?? NO_ENTRIES;
    return {
      enabled: data.settings.tagCompletion !== false,
      index: () => {
        const cached = cache.current;
        const tags = cached && sameLibrary(cached.library, library) ? cached.tags : collectLibraryTags(library);
        const index = cached && tags === cached.tags && sameDictionary(cached.dictionary, dictionary) ? cached.index : buildTagIndex(dictionary, tags);
        cache.current = { library, tags, dictionary, index };
        return index;
      },
    };
  }, [data]);
}

/**
 * Keyboard completion for a prompt textarea (WAI-ARIA: the textarea keeps its
 * textbox role and points at the listbox with aria-controls/aria-activedescendant).
 * Nothing changes until the user accepts a suggestion with Enter/Tab (after
 * choosing it with ↑/↓) or a click; then only the partial tag before the caret is
 * replaced, as a normal edit (one Undo step, native textarea undo where supported).
 * Keys pass through untouched while the list is closed, while composing (IME) and
 * with Ctrl/Cmd/Alt, so typing and the Undo/Redo shortcuts work as before.
 */
export function useTagCompletion({ label, value, readOnly, input, onChange }: {
  label: string; value: string; readOnly: boolean; input: RefObject<HTMLTextAreaElement | null>; onChange: (raw: string) => void;
}) {
  const source = useContext(TagCompletionContext);
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState<{ signature: string; index: number }>({ signature: '', index: -1 });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const pendingCaret = useRef<{ text: string; caret: number } | null>(null);
  const available = !!source?.enabled && !readOnly;
  const token = available && focused && !composing && caret !== null ? completionTokenAt(value, caret) : null;
  const signature = token ? `${token.start}:${token.query}` : '';
  // Keyed by the token signature: the same partial tag at the same place gives the same list.
  const suggestions = useMemo<TagSuggestion[]>(() => token && source ? suggestTags(source.index(), token.query) : [], [signature, source]);
  const open = suggestions.length > 0 && dismissed !== signature;
  const activeIndex = open && active.signature === signature && active.index < suggestions.length ? active.index : -1;
  const optionId = (index: number) => `${listId}-option-${index}`;

  // Fallback path only (no native insertText): restore the caret after React applies the value.
  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (pending && input.current && input.current.value === pending.text) {
      input.current.setSelectionRange(pending.caret, pending.caret);
      pendingCaret.current = null;
    }
  }, [value, input]);

  const read = (element: HTMLTextAreaElement) => setCaret(element.selectionStart === element.selectionEnd ? element.selectionStart : null);
  const track = (event: SyntheticEvent<HTMLTextAreaElement>) => read(event.currentTarget);
  // Caret moves that no React event reports (e.g. setSelectionRange by an assistive tool or a script).
  useEffect(() => {
    const element = input.current;
    if (!available || !element) return;
    const update = () => { if (document.activeElement === element) read(element); };
    element.addEventListener('selectionchange', update);
    document.addEventListener('selectionchange', update);
    return () => { element.removeEventListener('selectionchange', update); document.removeEventListener('selectionchange', update); };
  }, [available, input]);

  const accept = (suggestion: TagSuggestion) => {
    const element = input.current;
    if (!element || !token) return;
    let next: { text: string; caret: number };
    try { next = applyCompletion(value, token, suggestion.tag); } catch { return; }
    element.focus();
    element.setSelectionRange(token.start, token.end);
    let inserted = false;
    // insertText keeps the browser's own undo stack and fires a normal input event (→ onChange).
    try { inserted = document.execCommand('insertText', false, suggestion.tag) && element.value === next.text; } catch { inserted = false; }
    if (!inserted) {
      pendingCaret.current = next;
      onChange(next.text);
    }
    setCaret(next.caret);
    setDismissed(`${token.start}:${suggestion.tag}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return false;
    const count = suggestions.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (event.shiftKey) return false;
        event.preventDefault();
        const down = event.key === 'ArrowDown';
        setActive({ signature, index: activeIndex < 0 ? (down ? 0 : count - 1) : (activeIndex + (down ? 1 : count - 1)) % count });
        return true;
      }
      case 'Enter':
      case 'Tab':
        // Without a chosen suggestion Enter inserts a newline and Tab moves focus, as before.
        if (activeIndex < 0 || event.shiftKey) return false;
        event.preventDefault();
        accept(suggestions[activeIndex]!);
        return true;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        setDismissed(signature);
        return true;
      default:
        return false;
    }
  };

  const textareaProps = available ? {
    'aria-autocomplete': 'list' as const,
    'aria-controls': open ? listId : undefined,
    'aria-activedescendant': activeIndex >= 0 ? optionId(activeIndex) : undefined,
    onFocus: (event: SyntheticEvent<HTMLTextAreaElement>) => { setFocused(true); track(event); },
    onBlur: () => { setFocused(false); setDismissed(null); },
    onSelect: track, onClick: track, onKeyUp: track,
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: (event: SyntheticEvent<HTMLTextAreaElement>) => { setComposing(false); track(event); },
  } : {};

  const list = open ? <ul className="tag-suggestions" role="listbox" id={listId} aria-label={`${label}のタグ候補`}>
      {suggestions.map((suggestion, index) => <li key={`${suggestion.source}:${suggestion.tag}`} id={optionId(index)} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'active' : undefined}
        onMouseDown={event => event.preventDefault()} onClick={() => accept(suggestion)}>
        <span className="tag-suggestion-text">{suggestion.tag}</span>
        {suggestion.alias && <> <small>← {suggestion.alias}</small></>}
        {suggestion.note && <> <small className="tag-suggestion-note">{suggestion.note}</small></>}
        {' '}<small className="tag-suggestion-source">{suggestion.source === 'dictionary' ? '辞書' : 'ライブラリ'}</small>
      </li>)}
    </ul> : null;
  const announcement = available ? <span className="sr-only" aria-live="polite">{open ? `タグ候補${suggestions.length}件。↓で選択、Enterで確定、Escで閉じる` : ''}</span> : null;

  return { textareaProps, onKeyDown, track, list, announcement };
}
