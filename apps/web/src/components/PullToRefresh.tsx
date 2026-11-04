import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";
import { canVibrate, haptic } from "../haptics";
import styles from "./PullToRefresh.module.css";

// How far a finger moves before it counts as a pull, not a tap or a swipe.
const START_PX = 8;
// The furthest the page comes down.
const MAX_PX = 160;
// How far the page comes down before letting go refreshes.
const ARM_PX = 72;

// How far the page comes down for a finger `distance` past the start. Close to the
// finger at first, then heavier the further it goes, and never past MAX_PX.
export const pullOffset = (distance: number) =>
  MAX_PX * (1 - 1 / (1 + Math.max(0, distance) / MAX_PX));

interface Options {
  refreshing: boolean;
  onRefresh: () => void;
  enabled: boolean;
}

// Pulling the list down from the top refreshes it, like on an iPhone. Touch only: a
// mouse or trackpad has the Refresh button. This is the page that comes down with the
// finger, over a spinner. Far enough, the gap turns rainbow, and letting go refreshes.
// The page springs back up either way. During a refresh, a pull just shows it's
// running. Off while `enabled` is false, like while a preview is open.
//
// The pull lives here, not in the page using it, so moving a finger redraws only
// this, not the list inside it.
export function PullToRefresh({
  className,
  children,
  ...options
}: Options & { className?: string | undefined; children: ReactNode }) {
  const { offset, dragging } = usePull(options);
  return (
    <>
      <Behind
        offset={offset}
        dragging={dragging}
        refreshing={options.refreshing}
      />
      <div
        className={cx(className, styles.page, dragging && styles.dragging)}
        // No transform at rest, so nothing else changes then.
        style={{
          transform: offset > 0 ? `translateY(${offset}px)` : undefined,
        }}
      >
        {children}
      </div>
    </>
  );
}

// How far the page is down, while a finger pulls it.
function usePull({ refreshing, onRefresh, enabled }: Options) {
  // How far the page is down.
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  // The touch, while it could still become a pull. `pulling` once it is one.
  const touch = useRef<{
    x: number;
    y: number;
    pulling: boolean;
    at: number;
  }>(undefined);

  const canStart = useEffectEvent(() => enabled && window.scrollY <= 0);
  const isEnabled = useEffectEvent(() => enabled);
  const isRefreshing = useEffectEvent(() => refreshing);
  const refresh = useEffectEvent(() => onRefresh());

  useEffect(() => {
    // Stops the browser's own pull to refresh, and the iPhone's bounce at the top.
    const root = document.documentElement;
    root.dataset.pullToRefresh = "";

    const onStart = (event: TouchEvent) => {
      // A second finger ends a pull without refreshing.
      end();
      const finger = event.touches[0];
      touch.current =
        finger && event.touches.length === 1 && canStart()
          ? { x: finger.clientX, y: finger.clientY, pulling: false, at: 0 }
          : undefined;
    };

    const onMove = (event: TouchEvent) => {
      const t = touch.current;
      const finger = event.touches[0];
      if (!t || !finger) return;
      if (!isEnabled()) {
        end();
        return;
      }
      const dx = finger.clientX - t.x;
      const dy = finger.clientY - t.y;
      if (!t.pulling) {
        if (Math.hypot(dx, dy) < START_PX) return;
        // A swipe on a row, or a scroll down the list.
        if (dy <= Math.abs(dx)) {
          touch.current = undefined;
          return;
        }
        t.pulling = true;
        setDragging(true);
      }
      // Older browsers ignore the overscroll CSS, so this stops them scrolling too.
      if (event.cancelable) event.preventDefault();
      const at = pullOffset(dy - START_PX);
      // Buzzes as it gets far enough, where the phone can buzz mid-pull.
      const arming = at >= ARM_PX && t.at < ARM_PX && !isRefreshing();
      if (arming && canVibrate()) haptic();
      t.at = at;
      setOffset(at);
    };

    const end = (event?: TouchEvent) => {
      const t = touch.current;
      touch.current = undefined;
      if (!t?.pulling) return;
      setDragging(false);
      setOffset(0);
      if (event?.type !== "touchend" || t.at < ARM_PX || isRefreshing()) return;
      // iPhones can only tick as the finger lifts.
      if (!canVibrate()) haptic();
      refresh();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      delete root.dataset.pullToRefresh;
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  return { offset, dragging };
}

// How far the ring turns as the page comes down, before it's far enough.
const TURN_DEG_PER_PX = 3;

// What's behind the page, in the gap a pull opens above it: a ring that turns with
// the pull, and the rainbow once letting go would refresh. During a refresh, the ring
// spins and says so instead.
function Behind({
  offset,
  dragging,
  refreshing,
}: {
  offset: number;
  dragging: boolean;
  refreshing: boolean;
}) {
  const armed = !refreshing && offset >= ARM_PX;
  return (
    <div
      className={styles.behind}
      // As tall as the furthest pull, below the notch.
      style={{ height: `calc(env(safe-area-inset-top) + ${MAX_PX}px)` }}
      aria-hidden="true"
    >
      <div className={cx(styles.rainbow, armed && styles.shown)} />
      <div
        className={cx(
          styles.spinner,
          dragging && styles.dragging,
          armed && styles.armed,
        )}
        style={{
          // Centered in the gap, so it stays in view as the gap opens. Fully shown once
          // far enough to refresh, or right away during a refresh. `translate`, not
          // `transform`, so the pop's scale doesn't stretch it off center.
          translate: `0 ${offset / 2}px`,
          opacity: refreshing && offset > 0 ? 1 : Math.min(1, offset / ARM_PX),
        }}
      >
        <span
          className={cx(styles.ring, refreshing && styles.spinning)}
          style={{
            rotate: refreshing ? undefined : `${offset * TURN_DEG_PER_PX}deg`,
          }}
        />
        {refreshing && <span className={styles.label}>Refreshing…</span>}
      </div>
    </div>
  );
}
