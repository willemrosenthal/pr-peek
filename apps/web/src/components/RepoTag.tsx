import type { ReactNode } from "react";
import { tagTextColor } from "../repoColor";
import styles from "./RepoTag.module.css";

// A repo name. In a colored pill when the repo has a color, plain otherwise.
export function RepoTag({
  color,
  children,
}: {
  color: string | null;
  children: ReactNode;
}) {
  if (!color) return <>{children}</>;
  return (
    <span
      className={styles.tag}
      style={{ background: color, color: tagTextColor(color) }}
    >
      {children}
    </span>
  );
}
