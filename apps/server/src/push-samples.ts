import {
  prPushBody,
  PUSH_KINDS,
  type PushKind,
  type PushPayload,
} from "@pr-peek/core";
import { pushActor } from "./push";

// What each kind's notification says, like the real one. `who` did it.
const TITLES: Record<PushKind, (who: string) => string> = {
  review_requested: () => "Review requested",
  re_requested: () => "Re-review requested",
  approved: (who) => `${who} approved`,
  changes_requested: (who) => `${who} requested changes`,
  commented: (who) => `${who}: "Looks good, one question"`,
  reply: (who) => `${who}: "Good call, moved it"`,
  mention: (who) => `${who}: "@you can you look?"`,
  check_failed: () => "Checks failed",
  assigned: (who) => `${who} assigned you`,
  merged: () => "Important PR merged",
};

// Kinds whose real notifications have no person, so they show the app icon.
const NOBODY = new Set<PushKind>(["check_failed", "merged"]);

// One notification of each kind for "Send a test", with `login` as the person, so their
// own picture shows. Then a plain one, like the morning summary.
export function pushSamples(login: string): PushPayload[] {
  const body = prPushBody("A test from Git Buddy", "git-buddy/samples", 1);
  return [
    ...PUSH_KINDS.map((kind) => ({
      title: TITLES[kind](login),
      body,
      url: "/",
      tag: `test:${kind}`,
      kind,
      ...(!NOBODY.has(kind) && pushActor(login)),
    })),
    {
      title: "Morning summary",
      body: "A test from Git Buddy: 2 reviews and 1 reply wait for you",
      url: "/",
      tag: "test:summary",
    },
  ];
}
