import { RotateCw } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { cx } from "../cx";
import { canVibrate, haptic } from "../haptics";
import styles from "./PullToRefresh.module.css";

// How far a finger moves before it counts as a pull, not a tap or a swipe.
const START_PX = 8;
// The circle moves at this share of the finger, so the pull feels heavy.
const RESISTANCE = 0.5;
// How far the circle comes down before letting go refreshes.
const ARM_PX = 64;
// The furthest it comes down.
const MAX_PX = 96;
// Where it waits while the refresh runs.
const HOLD_PX = 48;

// Pulling the list down from the top refreshes it, like in mail apps. Touch only: a
// mouse or trackpad has the Refresh button. A circle comes down under the header with
// the finger, then spins until the refresh ends. Off while `enabled` is false, like
// while a preview is open.
export function PullToRefresh({
  refreshing,
  onRefresh,
  enabled,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  enabled: boolean;
}) {
  // How far the circle is down while the finger is on the screen.
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  // A pull started the refresh, so the circle stays until it ends.
  const [held, setHeld] = useState(false);
  const [wasRefreshing, setWasRefreshing] = useState(refreshing);
  if (wasRefreshing !== refreshing) {
    setWasRefreshing(refreshing);
    if (!refreshing) setHeld(false);
  }
  // The touch, while it could still become a pull. `pulling` once it is one.
  const touch = useRef<{
    x: number;
    y: number;
    pulling: boolean;
    at: number;
  }>(undefined);

  const canStart = useEffectEvent(
    () => enabled && !refreshing && window.scrollY <= 0,
  );
  const isEnabled = useEffectEvent(() => enabled);
  const refresh = useEffectEvent(() => {
    setHeld(true);
    onRefresh();
  });

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
      const at = Math.min(MAX_PX, Math.max(0, dy - START_PX) * RESISTANCE);
      // Buzzes as it gets far enough, where the phone can buzz mid-pull.
      if (at >= ARM_PX && t.at < ARM_PX && canVibrate()) haptic();
      t.at = at;
      setPull(at);
    };

    const end = (event?: TouchEvent) => {
      const t = touch.current;
      touch.current = undefined;
      if (!t?.pulling) return;
      setDragging(false);
      setPull(0);
      if (event?.type !== "touchend" || t.at < ARM_PX) return;
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

  const spinning = held && !dragging;
  const shown = dragging ? pull : spinning ? HOLD_PX : 0;
  return (
    <div className={styles.zone} aria-hidden="true">
      <div
        className={cx(
          styles.circle,
          dragging && styles.dragging,
          (spinning || (dragging && pull >= ARM_PX)) && styles.armed,
        )}
        style={{
          transform: `translateY(${shown}px)`,
          opacity: spinning ? 1 : Math.min(1, shown / ARM_PX),
        }}
      >
        <RotateCw
          className={cx(spinning && styles.spin)}
          // Turns with the pull, a full turn by the time it's far enough.
          style={{ transform: `rotate(${(pull / ARM_PX) * 360}deg)` }}
        />
      </div>
    </div>
  );
}
