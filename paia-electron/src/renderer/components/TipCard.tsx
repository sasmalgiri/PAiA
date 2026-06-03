// Anchored speech-bubble tip card.
//
// Finds its anchor element by data-tip-anchor attribute, computes a
// best-fit position (prefer below the anchor, fall back to right, then
// above), and renders with an arrow pointing at the anchor.
//
// The arrow is a CSS triangle. Positioning is recomputed when the
// anchor element resizes or the window scrolls/resizes — re-renders
// are throttled via requestAnimationFrame.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TipDefinition } from '../lib/tipCards';

interface Props {
  tip: TipDefinition;
  onDismiss: () => void;
  onAction?: () => void;
}

type Placement = 'below' | 'right' | 'above';

interface Pos {
  top: number;
  left: number;
  placement: Placement;
  arrowOffset: number;  // px from card's edge to where the arrow tip goes
}

const CARD_WIDTH = 320;
const GAP = 12;

function computePosition(anchor: HTMLElement): Pos {
  const r = anchor.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;

  // Try below
  const belowTop = r.bottom + GAP;
  if (belowTop + 140 < viewportH) {
    const desiredLeft = r.left + r.width / 2 - CARD_WIDTH / 2;
    const clampedLeft = Math.max(8, Math.min(viewportW - CARD_WIDTH - 8, desiredLeft));
    const arrowOffset = Math.max(20, Math.min(CARD_WIDTH - 20, r.left + r.width / 2 - clampedLeft));
    return { top: belowTop, left: clampedLeft, placement: 'below', arrowOffset };
  }

  // Try right
  const rightLeft = r.right + GAP;
  if (rightLeft + CARD_WIDTH < viewportW) {
    const desiredTop = r.top + r.height / 2 - 60;
    const clampedTop = Math.max(8, Math.min(viewportH - 160, desiredTop));
    const arrowOffset = Math.max(20, Math.min(120, r.top + r.height / 2 - clampedTop));
    return { top: clampedTop, left: rightLeft, placement: 'right', arrowOffset };
  }

  // Fall back to above
  const aboveTop = Math.max(8, r.top - 160);
  const desiredLeft = r.left + r.width / 2 - CARD_WIDTH / 2;
  const clampedLeft = Math.max(8, Math.min(viewportW - CARD_WIDTH - 8, desiredLeft));
  const arrowOffset = Math.max(20, Math.min(CARD_WIDTH - 20, r.left + r.width / 2 - clampedLeft));
  return { top: aboveTop, left: clampedLeft, placement: 'above', arrowOffset };
}

export function TipCard({ tip, onDismiss, onAction }: Props) {
  const [pos, setPos] = useState<Pos | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const anchor = document.querySelector(`[data-tip-anchor="${tip.anchorId}"]`) as HTMLElement | null;
    if (!anchor) {
      // No anchor on this screen — surface in the corner so the user
      // doesn't lose the tip entirely.
      setPos({ top: window.innerHeight - 200, left: window.innerWidth - CARD_WIDTH - 24, placement: 'right', arrowOffset: -1 });
      return;
    }

    let raf = 0;
    const recompute = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPos(computePosition(anchor)));
    };
    recompute();

    const ro = new ResizeObserver(recompute);
    ro.observe(anchor);
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [tip.anchorId]);

  useEffect(() => {
    if (!tip.autoDismissMs) return;
    const t = setTimeout(onDismiss, tip.autoDismissMs);
    return () => clearTimeout(t);
  }, [tip.autoDismissMs, onDismiss]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  if (!pos) return null;

  return (
    <div
      ref={cardRef}
      className={`tip-card tip-${pos.placement}`}
      style={{ top: pos.top, left: pos.left, width: CARD_WIDTH }}
      role="status"
      aria-live="polite"
    >
      {pos.arrowOffset >= 0 && (
        <div
          className="tip-arrow"
          style={
            pos.placement === 'right'
              ? { top: pos.arrowOffset }
              : { left: pos.arrowOffset }
          }
        />
      )}
      <div className="tip-header">
        <span className="tip-title">{tip.title}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={onDismiss}
          title="Dismiss tip"
          aria-label="Dismiss tip"
        >×</button>
      </div>
      <div className="tip-body">{tip.body}</div>
      {tip.action && (
        <div className="tip-actions">
          <button
            type="button"
            className="primary small"
            onClick={() => { onAction?.(); onDismiss(); }}
          >
            {tip.action.label}
          </button>
        </div>
      )}
    </div>
  );
}
