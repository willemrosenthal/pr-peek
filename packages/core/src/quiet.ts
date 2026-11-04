import type { PrSnapshot } from "./pr-snapshot";
import { lastPushOf, sameLogin } from "./rules/helpers";

// The PR's latest real push, stored, so a later sync can tell when new commits arrive.
export const lastPushSha = (snapshot: PrSnapshot) => lastPushOf(snapshot).sha;

// True if new commits on the viewer's own PR should wake it from quiet. `before` is the
// stored `lastPushSha`, or null if it isn't known yet. Other people's PRs don't wake on
// commits. Merges from the base branch, like "Update branch", don't count.
export const wakesOnPush = (
  before: string | null,
  after: PrSnapshot,
  viewerLogin: string,
) =>
  before !== null &&
  sameLogin(after.author.login, viewerLogin) &&
  before !== lastPushSha(after);
