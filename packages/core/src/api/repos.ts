import { z } from "zod";

// Keeps each sync's cost predictable.
export const MAX_WATCHED_REPOS = 50;

// GitHub owner and repo names: letters, numbers, ".", "-", and "_".
const githubName = z
  .string()
  .regex(/^[\w.-]{1,100}$/, "Not a valid GitHub name");

export const addRepoBody = z.object({ owner: githubName, name: githubName });
export type AddRepoBody = z.infer<typeof addRepoBody>;

// "#rrggbb".
const repoColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Use a hex color, like #3b82f6");

export const updateRepoBody = z
  .object({
    enabled: z.boolean(),
    muted: z.boolean(),
    color: repoColor,
    colorOn: z.boolean(),
  })
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
  // The picked color, kept while turned off. Null until one is picked.
  color: string | null;
  // Whether the list shows the color.
  colorOn: boolean;
}

export interface WatchedReposResponse {
  repos: WatchedRepoDto[];
}

// From POST /api/repos.
export interface AddRepoResponse {
  repo: WatchedRepoDto;
}
