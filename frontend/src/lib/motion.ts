/**
 * The motion vocabulary: a state change settles out on an exponential ease, an exit is
 * quicker than an entrance, and nothing bounces. Every use is a state the page is in
 * (a Reading arrived, a Condition rose, a row was added), never decoration. Reduced motion
 * is honoured by the MotionConfig in App.tsx for these (transforms and layout moves are
 * dropped, opacity stays), by `useReducedMotion` where a clip or a stroke would move, and by
 * the `prefers-reduced-motion` block in index.css for CSS.
 */
export const EASE_OUT_QUINT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_OUT_EXPO_CSS = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** Something arriving or changing: 200 ms, decelerating. */
export const settle = { duration: 0.2, ease: EASE_OUT_QUINT };

/** Something leaving: quicker, so the new state is not kept waiting. */
export const leave = { duration: 0.15, ease: EASE_OUT_QUINT };

/** A crossfade for a thing that changes state in place: a badge, a note, a row. */
export const crossfade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: settle },
  exit: { opacity: 0, transition: leave },
};

/**
 * A list item arriving with the page: a fade with a short rise, one after the next. The
 * stagger is capped at the eighth item so a long grid never keeps a technician waiting.
 */
export const arrive = (index = 0) => ({
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { ...settle, delay: Math.min(index, 8) * 0.03 } },
  exit: { opacity: 0, transition: leave },
});

/**
 * A card joining or leaving a grid that is already on screen (the Campus filter): a plain
 * fade in, a quicker fade out, and the cards that stay glide to their new places (FLIP).
 */
export const regroup = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: settle },
  exit: { opacity: 0, transition: { duration: 0.12, ease: EASE_OUT_QUINT } },
};

/** How the cards that stay move to their new places: a layout (FLIP) transition, transforms only. */
export const reflow = { layout: { duration: 0.32, ease: EASE_OUT_EXPO } };

/**
 * The escalation trace: the new border is drawn around the card from its badge, once.
 * The stroke then hands over to the card's own border and fades.
 */
export const TRACE_DRAW_MS = 620;
export const TRACE_FADE_MS = 360;

/**
 * A Condition badge arriving: revealed from the side the trace starts on, so the badge
 * and the border read as one event. `from` is the edge the reveal starts at.
 */
export const reveal = (from: 'left' | 'right') => ({
  initial: { opacity: 0, clipPath: from === 'left' ? 'inset(0% 100% 0% 0% round 8px)' : 'inset(0% 0% 0% 100% round 8px)' },
  animate: { opacity: 1, clipPath: 'inset(0% 0% 0% 0% round 8px)', transition: { duration: 0.36, ease: EASE_OUT_EXPO } },
  // Behind the badge replacing it (a Condition that worsened), so the new one is what the eye catches.
  exit: { opacity: 0, zIndex: 0, transition: { ...leave, zIndex: { duration: 0 } } },
});

/**
 * One History day giving way to the next: the content slides a short way in the direction
 * of travel and crossfades. `direction` is 1 for a later day, -1 for an earlier one, 0 for none.
 */
export const DAY_SHIFT_PX = 32;
export const dayShift = {
  enter: (direction: number) => ({ opacity: 0, x: direction * DAY_SHIFT_PX }),
  center: { opacity: 1, x: 0, transition: { duration: 0.28, ease: EASE_OUT_EXPO } },
  exit: (direction: number) => ({ opacity: 0, x: direction * -DAY_SHIFT_PX, transition: { duration: 0.14, ease: EASE_OUT_QUINT } }),
};
