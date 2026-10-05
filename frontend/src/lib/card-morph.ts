/**
 * The shared-element move between a Device card and its History: the Closet name, the
 * Campus, and the temperature readout travel from the card into History's header, and back
 * again on the way out. It uses the View Transitions API. The parts are named only for the
 * length of one transition, so sixty cards never carry sixty sets of names.
 *
 * Elements opt in with `data-morph="closet" | "campus" | "temp"` inside a scope: the card
 * (`data-device-card={id}`) or History's header (`data-device-heading={id}`). Where the API is
 * missing, or the visitor prefers reduced motion, navigation happens at once and the route fade
 * is all there is.
 */
const PARTS = ['closet', 'campus', 'temp'] as const;

/** How long to wait for the other end of the move to render before going ahead without it. */
const WAIT_FOR_TARGET_MS = 300;

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> };
};

function name(scope: Element | null, on: boolean) {
  if (!scope) return;
  for (const part of PARTS) {
    const el = scope.querySelector<HTMLElement>(`[data-morph="${part}"]`);
    if (el) el.style.viewTransitionName = on ? `device-${part}` : '';
  }
}

export function canMorph(): boolean {
  if (typeof document === 'undefined') return false;
  if (!(document as ViewTransitionDocument).startViewTransition) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let morphing = false;

/** True while a card-to-History move is running; the route fade then skips its rise, which would shift the move's landing point. */
export const isMorphing = () => morphing;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `navigate` inside a view transition that carries the named parts of `from` to the
 * scope `findTarget` returns once the new page has rendered it. React Router renders a
 * navigation as a transition, so the new page is polled for (on timers, which keep running
 * while the transition holds the old frame) rather than assumed to be there.
 */
export function morphTo(from: Element | null, navigate: () => void, findTarget: () => Element | null, place?: (target: Element) => void) {
  const doc = document as ViewTransitionDocument;
  if (!from || !canMorph() || !doc.startViewTransition) {
    navigate();
    return;
  }
  name(from, true);
  morphing = true;
  let target: Element | null = null;
  const transition = doc.startViewTransition(async () => {
    name(from, false);
    navigate();
    const deadline = Date.now() + WAIT_FOR_TARGET_MS;
    target = findTarget();
    while (!target && Date.now() < deadline) {
      await sleep(16);
      target = findTarget();
    }
    if (target) {
      place?.(target);
      name(target, true);
    }
  });
  void transition.finished.finally(() => {
    morphing = false;
    name(target, false);
  });
}

export const cardScope = (deviceId: number) => document.querySelector(`[data-device-card="${deviceId}"]`);
export const headingScope = (deviceId: number) => document.querySelector(`[data-device-heading="${deviceId}"]`);

/**
 * What the card already knows about a Device, handed to History in the navigation state so
 * its header can render at once, before the day loads, and be the end of the move. `back` is
 * where History's back button returns to (the dashboard with its Campus filter).
 */
export interface HistorySeed {
  id: number;
  closet: string;
  closetType: 'IDF' | 'MDF' | null;
  campusName: string;
  hostname: string;
  tempF: number | null;
  back: string;
}

export function readSeed(state: unknown, deviceId: number): HistorySeed | undefined {
  const seed = (state as { seed?: HistorySeed } | null)?.seed;
  return seed && seed.id === deviceId ? seed : undefined;
}
