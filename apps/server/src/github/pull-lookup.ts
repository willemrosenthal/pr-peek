import type { PrRef } from "@pr-peek/core";
import type { Octokit } from "octokit";
import { z } from "zod";
import { partialDataOrThrow } from "./errors";
import { rawActor } from "./pull-details";

// `issueOrPullRequest`, so a link to an issue can be told from a missing PR.
const LOOKUP_QUERY = `query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on PullRequest {
        id number title url isDraft state mergedAt headRefOid
        author { __typename login }
        repository { databaseId name owner { login } }
      }
    }
  }
}`;

const rawPr = z.object({
  __typename: z.literal("PullRequest"),
  id: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  state: z.enum(["OPEN", "MERGED", "CLOSED"]),
  mergedAt: z.string().nullable(),
  headRefOid: z.string(),
  author: rawActor.nullable(),
  repository: z.object({
    databaseId: z.number(),
    name: z.string(),
    owner: z.object({ login: z.string() }),
  }),
});

const lookup = z.object({
  repository: z
    .object({
      issueOrPullRequest: z
        .union([rawPr, z.object({ __typename: z.literal("Issue") })])
        .nullable(),
    })
    .nullable(),
});

const STATES = { OPEN: "open", MERGED: "merged", CLOSED: "closed" } as const;

// A PR as the add dialog and the new row need it.
export interface LookedUpPr {
  nodeId: string;
  githubRepoId: number;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  isDraft: boolean;
  state: "open" | "merged" | "closed";
  mergedAt: string | null;
  headSha: string;
}

// Looks a PR up by its link. "issue" if the number is an issue, null if there's no such
// PR or the user can't see it.
export async function lookUpPr(
  octokit: Octokit,
  { owner, repo, number }: PrRef,
): Promise<LookedUpPr | "issue" | null> {
  const data: unknown = await octokit
    .graphql(LOOKUP_QUERY, { owner, name: repo, number })
    .catch(partialDataOrThrow);
  const found = lookup.parse(data).repository?.issueOrPullRequest;
  if (!found) return null;
  if (found.__typename === "Issue") return "issue";
  return {
    nodeId: found.id,
    githubRepoId: found.repository.databaseId,
    owner: found.repository.owner.login,
    repo: found.repository.name,
    number: found.number,
    title: found.title,
    url: found.url,
    author: found.author?.login ?? "ghost",
    isDraft: found.isDraft,
    state: STATES[found.state],
    mergedAt: found.mergedAt,
    headSha: found.headRefOid,
  };
}
