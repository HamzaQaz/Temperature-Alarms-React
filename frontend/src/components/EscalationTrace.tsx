import { useLayoutEffect, useRef } from 'react';
import { EASE_OUT_EXPO_CSS, TRACE_DRAW_MS, TRACE_FADE_MS } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** The stroke is 2px, centred 1px in from the card's outer edge, so it covers the 1px border and one pixel inside it. */
const STROKE = 2;

interface EscalationTraceProps {
  /** The card's border box, measured when the trace starts. */
  card: () => HTMLElement | null;
  /** The badge the trace starts from: the new worst Condition's badge, or the Offline badge. */
  origin: () => Element | null;
  /** Stroke colour class for the new level (`levelLook(level).trace`). */
  strokeClass: string;
  /** Called once the stroke has handed over to the card's own border and faded. */
  onDone: () => void;
}

/**
 * The Worst Wins Rule made literal: when a card's worst Condition rises, its new border is
 * drawn around the card from the badge that caused it, both ways at once, meeting on the far
 * side. It runs once and never loops. A rounded-rect path is measured to the card, the point
 * on it nearest the badge becomes the start, and one dash grows from there in both directions
 * (stroke-dasharray and stroke-dashoffset, animated together on the compositor-friendly
 * Web Animations API). The card's own border changes colour as the stroke closes.
 */
export function EscalationTrace({ card, origin, strokeClass, onDone }: EscalationTraceProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  // The latest callbacks, without restarting the trace when the card re-renders each second.
  const callbacks = useRef({ card, origin, onDone });
  useLayoutEffect(() => {
    callbacks.current = { card, origin, onDone };
  });

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const path = pathRef.current;
    const box = callbacks.current.card();
    if (!svg || !path || !box) return;

    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const radius = Math.max(0, (parseFloat(getComputedStyle(box).borderTopLeftRadius) || 0) - STROKE / 2);
    const inset = STROKE / 2;
    const geometry = roundedRect(inset, inset, width - STROKE, height - STROKE, radius);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    path.setAttribute('d', geometry.d);

    const boxRect = box.getBoundingClientRect();
    const badge = callbacks.current.origin()?.getBoundingClientRect();
    const start = badge
      ? geometry.positionOf(badge.left + badge.width / 2 - boxRect.left, badge.top + badge.height / 2 - boxRect.top)
      : 0;
    const total = geometry.length;

    const draw = path.animate(
      [
        { strokeDasharray: `0 ${total}`, strokeDashoffset: `${-start}` },
        { strokeDasharray: `${total} 0`, strokeDashoffset: `${total / 2 - start}` },
      ],
      { duration: TRACE_DRAW_MS, easing: EASE_OUT_EXPO_CSS, fill: 'forwards' },
    );
    let fade: Animation | undefined;
    let cancelled = false;
    draw.finished
      .then(() => {
        if (cancelled) return;
        fade = svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: TRACE_FADE_MS, easing: 'ease-out', fill: 'forwards' });
        return fade.finished;
      })
      .then(() => {
        if (!cancelled) callbacks.current.onDone();
      })
      .catch(() => {
        // Cancelled by a newer escalation or by the card leaving; nothing to hand over.
      });
    return () => {
      cancelled = true;
      draw.cancel();
      fade?.cancel();
    };
  }, []);

  return (
    <svg ref={svgRef} aria-hidden className="pointer-events-none absolute -inset-px z-10 size-[calc(100%+2px)] overflow-visible">
      <path ref={pathRef} className={cn('fill-none', strokeClass)} strokeWidth={STROKE} strokeLinecap="round" strokeDasharray="0 1" />
    </svg>
  );
}

/**
 * A rounded rectangle as one closed path that starts at the top edge just after the top-left
 * corner and runs clockwise, with a way to find how far along it the point nearest (x, y) is.
 */
function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  const straightW = Math.max(0, w - 2 * r);
  const straightH = Math.max(0, h - 2 * r);
  const quarter = (Math.PI * r) / 2;
  const d = [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ');
  const length = 2 * straightW + 2 * straightH + 4 * quarter;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  /** Distance along the path to the point on the nearest straight edge. */
  const positionOf = (px: number, py: number): number => {
    const distances = { top: py - y, right: x + w - px, bottom: y + h - py, left: px - x };
    const nearest = (Object.keys(distances) as Array<keyof typeof distances>).reduce((a, b) => (distances[a] <= distances[b] ? a : b));
    const cx = clamp(px, x + r, x + w - r);
    const cy = clamp(py, y + r, y + h - r);
    switch (nearest) {
      case 'top':
        return cx - (x + r);
      case 'right':
        return straightW + quarter + (cy - (y + r));
      case 'bottom':
        return straightW + quarter + straightH + quarter + (x + w - r - cx);
      case 'left':
        return 2 * straightW + straightH + 3 * quarter + (y + h - r - cy);
    }
  };

  return { d, length, positionOf };
}
