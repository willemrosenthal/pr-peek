import { Bell, BellOff, Flag } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { cx } from "../cx";
import { canVibrate, haptic } from "../haptics";
import { unflagAction } from "../important";
import styles from "./SwipeRow.module.css";

// How far a row moves before letting go quiets it: a share of its width, but at least
// `SWIPE_MIN_PX`.
const SWIPE_SHARE = 0.45;
const SWIPE_MIN_PX = 140;
// The row covers the action's circle until it has moved this far: the strip's padding
// plus the circle (SwipeRow.module.css).
const CIRCLE_SHOWN_PX = 51;
// Past that, the circle stretches after the row. It gives less the further it goes, and
// never stretches more than this.
const STRETCH_MAX_PX = 80;
// How far a press moves before it counts as a swipe, not a click.
const START_PX = 8;
// A trackpad swipe ends when its scroll events stop for this long.
const WHEEL_END_MS = 150;
// A quick flick acts before it's gone that far: moving at least this fast as it lets go,
// in px per ms, after at least `FLICK_MIN_PX`.
const FLICK_SPEED = 0.5;
const FLICK_MIN_PX = 40;
// Speed is measured over at least this long, since moves come every few ms. A finger
// still for this long before letting go isn't flicking.
const SPEED_WINDOW_MS = 30;
// How long after letting go the row starts closing up, once it has slid out (`.leaving`
// in SwipeRow.module.css), and how long closing takes (`.closing`). Then it moves.
const CLOSE_AFTER_MS = 120;
const CLOSE_MS = 180;
// How long after a drag its click can still arrive. Some browsers send it a bit later.
const CLICK_AFTER_DRAG_MS = 300;
// How long a press is held, without moving, to open the preview.
const LONG_PRESS_MS = 450;
// How long it's held before the preview starts loading. Taps and scrolls end sooner,
// so they don't ask GitHub for anything.
const PRESS_START_MS = 150;

// What ends a selection block: the finger or button lifting, or, if a phone cancelled
// the touch so no lift comes, the next press.
const SELECTION_BLOCK_ENDS = ["pointerup", "touchend", "pointerdown"] as const;

// Stops text selection anywhere until the finger or button lifts, then calls `onEnd`.
// The finger that opened the preview is still down when the sheet slides in under it,
// and a phone's long press would select the sheet's text. It waits on the window, not
// the row: a phone can cancel the row's press while the finger stays down. Returns a
// function that stops it sooner.
//
// iPhones don't always send selectstart for a long press, so the data-long-press
// attribute also makes everything unselectable in CSS (global.css). Anything selected
// anyway is cleared at the end.
function blockSelection(onEnd: () => void): () => void {
  const root = document.documentElement;
  const block = (event: Event) => event.preventDefault();
  const stop = () => {
    document.removeEventListener("selectstart", block);
    for (const type of SELECTION_BLOCK_ENDS) {
      window.removeEventListener(type, stop, true);
    }
    delete root.dataset.longPress;
    window.getSelection()?.removeAllRanges();
    onEnd();
  };
  root.dataset.longPress = "";
  document.addEventListener("selectstart", block);
  // Capture, so nothing that stops these events can hide them.
  for (const type of SELECTION_BLOCK_ENDS) {
    window.addEventListener(type, stop, true);
  }
  return stop;
}

// Stops the click a drag on `row` ends with, so the row's link doesn't open. Clicks
// elsewhere go through. Listens on the window so it runs before the Mac app's link
// handler on the document.
function blockNextClick(row: Element) {
  const stop = () => window.removeEventListener("click", block, true);
  const block = (event: MouseEvent) => {
    // Others go through and keep it waiting, like the hidden switch `haptic` clicks.
    if (!(event.target instanceof Node && row.contains(event.target))) return;
    stop();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("click", block, true);
  setTimeout(stop, CLICK_AFTER_DRAG_MS);
}

// A list row that quiets its PR, or brings it back, when swiped left. Swiped right, it
// calls `onToggleImportant` to mark it important, or unmark it when it is (`important`).
// Rows without `onToggleImportant` quiet or come back either way. A quiet row also has
// a bell button that brings it back. With `unflags`, like a merged row, a swipe either
// way removes the flag with `onToggle`, and the row leaves. In Watching (`watching`),
// removing the flag says "Stop watching", since the row leaves. A long press or a right
// click calls `onLongPress`. `onPressStart` comes partway through a long press, so the
// preview can start loading.
export function SwipeRow({
  prId,
  quiet,
  onToggle,
  unflags = false,
  important = false,
  watching = false,
  onToggleImportant,
  onLongPress,
  onPressStart,
  children,
}: {
  // The row's PR, so the list can find it, like to scroll to a PR just added.
  prId?: string;
  quiet: boolean;
  onToggle: () => void;
  unflags?: boolean;
  important?: boolean;
  watching?: boolean;
  onToggleImportant?: (() => void) | undefined;
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
    el: Element;
    // How fast it's moving across, from the last `SPEED_WINDOW_MS` or more.
    speed: number;
    sample: { x: number; at: number };
  }>(undefined);
  const wheel = useRef({ offset: 0, timer: 0 });
  const leaveTimer = useRef(0);
  const longPressTimer = useRef(0);
  // Ends the selection block a long press starts. Set while it's on.
  const allowSelection = useRef<() => void>(undefined);
  const rowRef = useRef<HTMLDivElement>(null);
  // How far this drag must go, measured when it starts.
  const swipePx = useRef(SWIPE_MIN_PX);
  // Past `swipePx`, so letting go quiets it. The ref has it before it renders.
  const [armed, setArmed] = useState(false);
  const armedNow = useRef(false);
  // The row's height while it closes up, then 0.
  const [height, setHeight] = useState<number | null>(null);
  // Flashes the row after a swipe marks it important or unmarks it.
  const [marked, setMarked] = useState(false);

  const measure = () => {
    const width = rowRef.current?.offsetWidth ?? 0;
    swipePx.current = Math.max(SWIPE_MIN_PX, width * SWIPE_SHARE);
  };

  useEffect(
    () => () => {
      clearTimeout(wheel.current.timer);
      clearTimeout(leaveTimer.current);
      clearTimeout(longPressTimer.current);
      allowSelection.current?.();
    },
    [],
  );

  // A press is over, so no long press is coming.
  const endPress = () => {
    press.current = undefined;
    clearTimeout(longPressTimer.current);
  };

  const arm = (on: boolean) => {
    // A tick as it gets far enough. Only Android can buzz while a finger moves.
    if (on && !armedNow.current && canVibrate()) navigator.vibrate(8);
    armedNow.current = on;
    setArmed(on);
  };

  const move = (to: number) => {
    setDragging(true);
    setOffset(to);
    arm(Math.abs(to) >= swipePx.current);
  };

  // Springs back to where it was.
  const snapBack = () => {
    setDragging(false);
    setOffset(0);
    arm(false);
  };

  // A swipe this way marks it important or unmarks it, not quiet.
  const marksImportant = (at: number) =>
    at > 0 && onToggleImportant !== undefined;

  // Returns whether it acted.
  const release = (at: number): boolean => {
    if (Math.abs(at) < swipePx.current) {
      snapBack();
      return false;
    }
    // The row stays in the list, so it springs back.
    if (marksImportant(at)) {
      snapBack();
      setMarked(true);
      onToggleImportant?.();
      return true;
    }
    setDragging(false);
    setOffset(0);
    // Stays slid out until the row moves, which also ignores the rest of a trackpad swipe.
    setLeaving(at < 0 ? -1 : 1);
    // Then closes up, so the rows below slide up instead of jumping.
    setHeight(rowRef.current?.offsetHeight ?? 0);
    leaveTimer.current = window.setTimeout(() => {
      setHeight(0);
      leaveTimer.current = window.setTimeout(onToggle, CLOSE_MS);
    }, CLOSE_AFTER_MS);
    return true;
  };

  const longPress = () => {
    const p = press.current;
    if (p) {
      p.long = true;
      allowSelection.current ??= blockSelection(() => {
        allowSelection.current = undefined;
      });
      // The sheet opens over the row. This keeps the release coming here, so its click
      // is blocked and the press ends. Touches stay with the row anyway, a mouse doesn't.
      try {
        p.el.setPointerCapture(p.id);
      } catch {
        // The pointer is already gone, so there's no release to wait for.
      }
    }
    // A short buzz, where the device has one (not iPhones, while a finger is down).
    if (canVibrate()) navigator.vibrate(10);
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
      el: event.currentTarget,
      speed: 0,
      sample: { x: event.clientX, at: event.timeStamp },
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
        endPress();
        return;
      }
      p.on = true;
      event.currentTarget.setPointerCapture(p.id);
      measure();
    }
    p.moved = moved;
    const since = event.timeStamp - p.sample.at;
    if (since >= SPEED_WINDOW_MS) {
      p.speed = (event.clientX - p.sample.x) / since;
      p.sample = { x: event.clientX, at: event.timeStamp };
    }
    move(moved);
  };

  // Where a swipe let go counts as: far enough if it was flicked that way.
  const flung = (p: NonNullable<typeof press.current>, now: number) => {
    const still = now - p.sample.at > SPEED_WINDOW_MS * 2;
    const flicked =
      !still &&
      Math.abs(p.speed) >= FLICK_SPEED &&
      Math.abs(p.moved) >= FLICK_MIN_PX &&
      Math.sign(p.speed) === Math.sign(p.moved);
    return flicked ? Math.sign(p.moved) * swipePx.current : p.moved;
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    endPress();
    // The preview is open, so the link shouldn't open too.
    if (p?.long) blockNextClick(event.currentTarget);
    if (!p?.on) return;
    blockNextClick(event.currentTarget);
    // A tick as it acts. iPhones can only do it as a finger lifts.
    if (release(flung(p, event.timeStamp))) haptic();
  };

  const onPointerCancel = () => {
    endPress();
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
  const { Icon: UnflagIcon, label: unflag } = unflagAction(watching);
  const Icon = unflags ? UnflagIcon : quiet ? Bell : BellOff;
  const action = unflags ? unflag : quiet ? "Bring back" : "Quiet";
  const toImportant = marksImportant(shown);
  const ShownIcon = toImportant ? (important ? UnflagIcon : Flag) : Icon;
  // Flag swipes are amber.
  const tone =
    toImportant || unflags
      ? styles.important
      : quiet
        ? styles.back
        : styles.quiet;
  const pulled = Math.max(0, Math.abs(offset) - CIRCLE_SHOWN_PX);
  const stretch = (pulled * STRETCH_MAX_PX) / (pulled + STRETCH_MAX_PX);
  return (
    <div
      ref={rowRef}
      data-pr-id={prId}
      className={cx(
        styles.swipe,
        shown !== 0 && styles.moving,
        height === 0 && styles.closing,
      )}
      style={height === null ? undefined : { height }}
    >
      {shown !== 0 && (
        <div
          className={cx(
            styles.action,
            shown < 0 && styles.end,
            tone,
            armed && styles.armed,
          )}
          style={{ "--stretch": `${stretch}px` } as CSSProperties}
          aria-hidden="true"
        >
          <span className={styles.fill} />
          <span className={styles.circle}>
            <ShownIcon />
          </span>
          <span className={styles.label}>
            {toImportant ? (important ? unflag : "Important") : action}
          </span>
        </div>
      )}
      <div
        className={cx(
          styles.slide,
          dragging && styles.dragging,
          leaving && styles.leaving,
          marked && styles.marked,
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
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setMarked(false);
        }}
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
