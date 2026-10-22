import { z } from "zod";

// Keeps each sync's cost predictable.
export const MAX_WATCHED_REPOS = 50;

// GitHub owner and repo names: letters, numbers, ".", "-", and "_".
const githubName = z
  .string()
  .regex(/^[\w.-]{1,100}$/, "Not a valid GitHub name");

export const addRepoBody = z.object({ owner: githubName, name: githubName });
export type AddRepoBody = z.infer<typeof addRepoBody>;

export const updateRepoBody = z
  .object({ enabled: z.boolean(), muted: z.boolean() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateRepoBody = z.infer<typeof updateRepoBody>;

export const searchReposQuery = z.object({
  query: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
});

// A repo the user can pick from.
export interface RepoOption {
  githubRepoId: number;
  owner: string;
  name: string;
  isPrivate: boolean;
  // Already in the user's watch list.
  watched: boolean;
}

export interface SearchReposResponse {
  repos: RepoOption[];
  // Pass back as `cursor` to get the next page. Null when there are no more.
  nextCursor: string | null;
}

export interface WatchedRepoDto {
  id: string;
  githubRepoId: number;
  owner: string;
  name: string;
  enabled: boolean;
  muted: boolean;
}
