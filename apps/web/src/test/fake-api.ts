import type { MeResponse } from "@pr-peek/core";
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

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status });

export const apiError = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

export const signedOut = () =>
  apiError(401, "unauthorized", "Sign in required");

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
