// Tiny focus-trap hook for modal overlays.
//
// When a modal opens, keyboard users expect Tab to cycle inside the
// modal and ESC to close it. WAI-ARIA Authoring Practices for dialogs
// spell this out as a requirement. We implement it in ~30 lines without
// pulling in focus-trap-react.

import { useEffect, type RefObject } from 'react';

interface Options {
  onClose?: () => void;
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(containerRef: RefObject<HTMLElement>, opts: Options = {}): void {
  const { onClose } = opts;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Remember what had focus so we can restore it on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focus = (): void => {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? container).focus();
    };
    focus();

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(container!.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !container!.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      try { previouslyFocused?.focus?.(); } catch { /* node removed */ }
    };
  }, [containerRef, onClose]);
}
