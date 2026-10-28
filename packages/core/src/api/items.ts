import { z } from "zod";
import type { AssignedState } from "../assigned-state";
import type { ItemKind, Severity } from "../rules";
import type { StaleLevel } from "../urgency";

// The list's sections.
export type ItemGroup = "review" | "replies" | "assigned" | "mine";

export const ITEM_GROUPS: Record<ItemKind, ItemGroup> = {
  review_requested: "review",
  re_requested: "review",
  reply: "replies",
  mention: "replies",
  reviewed: "mine",
  commented: "mine",
  check_failed: "mine",
  assigned: "assigned",
};

// Most items marked seen in one request.
export const MAX_SEEN_IDS = 500;

export const markSeenBody = z.object({
  ids: z.array(z.string().min(1).max(100)).min(1).max(MAX_SEEN_IDS),
});
export type MarkSeenBody = z.infer<typeof markSeenBody>;

// One row in the list. Dates are ISO strings.
export interface ItemDto {
  id: string;
  kind: ItemKind;
  summary: string;
  actorLogin: string | null;
  actorIsBot: boolean;
  occurredAt: string;
  waitingSince: string | null;
  // Real time since the wait started (or the event), like "3h".
  age: string;
  // Only review requests have one. Null while waiting on the author.
  staleLevel: StaleLevel | null;
  // A review request you commented on, until the author replies or pushes.
  waitingOnAuthor: boolean;
  // What the PR needs next, on assigned rows. Null on other rows.
  assignedState: AssignedState | null;
  // The user is assigned to the PR. Rows of other kinds show a tag.
  assigned: boolean;
  severity: Severity;
  // True if any of the PR's open items is unseen.
  unseen: boolean;
  // The PR's other open items. The list shows one row per PR.
  otherIds: string[];
  pr: {
    // The stored PR's id, for quieting it.
    id: string;
    title: string;
    owner: string;
    repo: string;
    number: number;
    url: string;
    // The GitHub login of who opened the PR.
    author: string;
    // The watched repo's color. Null when off.
    color: string | null;
    // The user marked it important, as a reminder. The list shows a flag.
    important: boolean;
  };
}

// Open items in each section, most urgent first.
export type ItemGroups = Record<ItemGroup, ItemDto[]>;

// An open PR with nothing to do: one of the user's, or one they marked important.
export interface IdlePrDto {
  id: string;
  // The section it shows in, like a merged PR's.
  group: ItemGroup;
  isDraft: boolean;
  // Real time since the PR last changed, like "3h".
  age: string;
  pr: ItemDto["pr"];
}

// A PR the user marked important that merged. It stays on the list until they unmark it.
export interface MergedPrDto {
  id: string;
  // The section it shows in: the user's own PRs, ones they're assigned to, or else
  // review. Picked by `prGroup` on the server.
  group: ItemGroup;
  // Real time since it merged, like "3h".
  age: string;
  pr: ItemDto["pr"];
}

export interface ItemsResponse extends ItemGroups {
  // Newest change first.
  idlePrs: IdlePrDto[];
  // Newest merge first, at the end of their sections. Quiet ones too, since a merge is
  // something new.
  merged: MergedPrDto[];
  // PRs the user quieted, in the same orders. Left out of the sections above.
  quiet: { items: ItemDto[]; idlePrs: IdlePrDto[] };
}

// Counts for the app badge and the menu bar icon. Quiet PRs don't count.
export interface SummaryResponse {
  total: number;
  review: number;
  replies: number;
  assigned: number;
  mine: number;
  // Some review request is orange or red.
  hasStale: boolean;
  hasFailing: boolean;
}
