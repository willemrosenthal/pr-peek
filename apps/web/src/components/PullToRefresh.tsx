import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";
import { canVibrate, haptic } from "../haptics";
import { rubberBand } from "../rubber-band";
import styles from "./PullToRefresh.module.css";

// How far a finger moves before it counts as a pull, not a tap or a swipe.
export const START_PX = 8;
// The furthest the page comes down.
export const MAX_PX = 160;
// How far the page comes down before letting go refreshes. Room for the burst.
export const ARM_PX = 70;
// How fast the page moves at first, for each px the finger moves.
export const RESISTANCE = 0.55;

// How far the page comes down for a finger `distance` past the start. About half as
// far as the finger at first, then heavier the further it goes, and never past MAX_PX.
export const pullOffset = (distance: number) =>
  rubberBand(RESISTANCE * distance, MAX_PX);

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
  const { offset, dragging, arms, fired } = usePull(options);
  return (
    <>
      <Behind
        offset={offset}
        dragging={dragging}
        refreshing={options.refreshing}
        arms={arms}
        fired={fired}
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

// How far the page is down, while a finger pulls it, how many pulls have gone far
// enough to refresh, and whether the last one let go and refreshed.
function usePull({ refreshing, onRefresh, enabled }: Options) {
  // How far the page is down.
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [arms, setArms] = useState(0);
  // Until the next pull starts.
  const [fired, setFired] = useState(false);
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
        setFired(false);
      }
      // Older browsers ignore the overscroll CSS, so this stops them scrolling too.
      if (event.cancelable) event.preventDefault();
      const at = pullOffset(dy - START_PX);
      const arming = at >= ARM_PX && t.at < ARM_PX && !isRefreshing();
      if (arming) {
        setArms((n) => n + 1);
        // A buzz, where the phone can buzz mid-pull.
        if (canVibrate()) haptic();
      }
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
      setFired(true);
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

  return { offset, dragging, arms, fired };
}

// How far the ring turns as the page comes down, before it's far enough.
const TURN_DEG_PER_PX = 3;

// Bright colors for the splotches. Each pull picks a base and `SPLOTCHES` more.
const SPLOTCH_COLORS = [
  "#ff4fa3",
  "#ff8a3d",
  "#ffd93d",
  "#5ef08c",
  "#3de0ff",
  "#5b7cff",
  "#b15bff",
];
const SPLOTCHES = 5;

const between = (min: number, max: number) => min + Math.random() * (max - min);

// A new random mix: colors in a random order, at random places and sizes.
function makeSplotches() {
  const [base, ...colors] = SPLOTCH_COLORS.map((color) => ({
    color,
    order: Math.random(),
  }))
    .sort((a, b) => a.order - b.order)
    .map(({ color }) => color);
  return {
    base,
    splotches: colors.slice(0, SPLOTCHES).map((color) => ({
      color,
      // Where its middle is, and how wide it is, as a share of the gap's width.
      x: between(0, 100),
      y: between(0, 100),
      size: between(45, 80),
      // How long one drift takes. Each starts partway through, so they don't line up.
      drift: between(5, 9),
      start: between(0, 9),
    })),
  };
}

// The splotches, mixed once when they appear. Remount them for a new mix.
function Splotches() {
  const [{ base, splotches }] = useState(makeSplotches);
  return (
    <div className={styles.splotches} style={{ background: base }}>
      {splotches.map((splotch) => (
        <span
          key={splotch.color}
          className={styles.splotch}
          style={
            {
              left: `${splotch.x}%`,
              top: `${splotch.y}%`,
              width: `${splotch.size}%`,
              "--color": splotch.color,
              animationDuration: `${splotch.drift}s`,
              animationDelay: `-${splotch.start}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

// What's behind the page, in the gap a pull opens above it: a ring that turns with
// the pull, and grainy splotches of color once letting go would refresh, a new mix
// each time (`arms`). A pull during a refresh shows the colors with "Refreshing…"
// instead of the ring. Once a pull has let go and refreshed (`fired`), the ring stays
// hidden as the page goes up.
function Behind({
  offset,
  dragging,
  refreshing,
  arms,
  fired,
}: {
  offset: number;
  dragging: boolean;
  refreshing: boolean;
  arms: number;
  fired: boolean;
}) {
  const armed = !refreshing && offset >= ARM_PX;
  // A pull during a refresh shows the colors right away, to say it's running.
  const colorful = armed || (refreshing && offset > 0);
  return (
    <div
      className={styles.behind}
      // As tall as the furthest pull, below the notch.
      style={{ height: `calc(env(safe-area-inset-top) + ${MAX_PX}px)` }}
      aria-hidden="true"
    >
      <div className={cx(styles.rainbow, colorful && styles.shown)}>
        <Splotches key={arms} />
      </div>
      <div
        className={cx(
          styles.spinner,
          dragging && styles.dragging,
          armed && styles.armed,
          fired && styles.fired,
        )}
        style={{
          // Centered in the gap, so it stays in view as the gap opens. Fully shown once
          // far enough to refresh, or right away during a refresh. `translate`, not
          // `transform`, so the pop's scale doesn't stretch it off center.
          translate: `0 ${offset / 2}px`,
          opacity: refreshing && offset > 0 ? 1 : Math.min(1, offset / ARM_PX),
        }}
      >
        {refreshing ? (
          <span className={styles.label}>Refreshing…</span>
        ) : (
          <span
            className={styles.ring}
            style={{ rotate: `${offset * TURN_DEG_PER_PX}deg` }}
          />
        )}
      </div>
    </div>
  );
}
