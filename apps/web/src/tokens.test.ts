import { EXPIRING_DAYS } from "@pr-peek/core";
import { describe, expect, it } from "vitest";
import { githubToken } from "./test/fake-api";
import {
  reachText,
  stateOf,
  tokenProblem,
  tokenSummary,
  tokenTone,
  watchedReposOf,
} from "./tokens";

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
  // Before any repo is watched, there's no count to give.
  expect(reachText({ kind: "fine_grained", owners: ["acme"] }, [])).toBe(
    "acme",
  );
});

describe("a token's row", () => {
  const syncedBy = [{ owner: "acme", repos: 4, tokenId: "t1" }];

  it("sums up its kind, what it covers, and how many watched repos", () => {
    expect(tokenSummary(githubToken({ owners: ["acme"] }), syncedBy)).toBe(
      "Fine-grained · covers acme · 4 repos",
    );
    // No count before it reaches a watched repo.
    expect(tokenSummary(githubToken({ owners: ["globex"] }), syncedBy)).toBe(
      "Fine-grained · covers globex",
    );
    expect(
      tokenSummary(githubToken({ kind: "classic", owners: [] }), syncedBy),
    ).toBe("Classic · every repo you can see");
  });

  it("says nothing while it works, and what's wrong once it doesn't", () => {
    const working = githubToken({ expiresAt: inDays(EXPIRING_DAYS + 1) });
    expect(tokenProblem(working, NOW)).toBe(null);
    expect(tokenTone(working, NOW)).toBe(undefined);

    const soon = githubToken({ expiresAt: inDays(EXPIRING_DAYS - 1) });
    expect(tokenProblem(soon, NOW)).toBe(
      `Expires in ${EXPIRING_DAYS - 1} days`,
    );
    expect(tokenTone(soon, NOW)).toBe("warning");

    const expired = githubToken({ expiresAt: inDays(-1) });
    expect(tokenProblem(expired, NOW)).toBe("Expired");

    const stopped = githubToken({ status: "stopped" });
    expect(tokenProblem(stopped, NOW)).toBe("Stopped working");
    expect(tokenTone(stopped, NOW)).toBe("danger");
  });
});
