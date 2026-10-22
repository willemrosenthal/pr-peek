import type { MeResponse } from "@pr-peek/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { routes } from "../router";

type Handler = (body: unknown) => Response;

// Fakes the API. Keys look like "GET /api/me". Unknown requests fail the test.
export function fakeApi(handlers: Record<string, Handler>) {
  const fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${url}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`No fake for ${key}`);
    const body: unknown =
      typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    return Promise.resolve(handler(body));
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

export const me = (fields: Partial<MeResponse["user"]> = {}): MeResponse => ({
  user: {
    id: "u1",
    login: "octocat",
    name: "The Octocat",
    avatarUrl: null,
    authMethod: "oauth",
    scopes: ["repo", "read:org"],
    ...fields,
  },
  needsReauth: false,
});

// Renders the app's routes at `path`.
export function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}
