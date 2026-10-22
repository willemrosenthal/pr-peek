import { describe, expect, it } from "vitest";
import { api, ApiError } from "./api";
import { fakeApi, json, signedOut } from "./test/render";

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
      headers: { "Content-Type": "application/json" },
      body: '{"owner":"acme"}',
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
