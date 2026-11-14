import { useEffect, useRef } from 'react';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Global keyboard shortcuts that stay out of the way while the user is
 * typing. The handler is kept in a ref so callers needn't memoise it.
 */
export function useHotkeys(handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      // Space/Enter on a focused button or link should activate *that* control.
      if ((e.key === ' ' || e.key === 'Enter') && e.target instanceof HTMLElement && e.target.closest('button, a, [role="button"]')) return;
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
