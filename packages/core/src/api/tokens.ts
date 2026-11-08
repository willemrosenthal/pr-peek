import { z } from "zod";
import { githubTokenBody } from "./auth";

// Personal access tokens a user can add. Each adds about 2 GitHub calls per sync.
export const MAX_TOKENS = 5;

export const tokenName = z.string().trim().min(1).max(60);

// Adding a token, or replacing one with it. Without a name, it's named after what it
// reaches (see CheckTokenResponse).
export const saveTokenBody = githubTokenBody.extend({
  name: tokenName.optional(),
});
export type SaveTokenBody = z.infer<typeof saveTokenBody>;

export type TokenKind = "classic" | "fine_grained";

// One of the user's personal access tokens. Never the token itself.
export interface TokenDto {
  id: string;
  name: string;
  // Null until a sync first reads a token copied from before plan 20. Show no kind.
  kind: TokenKind | null;
  // The users and orgs whose private repos it reaches. A classic token reaches all.
  owners: string[];
  // Empty for fine-grained tokens, which have no scopes.
  scopes: string[];
  // Null when it never expires.
  expiresAt: string | null;
  // "stopped": GitHub stopped accepting it. Its owners sync with the sign in.
  status: "working" | "stopped";
  createdAt: string;
}

export interface TokensResponse {
  tokens: TokenDto[];
  // Each owner of a watched repo, and the token that syncs it. Null is the sign in.
  syncedBy: { owner: string; tokenId: string | null }[];
}

export interface TokenResponse {
  token: TokenDto;
}

// What a pasted token reaches, before it's saved.
export interface CheckTokenResponse {
  kind: TokenKind;
  owners: string[];
  scopes: string[];
  expiresAt: string | null;
  // A name to start from: the org it reaches.
  name: string;
  // A token the user has that reaches the same owners. Offer to replace it.
  sameOwnersAs: string | null;
  // False when it reaches no watched repo. It can still be saved.
  reachesWatched: boolean;
}
