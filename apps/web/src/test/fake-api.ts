import type {
  ItemDto,
  ItemsResponse,
  MeResponse,
  SummaryResponse,
  SyncStatusResponse,
} from "@pr-peek/core";
import { vi } from "vitest";

// Requests with no fake. Checked after each test (setup.ts), since the app catches the error.
export const unknownRequests: string[] = [];

// Fakes the API. Keys look like "GET /api/me".
export function fakeApi(handlers: Record<string, () => Response>) {
  const fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${url}`;
    const handler = handlers[key];
    if (!handler) {
      unknownRequests.push(key);
      return Promise.reject(new Error(`No fake for ${key}`));
    }
    return Promise.resolve(handler());
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

// The calls the fake got for `url`.
export const callsTo = (fetch: ReturnType<typeof fakeApi>, url: string) =>
  fetch.mock.calls.filter(([calledUrl]) => calledUrl === url);

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status });

export const apiError = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

export const signedOut = () =>
  apiError(401, "unauthorized", "Sign in required");

let itemCount = 0;

export const item = (fields: Partial<ItemDto> = {}): ItemDto => {
  itemCount += 1;
  return {
    id: `item-${itemCount}`,
    kind: "review_requested",
    summary: "jlee asked for your review",
    actorLogin: "jlee",
    occurredAt: "2026-10-21T10:00:00.000Z",
    waitingSince: "2026-10-21T10:00:00.000Z",
    age: "2h",
    staleLevel: "fresh",
    severity: "normal",
    unseen: false,
    pr: {
      title: `PR ${itemCount}`,
      owner: "acme",
      repo: "web-app",
      number: itemCount,
      url: `https://github.com/acme/web-app/pull/${itemCount}`,
    },
    ...fields,
  };
};

export const groups = (fields: Partial<ItemsResponse> = {}): ItemsResponse => ({
  review: [],
  replies: [],
  mine: [],
  ...fields,
});

export const syncStatus = (
  fields: Partial<SyncStatusResponse> = {},
): SyncStatusResponse => ({
  lastSyncedAt: null,
  syncError: null,
  running: false,
  ...fields,
});

export const summary = (
  fields: Partial<SummaryResponse> = {},
): SummaryResponse => ({
  total: 0,
  review: 0,
  replies: 0,
  mine: 0,
  hasStale: false,
  hasFailing: false,
  ...fields,
});

export const noContent = () => new Response(null, { status: 204 });

// What every signed in page asks for.
export const signedInApi = (
  overrides: Record<string, () => Response> = {},
): Record<string, () => Response> => ({
  "GET /api/me": () => json(me()),
  "GET /api/summary": () => json(summary()),
  ...overrides,
});

// What the list page asks for: a signed in user with nothing to show.
export const listApi = (
  overrides: Record<string, () => Response> = {},
): Record<string, () => Response> => ({
  ...signedInApi(),
  "GET /api/items": () => json(groups()),
  "POST /api/items/seen": noContent,
  "GET /api/sync/status": () => json(syncStatus()),
  "GET /api/repos": () => json({ repos: [{ id: "r1" }] }),
  ...overrides,
});

export const me = (
  fields: Partial<Omit<MeResponse, "user">> = {},
): MeResponse => ({
  user: {
    id: "u1",
    login: "octocat",
    name: "The Octocat",
    avatarUrl: null,
    scopes: ["repo", "read:org"],
  },
  githubToken: null,
  needsReauth: false,
  ...fields,
});
