import { andMore, isViewer, latestBy, sameLogin } from "./helpers";
import type { Rule } from "./types";

// Someone else's PR the viewer is assigned to. Assigned again after being taken off is a
// new item. Their own PRs are already under My PRs.
export const assigned: Rule = {
  id: "assigned",
  name: "Assigned to me",
  group: "Assigned to me",
  defaultSeverity: "normal",
  defaultChannels: ["list", "push"],
  detect(snapshot, ctx) {
    if (isViewer(snapshot.author, ctx)) return [];
    const assignees = snapshot.assignees ?? [];
    if (!assignees.some((login) => sameLogin(login, ctx.viewerLogin))) {
      return [];
    }

    // Missing if it's older than the fetched timeline.
    const event = latestBy(
      (snapshot.assignEvents ?? []).filter(
        (e) =>
          e.action === "assigned" && sameLogin(e.assignee, ctx.viewerLogin),
      ),
      (e) => e.createdAt,
    );
    const actor = event?.actor;
    const others = assignees.filter(
      (login) => !sameLogin(login, ctx.viewerLogin),
    );
    const byViewer = actor !== undefined && isViewer(actor, ctx);
    const who = !actor
      ? "Assigned to you"
      : byViewer
        ? "You assigned yourself"
        : `${actor.login} assigned you`;
    const eventId = event?.id ?? "current";

    return [
      {
        kind: "assigned",
        dedupeKey: `as:${snapshot.id}:${eventId}`,
        latestEventId: eventId,
        eventCount: 1,
        actorLogin: byViewer ? null : (actor?.login ?? null),
        actorIsBot: actor?.isBot ?? false,
        summary: others[0]
          ? `${who}, with ${others[0]}${andMore(others.length)}`
          : who,
        occurredAt: event?.createdAt ?? snapshot.updatedAt,
        waitingSince: event?.createdAt ?? null,
        waitingOnAuthor: false,
        // A bot assigning you, like a round robin, is only news when bots aren't hidden.
        startsSeen: byViewer || (ctx.settings.hideBots && !!actor?.isBot),
      },
    ];
  },
};
