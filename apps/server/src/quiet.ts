import { prSnapshot, wakesOnPush, type PrSnapshot } from "@pr-peek/core";
import type { Prisma } from "./generated/prisma/client";
import type { SavedPr } from "./items";

type Tx = Prisma.TransactionClient;

export interface QuietPr {
  id: string;
  // Null if the stored snapshot doesn't parse.
  snapshot: PrSnapshot | null;
}

// The user's quiet PRs, with their snapshots from before this sync.
export async function quietPrs(tx: Tx, userId: string): Promise<QuietPr[]> {
  const rows = await tx.pullRequest.findMany({
    where: { userId, quietAt: { not: null } },
    select: { id: true, snapshot: true },
  });
  return rows.map((row) => ({
    id: row.id,
    snapshot: prSnapshot.safeParse(row.snapshot).data ?? null,
  }));
}

// Brings quiet PRs back when something new happened on them: an item with a new event,
// or new commits on the viewer's own PR. Returns how many woke.
export async function wakeQuietPrs(
  tx: Tx,
  quiet: QuietPr[],
  fetched: SavedPr[],
  newEventItemIds: string[],
  viewerLogin: string,
): Promise<number> {
  if (quiet.length === 0) return 0;
  const withEvents =
    newEventItemIds.length > 0
      ? await tx.item.findMany({
          where: { id: { in: newEventItemIds } },
          select: { pullRequestId: true },
        })
      : [];
  const woke = new Set(withEvents.map((item) => item.pullRequestId));
  const after = new Map(fetched.map((pr) => [pr.id, pr.snapshot]));
  for (const pr of quiet) {
    const latest = after.get(pr.id);
    if (
      pr.snapshot &&
      latest &&
      wakesOnPush(pr.snapshot, latest, viewerLogin)
    ) {
      woke.add(pr.id);
    }
  }
  const ids = quiet.map((pr) => pr.id).filter((id) => woke.has(id));
  if (ids.length === 0) return 0;
  await tx.pullRequest.updateMany({
    where: { id: { in: ids } },
    data: { quietAt: null },
  });
  return ids.length;
}
