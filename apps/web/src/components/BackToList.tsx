import { Link } from "react-router";
import styles from "./BackToList.module.css";
import { BackArrow } from "./RainbowIcon";

export function BackToList() {
  return (
    <Link
      to="/"
      className={styles.back}
      aria-label="Back to your list"
      title="Back to your list"
    >
      <BackArrow />
    </Link>
  );
}
