import {
  formatAge,
  isQuiet,
  prPushBody,
  type PushPayload,
  type Severity,
} from "@pr-peek/core";
import type { Logger } from "pino";
import type { Db } from "./db";
import type {
  PushSubscription,
  User,
  UserSettings,
} from "./generated/prisma/client";
import { openItems, summarize } from "./item-list";
import { loadRuleSettings } from "./items";
import {
  deliver,
  isDesktopOnline,
  NOTIFY_TTL_SECONDS,
  type SendPush,
} from "./push";

// This many or more notifications for one user at once go out as one push.
export const BATCH_MIN = 3;
// Item summaries listed in a batch push.
const BATCH_LISTED = 3;

export interface NotifyDeps {
  db: Db;
  // Null when push is off, because the VAPID keys aren't set.
  send: SendPush | null;
  logger: Logger;
  now?: () => Date;
}

// One notification to consider. `reminder` is a stage from `reminderStage`: it sends an
// overdue reminder instead, once per stage, even if the user saw the item.
export interface NotifyRequest {
  itemId: string;
  reminder?: string | undefined;
}

// What happened, for logs and tests.
export type NotifyOutcome =
  | "sent"
  | "failed"
  | "push_off"
  | "not_open"
  | "seen"
  | "not_important"
  | "rule_off"
  | "muted"
  | "quiet"
  | "no_devices"
  | "already_sent";

// A notification that passed every check, ready to claim and send.
interface Ready {
  userId: string;
  desktopSeenAt: Date | null;
  logKey: { itemId: string; eventId: string; channel: "push" };
  devices: PushSubscription[];
  severity: Severity;
  payload: Omit<PushPayload, "badge">;
}

// Sends one notification. See `notifyItems`.
export async function notifyItem(
  deps: NotifyDeps,
  itemId: string,
  reminder?: string,
): Promise<NotifyOutcome> {
  const [outcome] = await notifyItems(deps, [{ itemId, reminder }]);
  return outcome!;
}

// Sends a push about each item's latest event to its user's devices, unless something says
// not to. Each event notifies at most once, even if this runs again. When a user has
// `BATCH_MIN` or more at once, they go out as one push. Outcomes match `requests`.
export async function notifyItems(
  deps: NotifyDeps,
  requests: NotifyRequest[],
): Promise<NotifyOutcome[]> {
  const { db, send } = deps;
  const now = deps.now?.() ?? new Date();
  if (!send) return requests.map(() => "push_off");

  // Checks everything before writing, so an error here leaves nothing claimed to retry.
  const decided: (NotifyOutcome | Ready)[] = [];
  for (const request of requests) decided.push(await decide(db, now, request));

  // Claims each event before sending. A second run finds the row and stops.
  const outcomes: NotifyOutcome[] = [];
  const claimed: { index: number; ready: Ready }[] = [];
  for (const [index, decision] of decided.entries()) {
    if (typeof decision === "string") {
      outcomes[index] = decision;
      continue;
    }
    const { count } = await db.notificationLog.createMany({
      data: [{ userId: decision.userId, ...decision.logKey }],
      skipDuplicates: true,
    });
    if (count === 0) outcomes[index] = "already_sent";
    else claimed.push({ index, ready: decision });
  }

  const byUser = new Map<string, typeof claimed>();
  for (const entry of claimed) {
    const group = byUser.get(entry.ready.userId);
    if (group) group.push(entry);
    else byUser.set(entry.ready.userId, [entry]);
  }
  for (const [userId, group] of byUser) {
    const batches =
      group.length >= BATCH_MIN ? [group] : group.map((entry) => [entry]);
    for (const batch of batches) {
      const readies = batch.map(({ ready }) => ready);
      const outcome = await sendClaimed(
        { ...deps, send },
        now,
        userId,
        readies,
      );
      for (const { index } of batch) outcomes[index] = outcome;
    }
  }
  return outcomes;
}

// What a push says about its PR. Not the whole row, which can hold a large snapshot.
const PUSH_PR_FIELDS = {
  githubRepoId: true,
  title: true,
  repoName: true,
  number: true,
  url: true,
} as const;

async function decide(
  db: Db,
  now: Date,
  { itemId, reminder }: NotifyRequest,
): Promise<NotifyOutcome | Ready> {
  const item = await db.item.findUnique({
    where: { id: itemId },
    include: {
      pullRequest: { select: PUSH_PR_FIELDS },
      user: { include: { settings: true, pushSubscriptions: true } },
    },
  });
  if (!item || item.status !== "open") return "not_open";
  if (item.seenAt && !reminder) return "seen";

  const { userId, pullRequest: pr, user } = item;
  const setting = (await loadRuleSettings(db, userId)).find(
    (s) => s.rule.id === item.kind,
  );
  if (!setting?.enabled || !setting.channels.includes("push")) {
    return "rule_off";
  }
  const devices = await reach(db, now, user, pr.githubRepoId, setting.severity);
  if (typeof devices === "string") return devices;

  return {
    userId,
    desktopSeenAt: user.desktopSeenAt,
    logKey: {
      itemId,
      eventId: reminder
        ? `${item.latestEventId}:${reminder}`
        : item.latestEventId,
      channel: "push",
    },
    devices,
    severity: setting.severity,
    payload: {
      title:
        reminder && item.waitingSince
          ? `Waiting ${formatAge(item.waitingSince, now)}: ${item.summary}`
          : item.summary,
      body: prPushBody(pr.title, pr.repoName, pr.number),
      url: pr.url,
      tag: itemId,
      itemId,
    },
  };
}

type Reachable = Pick<User, "id" | "desktopSeenAt"> & {
  settings: UserSettings | null;
  pushSubscriptions: PushSubscription[];
};

// The user's devices that take a notification of this severity about a PR in this repo,
// or why none do. Every device takes every severity. The old per-device level
// (`minSeverity`) is no longer read, and no longer set.
async function reach(
  db: Db,
  now: Date,
  user: Reachable,
  githubRepoId: number,
  severity: Severity,
): Promise<"muted" | "quiet" | "no_devices" | PushSubscription[]> {
  const repo = await db.watchedRepo.findUnique({
    where: { userId_githubRepoId: { userId: user.id, githubRepoId } },
    select: { muted: true },
  });
  if (repo?.muted) return "muted";

  const { settings } = user;
  const breaksQuiet = settings?.highBreaksQuiet && severity === "high";
  if (settings && isQuiet(settings, now) && !breaksQuiet) return "quiet";

  const devices = user.pushSubscriptions;
  // The running Mac menu bar app takes every severity.
  const desktop = isDesktopOnline(user.desktopSeenAt, now);
  if (devices.length === 0 && !desktop) return "no_devices";
  return devices;
}

// Sends a push saying each important PR merged, once, even if this runs again. High
// severity, since the user marked it. Outcomes match `prIds`.
export async function notifyMerged(
  deps: NotifyDeps,
  prIds: string[],
): Promise<NotifyOutcome[]> {
  const { send } = deps;
  const now = deps.now?.() ?? new Date();
  if (!send) return prIds.map(() => "push_off");
  const outcomes: NotifyOutcome[] = [];
  for (const prId of prIds) {
    outcomes.push(await notifyOneMerged({ ...deps, send }, now, prId));
  }
  return outcomes;
}

async function notifyOneMerged(
  deps: NotifyDeps & { send: SendPush },
  now: Date,
  prId: string,
): Promise<NotifyOutcome> {
  const { db, send, logger } = deps;
  const pr = await db.pullRequest.findUnique({
    where: { id: prId },
    select: {
      ...PUSH_PR_FIELDS,
      id: true,
      userId: true,
      state: true,
      importantAt: true,
      user: { include: { settings: true, pushSubscriptions: true } },
    },
  });
  if (!pr || pr.state !== "merged" || !pr.importantAt) return "not_important";
  const devices = await reach(db, now, pr.user, pr.githubRepoId, "high");
  if (typeof devices === "string") return devices;

  // Claims it before sending. A second run finds it claimed and stops.
  const { count } = await db.pullRequest.updateMany({
    where: { id: prId, mergeNotifiedAt: null },
    data: { mergeNotifiedAt: now },
  });
  if (count === 0) return "already_sent";
  try {
    const badge = summarize(await openItems(db, pr.userId, now)).total;
    return await deliver(
      { db, send, logger },
      pr.user,
      devices,
      {
        title: "Important PR merged",
        body: prPushBody(pr.title, pr.repoName, pr.number),
        url: pr.url,
        tag: `merged:${pr.id}`,
        badge,
      },
      { ttlSeconds: NOTIFY_TTL_SECONDS, urgency: "high", now },
    );
  } catch (err) {
    logger.error({ err, prId }, "notify merged failed");
    return "failed";
  }
}

// Sends claimed notifications for one user: alone, or as one batch push. Marks their logs
// "sent" or "failed". Past the claim, a retry would stop at the claim, so errors end as
// "failed" here.
async function sendClaimed(
  deps: NotifyDeps & { send: SendPush },
  now: Date,
  userId: string,
  readies: Ready[],
): Promise<"sent" | "failed"> {
  const { db, send, logger } = deps;
  let outcome: "sent" | "failed" = "failed";
  try {
    const badge = summarize(await openItems(db, userId, now)).total;
    const [first] = readies;
    const payload =
      first && readies.length === 1 ? first.payload : batchOf(readies);
    // Each device that takes any of them gets the push once.
    const devices = [
      ...new Map(
        readies.flatMap((r) => r.devices).map((device) => [device.id, device]),
      ).values(),
    ];
    const urgent = readies.some((r) => r.severity === "high");
    outcome = await deliver(
      { db, send, logger },
      { id: userId, desktopSeenAt: first?.desktopSeenAt ?? null },
      devices,
      { ...payload, badge },
      {
        ttlSeconds: NOTIFY_TTL_SECONDS,
        urgency: urgent ? "high" : "normal",
        now,
      },
    );
  } catch (err) {
    logger.error({ err, userId }, "notify failed");
  }
  await db.notificationLog.updateMany({
    where: { OR: readies.map((r) => r.logKey) },
    data: { status: outcome },
  });
  return outcome;
}

// One push for several notifications, listing the first few. Opens the list.
function batchOf(readies: Ready[]): Omit<PushPayload, "badge"> {
  const listed = readies.slice(0, BATCH_LISTED).map((r) => r.payload.title);
  const more = readies.length - listed.length;
  return {
    title: `${readies.length} things need you`,
    body: [...listed, ...(more > 0 ? [`+${more} more`] : [])].join("\n"),
    url: "/",
    tag: "batch",
  };
}
