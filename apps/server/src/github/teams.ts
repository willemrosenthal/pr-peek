import type { Octokit } from "octokit";
import { z } from "zod";
import { hasOnlyErrorTypes } from "./errors";

// What GitHub says when the token can't read an org's teams (no `read:org` scope).
const NO_ACCESS = ["FORBIDDEN", "INSUFFICIENT_SCOPES", "NOT_FOUND"];

const TEAMS_QUERY = `query ($login: String!) {
  viewer {
    organizations(first: 100) {
      nodes { teams(first: 100, userLogins: [$login]) { nodes { combinedSlug } } }
    }
  }
}`;

const teamsResponse = z.object({
  viewer: z.object({
    organizations: z.object({
      nodes: z.array(
        z
          .object({
            teams: z
              .object({
                nodes: z.array(z.object({ combinedSlug: z.string() })),
              })
              .nullable(),
          })
          .nullable(),
      ),
    }),
  }),
});

// The user's teams as "org/team-slug". Empty if the token can't see them.
export async function fetchViewerTeams(
  octokit: Octokit,
  login: string,
): Promise<string[]> {
  const data: unknown = await octokit
    .graphql(TEAMS_QUERY, { login })
    .catch((err: unknown) => {
      if (!hasOnlyErrorTypes(err, NO_ACCESS)) throw err;
      return (err as { data?: unknown }).data ?? null;
    });
  if (!data) return [];
  return teamsResponse
    .parse(data)
    .viewer.organizations.nodes.flatMap(
      (org) => org?.teams?.nodes.map((team) => team.combinedSlug) ?? [],
    );
}
