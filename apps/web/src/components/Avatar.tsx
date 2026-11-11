import type { MeResponse } from "@pr-peek/core";
import { cx } from "../cx";
import styles from "./Avatar.module.css";

// The user's GitHub picture, or the first letter of their login until it has one.
// `className` sets its size.
export function Avatar({
  user,
  className,
}: {
  user: MeResponse["user"] | undefined;
  className?: string | undefined;
}) {
  return user?.avatarUrl ? (
    <img className={cx(styles.avatar, className)} src={user.avatarUrl} alt="" />
  ) : (
    <span className={cx(styles.avatar, className)} aria-hidden="true">
      {user?.login.slice(0, 1).toUpperCase()}
    </span>
  );
}
