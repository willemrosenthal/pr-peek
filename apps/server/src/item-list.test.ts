import { expect, it } from "vitest";
import { storedSnapshot } from "../test/items";
import { idleGroup } from "./item-list";

const approved = {
  id: "R_1",
  author: { login: "octocat", isBot: false },
  state: "APPROVED" as const,
  submittedAt: "2026-10-21T10:00:00Z",
};

it.each([
  {
    pr: "the user's own",
    fields: { author: { login: "OctoCat", isBot: false } },
    group: "mine",
  },
  { pr: "assigned", fields: { assignees: ["octocat"] }, group: "assigned" },
  {
    pr: "assigned and reviewed",
    fields: { assignees: ["octocat"], reviews: [approved] },
    group: "review",
  },
  {
    pr: "assigned and asked to review",
    fields: {
      assignees: ["octocat"],
      reviewRequests: [{ type: "user" as const, login: "octocat" }],
    },
    group: "review",
  },
  { pr: "anyone else's", fields: {}, group: "review" },
])("puts $pr under $group", ({ fields, group }) => {
  expect(idleGroup(storedSnapshot(fields), "octocat")).toBe(group);
});
