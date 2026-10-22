import type {
  CheckState,
  PrActor,
  PrComment,
  PrReview,
  PrReviewRequestEvent,
  PrSnapshot,
  PrThread,
} from "../pr-snapshot";
import type { RuleContext } from "./types";

// Test data for rules. The viewer is "me". The PR is by "sam" unless changed.

export const VIEWER = "me";

// An ISO time `n` minutes after 10:00 on 2026-10-21.
export const at = (minutes: number) =>
  new Date(Date.UTC(2026, 9, 21, 10, minutes)).toISOString();

export const actor = (login: string, isBot = false): PrActor => ({
  login,
  isBot,
});

export function ctx(
  overrides: Partial<Omit<RuleContext, "settings">> & {
    settings?: Partial<RuleContext["settings"]>;
  } = {},
): RuleContext {
  return {
    viewerLogin: VIEWER,
    viewerTeams: [],
    now: new Date(at(120)),
    ...overrides,
    settings: {
      includeTeamRequests: true,
      hideBots: false,
      includeDrafts: false,
      ...overrides.settings,
    },
  };
}

export function snapshot(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    id: "PR_1",
    number: 7,
    repo: { owner: "acme", name: "web-app" },
    title: "Add login",
    url: "https://github.com/acme/web-app/pull/7",
    author: actor("sam"),
    isDraft: false,
    headSha: "abc123",
    headCommittedAt: at(0),
    updatedAt: at(0),
    reviewRequests: [],
    reviewRequestEvents: [],
    reviews: [],
    threads: [],
    comments: [],
    checks: { state: "SUCCESS", failing: [] },
    ...overrides,
  };
}

// A PR by the viewer, last pushed at minute 0.
export const myPr = (overrides: Partial<PrSnapshot> = {}) =>
  snapshot({ author: actor(VIEWER), ...overrides });

// "Update branch" at minute `minutes`: a merge commit on top of the push at minute 0,
// whose checks were `pushChecks`.
export const branchUpdate = (
  minutes: number,
  pushChecks: CheckState | null = "SUCCESS",
): Partial<PrSnapshot> => ({
  headSha: "merge1",
  headCommittedAt: at(minutes),
  lastPush: { sha: "abc123", committedAt: at(0), checkState: pushChecks },
});

export const thread = (
  comments: PrComment[],
  isResolved = false,
): PrThread => ({ id: "T_1", isResolved, comments });

export const requested = (
  id: string,
  minutes: number,
  reviewer: PrReviewRequestEvent["reviewer"] = { type: "user", login: VIEWER },
): PrReviewRequestEvent => ({
  id,
  action: "requested",
  reviewer,
  createdAt: at(minutes),
});

// Pass a login, or an actor for bots.
const toActor = (author: string | PrActor) =>
  typeof author === "string" ? actor(author) : author;

export const review = (
  id: string,
  author: string | PrActor,
  minutes: number,
  state: PrReview["state"] = "COMMENTED",
): PrReview => ({
  id,
  author: toActor(author),
  state,
  submittedAt: at(minutes),
});

export const comment = (
  id: string,
  author: string | PrActor,
  minutes: number,
  overrides: Partial<PrComment> = {},
): PrComment => ({
  id,
  author: toActor(author),
  bodyPreview: `Comment ${id}`,
  mentions: [],
  createdAt: at(minutes),
  replyToId: null,
  ...overrides,
});
