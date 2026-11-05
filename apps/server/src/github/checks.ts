import type { CheckState, PrSnapshot } from "@pr-peek/core";
import { z } from "zod";
import type { GraphQLErrorItem } from "./errors";

// Check run results that count as failed. Not CANCELLED: a run was stopped, like by a
// newer run of the same check.
const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
]);
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);
// Check runs and statuses still going.
const RUNNING_RUNS = new Set([
  "QUEUED",
  "IN_PROGRESS",
  "PENDING",
  "WAITING",
  "REQUESTED",
]);
const RUNNING_STATES = new Set(["PENDING", "EXPECTED"]);

const COUNTS = `checkRunCountsByState { state count }
  statusContextCountsByState { state count }`;

// How many check runs and statuses on a commit ended each way. For older commits.
export const CHECK_COUNTS = `contexts { ${COUNTS} }`;

// Each check run and commit status on a commit, and the counts for when some are hidden.
export const CHECK_CONTEXTS = `contexts(first: 100) {
  ${COUNTS}
  pageInfo { hasNextPage }
  nodes {
    __typename
    ... on CheckRun { name conclusion startedAt detailsUrl }
    ... on StatusContext { context state createdAt targetUrl }
  }
}`;

const stateCount = z.object({ state: z.string(), count: z.number() });

export const rawCheckCounts = z.object({
  checkRunCountsByState: z.array(stateCount),
  statusContextCountsByState: z.array(stateCount),
});
type CheckCounts = z.infer<typeof rawCheckCounts>;

export const rawChecks = rawCheckCounts.extend({
  pageInfo: z.object({ hasNextPage: z.boolean() }),
  nodes: z.array(
    z
      .object({
        __typename: z.string(),
        name: z.string().optional(),
        // Null until the run finishes.
        conclusion: z.string().nullable().optional(),
        // Null while it waits to start.
        startedAt: z.string().nullable().optional(),
        detailsUrl: z.string().nullable().optional(),
        context: z.string().optional(),
        state: z.string().optional(),
        createdAt: z.string().optional(),
        targetUrl: z.string().nullable().optional(),
      })
      // A check run hidden from a fine-grained token.
      .nullable(),
  ),
});
type RawChecks = z.infer<typeof rawChecks>;

// Fine-grained tokens can't have the Checks permission, so GitHub hides each check run
// from them (path ends in `contexts.nodes.<index>`). Commit statuses still come through.
export const isHiddenCheckRun = ({ type, path }: GraphQLErrorItem) =>
  type === "FORBIDDEN" &&
  path?.at(-2) === "nodes" &&
  path.at(-3) === "contexts";

interface Check {
  // Runs of the same check share it.
  key: string;
  // When it started. Sorts by time, as ISO strings do.
  at: string;
  name: string;
  url: string | null;
  failed: boolean;
  running: boolean;
}

// Waiting to start, so newer than any run that started.
const NOT_STARTED = "~";

function toCheck(node: RawChecks["nodes"][number]): Check | null {
  if (node?.__typename === "CheckRun" && node.name) {
    return {
      key: `run:${node.name}`,
      at: node.startedAt ?? NOT_STARTED,
      name: node.name,
      url: node.detailsUrl ?? null,
      failed: FAILED_CONCLUSIONS.has(node.conclusion ?? ""),
      running: !node.conclusion,
    };
  }
  if (node?.__typename === "StatusContext" && node.context) {
    return {
      key: `status:${node.context}`,
      at: node.createdAt ?? "",
      name: node.context,
      url: node.targetUrl ?? null,
      failed: FAILED_STATES.has(node.state ?? ""),
      running: RUNNING_STATES.has(node.state ?? ""),
    };
  }
  return null;
}

// The newest run of each check, as GitHub's PR page shows them. A check can run more than
// once on a commit, like when it's re-run, or when editing the PR starts its workflow
// again. Only its last run counts.
function newestChecks(contexts: RawChecks): Check[] {
  const newest = new Map<string, Check>();
  for (const check of contexts.nodes.map(toCheck)) {
    if (!check) continue;
    const kept = newest.get(check.key);
    if (!kept || check.at > kept.at) newest.set(check.key, check);
  }
  return [...newest.values()];
}

const failedOf = (checks: Check[]): PrSnapshot["checks"]["failing"] =>
  checks
    .filter((check) => check.failed)
    .map(({ name, url }) => ({ name, url }));

// The checks that failed on their newest run.
export const failingChecks = (contexts: RawChecks | undefined) =>
  contexts ? failedOf(newestChecks(contexts)) : [];

const anyOf = (counts: z.infer<typeof stateCount>[], states: Set<string>) =>
  counts.some((c) => states.has(c.state) && c.count > 0);

// From the counts, which include every run, not only the newest of each check.
function stateFromCounts(counts: CheckCounts): CheckState | null {
  const { checkRunCountsByState: runs, statusContextCountsByState: statuses } =
    counts;
  if (anyOf(runs, FAILED_CONCLUSIONS) || anyOf(statuses, FAILED_STATES)) {
    return "FAILURE";
  }
  if (anyOf(runs, RUNNING_RUNS) || anyOf(statuses, RUNNING_STATES)) {
    return "PENDING";
  }
  return [...runs, ...statuses].some((c) => c.count > 0) ? "SUCCESS" : null;
}

// True if a check run or status failed, from the counts. For older commits, where the
// counts are all we ask for.
export const countsFailed = (counts: CheckCounts | null) =>
  counts !== null && stateFromCounts(counts) === "FAILURE";

// What a commit's checks say, from the newest run of each check. GitHub's own state counts
// every run, so a run cancelled, or failed before a re-run that passed, reads as failed.
// From the counts when some runs are hidden, or there are more than 100.
export function readChecks(
  rollup: { state: CheckState; contexts: RawChecks } | null,
): PrSnapshot["checks"] {
  if (!rollup) return { state: null, githubState: null, failing: [] };
  const { contexts } = rollup;
  const checks = newestChecks(contexts);
  const failing = failedOf(checks);
  const allShown =
    !contexts.pageInfo.hasNextPage && contexts.nodes.every((n) => n !== null);
  let state: CheckState | null;
  if (!allShown) state = stateFromCounts(contexts);
  else if (failing.length > 0) state = "FAILURE";
  else if (checks.some((check) => check.running)) state = "PENDING";
  else state = checks.length > 0 ? "SUCCESS" : null;
  return { state, githubState: rollup.state, failing };
}
