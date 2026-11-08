import { LOOKING_HEADER } from "@pr-peek/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  NetworkError,
  RESTARTING,
  UNKNOWN_ERROR,
  UNREACHABLE,
} from "./api";
import { fakeApi, json, signedOut } from "./test/fake-api";

describe("api", () => {
  it("returns the JSON answer", async () => {
    fakeApi({ "GET /api/repos": () => json([{ id: "r1" }]) });
    expect(await api("/repos")).toEqual([{ id: "r1" }]);
  });

  it("sends a JSON body", async () => {
    const fetch = fakeApi({ "POST /api/repos": () => json({ id: "r1" }) });
    await api("/repos", { method: "POST", body: { owner: "acme" } });
    expect(fetch).toHaveBeenCalledWith("/api/repos", {
      method: "POST",
      credentials: "same-origin",
      keepalive: false,
      headers: expect.objectContaining({
        "Content-Type": "application/json",
      }) as unknown,
      body: '{"owner":"acme"}',
    });
  });

  describe("says when someone is using the app", () => {
    afterEach(() => vi.restoreAllMocks());
    const sentHeaders = async () => {
      const fetch = fakeApi({ "GET /api/summary": () => json({}) });
      await api("/summary");
      const init = fetch.mock.calls[0]?.[1] as RequestInit;
      return init.headers as Record<string, string>;
    };

    it("while the app has focus", async () => {
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      expect(await sentHeaders()).toEqual({ [LOOKING_HEADER]: "1" });
    });

    it("not without it, like a background tab or the hidden Mac app", async () => {
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      expect(await sentHeaders()).toEqual({});
    });
  });

  it("returns nothing for an empty answer", async () => {
    fakeApi({
      "POST /api/items/seen": () => new Response(null, { status: 204 }),
    });
    expect(await api("/items/seen", { method: "POST" })).toBeUndefined();
  });

  it("throws the server's error", async () => {
    fakeApi({ "GET /api/me": signedOut });
    const err = await api("/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 401,
      code: "unauthorized",
      message: "Sign in required",
    });
  });

  it("throws a general error when the answer isn't JSON", async () => {
    fakeApi({
      "GET /api/me": () => new Response("Teapot", { status: 418 }),
    });
    await expect(api("/me")).rejects.toMatchObject({
      status: 418,
      code: "unknown",
      message: UNKNOWN_ERROR,
    });
  });

  it.each([502, 503, 504])(
    "says it's restarting for a %i with no JSON, like during a deploy",
    async (status) => {
      fakeApi({
        "GET /api/me": () => new Response("Bad gateway", { status }),
      });
      await expect(api("/me")).rejects.toMatchObject({
        status,
        message: RESTARTING,
      });
    },
  );

  it("says it can't reach Git Buddy when the request gets no answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const err = await api("/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).message).toBe(UNREACHABLE);
  });
});
