import { describe, expect, it } from "vitest";
import { githubToken } from "./test/fake-api";
import { reachText, stateOf, watchedReposOf } from "./tokens";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW + days * DAY_MS).toISOString();

describe("stateOf", () => {
  it("offers Replace from 7 days before a token expires", () => {
    expect(stateOf(githubToken({ expiresAt: inDays(8) }), NOW)).toBe("working");
    expect(stateOf(githubToken({ expiresAt: inDays(7) }), NOW)).toBe(
      "expiring",
    );
    expect(stateOf(githubToken({ expiresAt: inDays(-1) }), NOW)).toBe(
      "expiring",
    );
    expect(stateOf(githubToken({ expiresAt: null }), NOW)).toBe("working");
  });

  it("says a stopped token stopped, whatever its expiry", () => {
    const token = githubToken({ status: "stopped", expiresAt: inDays(3) });
    expect(stateOf(token, NOW)).toBe("stopped");
  });
});

it("counts watched repos by owner, ignoring case", () => {
  const syncedBy = [
    { owner: "Acme", repos: 3, tokenId: null },
    { owner: "globex", repos: 2, tokenId: null },
  ];
  expect(watchedReposOf(syncedBy, ["acme"])).toBe(3);
  expect(
    reachText({ kind: "fine_grained", owners: ["acme", "globex"] }, syncedBy),
  ).toBe("acme, globex: 5 repos you watch");
  expect(reachText({ kind: "classic", owners: [] }, syncedBy)).toBe(
    "every repo your account can see",
  );
  expect(reachText({ kind: "fine_grained", owners: [] }, syncedBy)).toBe(
    "no private repos",
  );
});
