// Checks PR titles. Squash merging makes each title a commit on main, and the release
// workflow reads its type (see docs/15-auto-release.md).
export default {
  extends: ["@commitlint/config-conventional"],
};
