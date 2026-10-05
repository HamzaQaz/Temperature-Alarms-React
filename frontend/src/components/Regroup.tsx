import { Component, type ReactNode, type RefObject } from 'react';
import { EASE_OUT_EXPO_CSS, EASE_OUT_QUINT_CSS, FADE_IN_PLACE_MS, GLIDE_MS } from '@/lib/motion';

interface RegroupProps {
  /** The list whose direct children are the items; each carries `data-regroup` with a stable key. */
  list: RefObject<HTMLElement | null>;
  /** The items' keys in order; a change is what starts a regroup. */
  order: string;
  /** Under reduced motion the items take their new places at once. */
  still: boolean;
  children: ReactNode;
}

type Places = Map<string, DOMRect>;

const onScreen = (box: DOMRect) => box.bottom > 0 && box.top < window.innerHeight;

function items(list: HTMLElement | null): [string, HTMLElement][] {
  if (!list) return [];
  return [...list.children].flatMap((el) => (el instanceof HTMLElement && el.dataset.regroup ? [[el.dataset.regroup, el] as [string, HTMLElement]] : []));
}

/**
 * Moves the items that stay when the set of items changes (the Campus filter). Only an item on
 * screen both before and after glides to its new place; any other item that stays fades in where
 * it lands. Items joining and leaving animate themselves. A class component because only
 * `getSnapshotBeforeUpdate` reads the old places after the render and before the DOM changes;
 * it measures once per change of the set, never on the dashboard's once-a-second tick.
 */
export class Regroup extends Component<RegroupProps> {
  getSnapshotBeforeUpdate(prev: RegroupProps): Places | null {
    if (prev.order === this.props.order || this.props.still) return null;
    return new Map(items(this.props.list.current).map(([key, el]) => [key, el.getBoundingClientRect()]));
  }

  componentDidUpdate(_prev: RegroupProps, _state: unknown, before: Places | null) {
    if (!before) return;
    const moving = items(this.props.list.current).filter(([key]) => before.has(key));
    // A glide still running from the last change hands over from where it is; the snapshot already caught that.
    for (const [, el] of moving) for (const running of el.getAnimations()) if (running.id === 'regroup') running.cancel();
    for (const [key, el] of moving) {
      const from = before.get(key)!;
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if ((dx === 0 && dy === 0) || !onScreen(to)) continue;
      const animation = onScreen(from)
        ? el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: GLIDE_MS, easing: EASE_OUT_EXPO_CSS })
        : el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_PLACE_MS, easing: EASE_OUT_QUINT_CSS });
      animation.id = 'regroup';
    }
  }

  render() {
    return this.props.children;
  }
}
