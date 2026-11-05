import { z } from "zod";

// The most PRs one person can add by their link. Merged ones still on the list count.
export const MAX_ADDED_PRS = 25;

// A PR link as the user pasted, dropped, or shared it. `parsePrLink` reads it.
const link = z.string().trim().min(1).max(2000);

export const prLookupQuery = z.object({ link });
export type PrLookupQuery = z.infer<typeof prLookupQuery>;

export const addPrBody = z.object({ link });
export type AddPrBody = z.infer<typeof addPrBody>;

// What the add dialog shows about a PR before it's added.
export interface PrLookupResponse {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  state: "open" | "merged" | "closed";
  // Already on the user's list, and whether it's flagged.
  tracked: boolean;
  flagged: boolean;
}

export interface AddPrResponse {
  // The PullRequest row, to scroll to.
  id: string;
  // It was on the list and flagged already, so nothing changed.
  alreadyFlagged: boolean;
}

// Why a link couldn't be looked up or added. The web app shows a message for each.
export type AddPrErrorCode =
  "not_a_pr_link" | "not_a_pr" | "not_found" | "too_many_added";
