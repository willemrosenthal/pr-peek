// Checks PR titles. Squash merging makes each title a commit on main, and the release
// workflow reads its type (see docs/completed/15-auto-release.md).
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Any case after the prefix, like "fix: Test" as well as "fix: test".
    "subject-case": [0],
  },
};
