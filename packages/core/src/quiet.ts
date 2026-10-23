import type { PrSnapshot } from "./pr-snapshot";
import { lastPushOf, sameLogin } from "./rules/helpers";

// True if new commits on the viewer's own PR should wake it from quiet. Other people's
// PRs don't wake on commits. Merges from the base branch, like "Update branch", don't count.
export const wakesOnPush = (
  before: PrSnapshot,
  after: PrSnapshot,
  viewerLogin: string,
) =>
  sameLogin(after.author.login, viewerLogin) &&
  lastPushOf(before).sha !== lastPushOf(after).sha;
