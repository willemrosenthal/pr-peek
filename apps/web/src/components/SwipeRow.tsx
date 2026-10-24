import { Bell, BellOff } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { cx } from "../cx";
import styles from "./SwipeRow.module.css";

// How far a row moves before letting go quiets it: a share of its width, but at least
// `SWIPE_MIN_PX`.
const SWIPE_SHARE = 0.45;
const SWIPE_MIN_PX = 140;
// How far a press moves before it counts as a swipe, not a click.
const START_PX = 8;
// A trackpad swipe ends when its scroll events stop for this long.
const WHEEL_END_MS = 150;
// How long after letting go the row moves. Longer than its slide out (`.leaving` in
// SwipeRow.module.css), so it pauses off to the side first.
const LEAVE_MS = 200;
// How long after a drag its click can still arrive. Some browsers send it a bit later.
const CLICK_AFTER_DRAG_MS = 300;
// How long a press is held, without moving, to open the preview.
const LONG_PRESS_MS = 450;
// How long it's held before the preview starts loading. Taps and scrolls end sooner,
// so they don't ask GitHub for anything.
const PRESS_START_MS = 150;

// Stops the click a drag on `row` ends with, so the row's link doesn't open. Clicks
// elsewhere go through. Listens on the window so it runs before the Mac app's link
// handler on the document.
function blockNextClick(row: Element) {
  const stop = () => window.removeEventListener("click", block, true);
  const block = (event: MouseEvent) => {
    stop();
    if (!(event.target instanceof Node && row.contains(event.target))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("click", block, true);
  setTimeout(stop, CLICK_AFTER_DRAG_MS);
}

// A list row that quiets its PR, or brings it back, when swiped sideways. A quiet row
// also has a bell button that brings it back. A long press or a right click calls
// `onLongPress`. `onPressStart` comes partway through a long press, so the preview can
// start loading.
export function SwipeRow({
  quiet,
  onToggle,
  onLongPress,
  onPressStart,
  children,
}: {
  quiet: boolean;
  onToggle: () => void;
  onLongPress?: () => void;
  onPressStart?: () => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  // -1 or 1 while the row slides out that way.
  const [leaving, setLeaving] = useState<-1 | 1 | null>(null);
  // `moved` is kept here too, since the last move may not have rendered by release.
  // `long` is set once the long press fires.
  const press = useRef<{
    x: number;
    y: number;
    id: number;
    on: boolean;
    moved: number;
    long: boolean;
  }>(undefined);
  const wheel = useRef({ offset: 0, timer: 0 });
  const leaveTimer = useRef(0);
  const longPressTimer = useRef(0);
  const rowRef = useRef<HTMLDivElement>(null);
  // How far this drag must go, measured when it starts.
  const swipePx = useRef(SWIPE_MIN_PX);
  // Past `swipePx`, so letting go quiets it.
  const [armed, setArmed] = useState(false);

  const measure = () => {
    const width = rowRef.current?.offsetWidth ?? 0;
    swipePx.current = Math.max(SWIPE_MIN_PX, width * SWIPE_SHARE);
  };

  useEffect(
    () => () => {
      clearTimeout(wheel.current.timer);
      clearTimeout(leaveTimer.current);
      clearTimeout(longPressTimer.current);
    },
    [],
  );

  const move = (to: number) => {
    setDragging(true);
    setOffset(to);
    setArmed(Math.abs(to) >= swipePx.current);
  };

  // Springs back to where it was.
  const snapBack = () => {
    setDragging(false);
    setOffset(0);
    setArmed(false);
  };

  const release = (at: number) => {
    if (Math.abs(at) < swipePx.current) {
      snapBack();
      return;
    }
    setDragging(false);
    setOffset(0);
    // Stays slid out until the row moves, which also ignores the rest of a trackpad swipe.
    setLeaving(at < 0 ? -1 : 1);
    leaveTimer.current = window.setTimeout(onToggle, LEAVE_MS);
  };

  const longPress = () => {
    const p = press.current;
    if (p) p.long = true;
    // A short buzz, where the device has one (not iPhones).
    navigator.vibrate?.(10);
    onLongPress?.();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || leaving) return;
    press.current = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      on: false,
      moved: 0,
      long: false,
    };
    if (onLongPress) {
      clearTimeout(longPressTimer.current);
      // Held still a moment: likely a long press, so it starts loading.
      longPressTimer.current = window.setTimeout(() => {
        onPressStart?.();
        longPressTimer.current = window.setTimeout(
          longPress,
          LONG_PRESS_MS - PRESS_START_MS,
        );
      }, PRESS_START_MS);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== event.pointerId || p.long) return;
    const moved = event.clientX - p.x;
    // A swipe or a scroll, not a long press.
    if (Math.hypot(moved, event.clientY - p.y) >= START_PX) {
      clearTimeout(longPressTimer.current);
    }
    if (!p.on) {
      if (Math.abs(moved) < START_PX) return;
      // Scrolling the list, not swiping.
      if (Math.abs(event.clientY - p.y) > Math.abs(moved)) {
        press.current = undefined;
        return;
      }
      p.on = true;
      event.currentTarget.setPointerCapture(p.id);
      measure();
    }
    p.moved = moved;
    move(moved);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = undefined;
    clearTimeout(longPressTimer.current);
    // The preview is open, so the link shouldn't open too.
    if (p?.long) blockNextClick(event.currentTarget);
    if (!p?.on) return;
    blockNextClick(event.currentTarget);
    release(p.moved);
  };

  const onPointerCancel = () => {
    press.current = undefined;
    clearTimeout(longPressTimer.current);
    snapBack();
  };

  // A right click, or a long press where the browser sends one (Android). Not both.
  const onContextMenu = (event: ReactMouseEvent) => {
    if (!onLongPress) return;
    event.preventDefault();
    if (press.current?.long) return;
    clearTimeout(longPressTimer.current);
    longPress();
  };

  const onWheel = (event: WheelEvent) => {
    const w = wheel.current;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    if (leaving) return;
    if (w.offset === 0) measure();
    w.offset -= event.deltaX;
    move(w.offset);
    clearTimeout(w.timer);
    w.timer = window.setTimeout(() => {
      const at = w.offset;
      w.offset = 0;
      release(at);
    }, WHEEL_END_MS);
  };

  const shown = leaving ?? offset;
  const Icon = quiet ? Bell : BellOff;
  const action = quiet ? "Bring back" : "Quiet";
  return (
    <div
      ref={rowRef}
      className={cx(styles.swipe, shown !== 0 && styles.moving)}
    >
      {shown !== 0 && (
        <div
          className={cx(
            styles.action,
            shown < 0 && styles.end,
            armed && (quiet ? styles.back : styles.armed),
          )}
          aria-hidden="true"
        >
          <Icon />
          {action}
        </div>
      )}
      <div
        className={cx(
          styles.slide,
          dragging && styles.dragging,
          leaving && styles.leaving,
        )}
        style={{
          transform: leaving
            ? `translateX(${leaving * 100}%)`
            : `translateX(${offset}px)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
        // Stops the browser dragging the link out when a mouse swipes.
        onDragStart={(event) => event.preventDefault()}
      >
        {children}
      </div>
      {quiet && (
        <button
          type="button"
          className={styles.bell}
          aria-label={action}
          title={action}
          onClick={onToggle}
        >
          <Icon />
        </button>
      )}
    </div>
  );
}
