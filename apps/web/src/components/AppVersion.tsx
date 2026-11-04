import { BUILD, REPO_URL, type Build } from "../build";
import styles from "./AppVersion.module.css";

// Which release is running, like "Version 1.2.0 (cb85fd4)", with the commit linking to
// GitHub. Just the commit when the build had no release tag.
export function AppVersion({ build = BUILD }: { build?: Build }) {
  if (!build.commit) return null;
  const commit = (
    <a
      href={`${REPO_URL}/commit/${build.commit}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {build.commit.slice(0, 7)}
    </a>
  );
  return (
    <p className={styles.version}>
      {build.version ? (
        <>
          Version {build.version} ({commit})
        </>
      ) : (
        <>Build {commit}</>
      )}
    </p>
  );
}
