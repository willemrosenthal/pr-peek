import { Bell, BellOff } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { cx } from "../cx";
import styles from "./SwipeRow.module.css";

// How far a row moves before letting go quiets it.
const SWIPE_PX = 80;
// How far a press moves before it counts as a swipe, not a click.
const START_PX = 8;
// A trackpad swipe ends when its scroll events stop for this long.
const WHEEL_END_MS = 150;
// How long the row takes to slide out.
const LEAVE_MS = 200;
// How long after a drag its click can still arrive. Some browsers send it a bit later.
const CLICK_AFTER_DRAG_MS = 300;

// Stops the click a drag ends with, so the row's link doesn't open. Listens on the window
// so it runs before the Mac app's link handler on the document.
function blockNextClick() {
  const block = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("click", block, { capture: true, once: true });
  setTimeout(
    () => window.removeEventListener("click", block, true),
    CLICK_AFTER_DRAG_MS,
  );
}

// A list row that quiets its PR, or brings it back, when swiped sideways. The bell
// button does the same for a mouse or keyboard.
export function SwipeRow({
  quiet,
  onToggle,
  children,
}: {
  quiet: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  // -1 or 1 while the row slides out that way.
  const [leaving, setLeaving] = useState<-1 | 1 | null>(null);
  // `moved` is kept here too, since the last move may not have rendered by release.
  const press = useRef<{
    x: number;
    y: number;
    id: number;
    on: boolean;
    moved: number;
  }>(undefined);
  const wheel = useRef({ offset: 0, timer: 0 });
  const leaveTimer = useRef(0);

  useEffect(
    () => () => {
      clearTimeout(wheel.current.timer);
      clearTimeout(leaveTimer.current);
    },
    [],
  );

  const move = (to: number) => {
    setDragging(true);
    setOffset(to);
  };

  const release = (at: number) => {
    setDragging(false);
    setOffset(0);
    if (Math.abs(at) < SWIPE_PX) return;
    // Stays slid out, which also ignores the rest of a trackpad swipe. The row leaves this section once the list updates.
    setLeaving(at < 0 ? -1 : 1);
    leaveTimer.current = window.setTimeout(onToggle, LEAVE_MS);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || leaving) return;
    press.current = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      on: false,
      moved: 0,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== event.pointerId) return;
    const moved = event.clientX - p.x;
    if (!p.on) {
      if (Math.abs(moved) < START_PX) return;
      // Scrolling the list, not swiping.
      if (Math.abs(event.clientY - p.y) > Math.abs(moved)) {
        press.current = undefined;
        return;
      }
      p.on = true;
      event.currentTarget.setPointerCapture(p.id);
    }
    p.moved = moved;
    move(moved);
  };

  const onPointerUp = () => {
    const p = press.current;
    press.current = undefined;
    if (!p?.on) return;
    blockNextClick();
    release(p.moved);
  };

  const onPointerCancel = () => {
    press.current = undefined;
    setDragging(false);
    setOffset(0);
  };

  const onWheel = (event: WheelEvent) => {
    const w = wheel.current;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    if (leaving) return;
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
  const buttonLabel = quiet ? action : "Quiet until something new happens";
  return (
    <div className={cx(styles.swipe, shown !== 0 && styles.moving)}>
      {shown !== 0 && (
        <div
          className={cx(
            styles.action,
            shown < 0 && styles.end,
            quiet && styles.back,
          )}
          aria-hidden="true"
        >
          <Icon />
          {action}
        </div>
      )}
      <div
        className={cx(styles.slide, dragging && styles.dragging)}
        style={{
          transform: leaving
            ? `translateX(${leaving * 100}%)`
            : `translateX(${offset}px)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        // Stops the browser dragging the link out when a mouse swipes.
        onDragStart={(event) => event.preventDefault()}
      >
        {children}
      </div>
      <button
        type="button"
        className={styles.bell}
        aria-label={buttonLabel}
        title={buttonLabel}
        onClick={onToggle}
      >
        <Icon />
      </button>
    </div>
  );
}
