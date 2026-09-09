/**
 * The motion vocabulary: a state change settles out on an exponential ease, an exit is
 * quicker than an entrance, and nothing bounces. Every use is a state the page is in
 * (a Reading arrived, a badge changed, a row was added), never decoration. Reduced motion
 * is honoured by the MotionConfig in App.tsx for these, and by `motion-safe:` in CSS.
 */
export const EASE_OUT_QUINT: [number, number, number, number] = [0.22, 1, 0.36, 1];

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
 * A list item arriving: a fade with a short rise, one after the next. The stagger is capped
 * at the eighth item so a long grid never keeps a technician waiting.
 */
export const arrive = (index = 0) => ({
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { ...settle, delay: Math.min(index, 8) * 0.03 } },
  exit: { opacity: 0, transition: leave },
});
