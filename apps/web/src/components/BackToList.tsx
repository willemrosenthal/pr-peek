import { Link } from "react-router";
import styles from "./BackToList.module.css";
import { BackArrow } from "./RainbowIcon";

// The rainbow back arrow. Goes to the list, unless `to` says where.
export function BackToList({
  to = "/",
  label = "Back to your list",
}: {
  to?: string;
  label?: string;
}) {
  return (
    <Link to={to} className={styles.back} aria-label={label} title={label}>
      <BackArrow />
    </Link>
  );
}
