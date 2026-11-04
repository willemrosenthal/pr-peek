import { LOOKING_HEADER } from "@pr-peek/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
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
      headers: { [LOOKING_HEADER]: "1", "Content-Type": "application/json" },
      body: '{"owner":"acme"}',
    });
  });

  describe("says when someone can see the app", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      document.documentElement.classList.remove("app-hidden");
    });
    const sentHeaders = async () => {
      const fetch = fakeApi({ "GET /api/summary": () => json({}) });
      await api("/summary");
      const init = fetch.mock.calls[0]?.[1] as RequestInit;
      return init.headers as Record<string, string>;
    };

    it("while the page is visible", async () => {
      expect(await sentHeaders()).toEqual({ [LOOKING_HEADER]: "1" });
    });

    it("not from a hidden page, like a refetch in a background tab", async () => {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      expect(await sentHeaders()).toEqual({});
    });

    it("not while the Mac app's window is hidden", async () => {
      document.documentElement.classList.add("app-hidden");
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
      "GET /api/me": () => new Response("Bad gateway", { status: 502 }),
    });
    await expect(api("/me")).rejects.toMatchObject({
      status: 502,
      code: "unknown",
      message: "Something went wrong. Try again.",
    });
  });
});
