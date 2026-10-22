import { z } from "zod";
import type { ItemKind, Severity } from "../rules";
import type { StaleLevel } from "../urgency";

// The list's sections.
export type ItemGroup = "review" | "replies" | "mine";

export const ITEM_GROUPS: Record<ItemKind, ItemGroup> = {
  review_requested: "review",
  re_requested: "review",
  reply: "replies",
  mention: "replies",
  reviewed: "mine",
  commented: "mine",
  check_failed: "mine",
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
  occurredAt: string;
  waitingSince: string | null;
  // Real time since the wait started (or the event), like "3h".
  age: string;
  // Only review requests have one.
  staleLevel: StaleLevel | null;
  severity: Severity;
  // True if any of the PR's open items is unseen.
  unseen: boolean;
  // The PR's other open items. The list shows one row per PR.
  otherIds: string[];
  pr: {
    title: string;
    owner: string;
    repo: string;
    number: number;
    url: string;
  };
}

// Open items in each section, most urgent first.
export type ItemsResponse = Record<ItemGroup, ItemDto[]>;

// Counts for the app badge and the menu bar icon.
export interface SummaryResponse {
  total: number;
  review: number;
  replies: number;
  mine: number;
  // Some review request is orange or red.
  hasStale: boolean;
  hasFailing: boolean;
}
