import { checkFailed } from "./check-failed";
import { commented } from "./commented";
import { mention } from "./mention";
import { reply } from "./reply";
import { reRequested, reviewRequested } from "./review-requested";
import { reviewed } from "./reviewed";
import type { Rule } from "./types";

export type * from "./types";

// Every rule. To add a case, write a rule and add it here.
export const rules: Rule[] = [
  reviewRequested,
  reRequested,
  reply,
  mention,
  reviewed,
  commented,
  checkFailed,
];
