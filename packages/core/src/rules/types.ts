import type { PrSnapshot } from "../pr-snapshot";

// Each rule makes items of one kind. The kind is also the rule's id.
export type ItemKind =
  | "review_requested"
  | "re_requested"
  | "reply"
  | "mention"
  | "reviewed"
  | "commented"
  | "check_failed";

export type Severity = "low" | "normal" | "high";
// Where an item shows up: the list only, or also a push notification.
export type Channel = "list" | "push";
// The list section a rule's items go in.
export type RuleGroup = "Other PRs" | "My PRs";

export interface RuleContext {
  viewerLogin: string;
  // The viewer's teams as "org/team-slug". Empty means team requests are ignored.
  viewerTeams: string[];
  now: Date;
  settings: {
    includeTeamRequests: boolean;
    hideBots: boolean;
    // Ask for reviews on draft PRs too.
    includeDrafts: boolean;
  };
}

// One row in the user's list. Matches the `Item` table. Dates are ISO strings.
export interface DetectedItem {
  kind: ItemKind;
  // Same key means the same item. A new key means a new item.
  dedupeKey: string;
  // Changes when something new happens on the item.
  latestEventId: string;
  eventCount: number;
  actorLogin: string | null;
  summary: string;
  occurredAt: string;
  // When the wait started, for review requests. Null for other kinds.
  waitingSince: string | null;
}

export interface Rule {
  id: ItemKind;
  name: string;
  group: RuleGroup;
  defaultSeverity: Severity;
  defaultChannels: Channel[];
  detect: (snapshot: PrSnapshot, ctx: RuleContext) => DetectedItem[];
}
