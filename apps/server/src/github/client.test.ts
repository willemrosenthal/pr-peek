import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, resetDb } from "../../test/db";
import {
  fakeOAuth,
  githubTokens,
  githubUser,
  NOW,
  TEST_KEY,
} from "../../test/fakes";
import { savedUsage } from "../../test/usage";
import { Usage } from "../usage";
import { upsertGitHubUser } from "../users";
import { getOctokit, isRateLimited } from "./client";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

function fakeGitHub(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(body, { status, headers })),
  );
}

async function setup(github: typeof fetch, usage?: Usage) {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
  );
  const octokit = await getOctokit(
    {
      db,
      oauth: fakeOAuth(),
      key: TEST_KEY,
      now: () => NOW,
      fetch: github,
      usage,
    },
    user.id,
  );
  const syncError = async () =>
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).syncError;
  return { octokit, syncError };
}

describe("getOctokit", () => {
  it("calls GitHub as the user", async () => {
    const github = fakeGitHub(200, { login: "octocat" });
    const { octokit } = await setup(github);

    const { data } = await octokit.rest.users.getAuthenticated();
    expect(data.login).toBe("octocat");
    const headers = new Headers(github.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("token ghu_access");
  });

  it("marks the user as needing to sign in again on a 401", async () => {
    const { octokit, syncError } = await setup(
      fakeGitHub(401, { message: "Bad credentials" }),
    );

    await expect(octokit.rest.users.getAuthenticated()).rejects.toMatchObject({
      status: 401,
    });
    expect(await syncError()).toBe("reauth");
  });

  describe("when GitHub's rate limit runs out", () => {
    const limited = (resetInSeconds: number) =>
      Response.json(
        { message: "API rate limit exceeded" },
        {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(
              Math.floor(Date.now() / 1000) + resetInSeconds,
            ),
          },
        },
      );

    it("waits and retries once if the reset is soon", async () => {
      const github = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(limited(0))
        .mockResolvedValueOnce(Response.json({ login: "octocat" }));
      const { octokit } = await setup(github);

      const { data } = await octokit.rest.users.getAuthenticated();
      expect(data.login).toBe("octocat");
      expect(github).toHaveBeenCalledTimes(2);
    });

    it("fails right away if the reset is far off", async () => {
      const github = vi.fn<typeof fetch>().mockResolvedValue(limited(60 * 60));
      const { octokit } = await setup(github);

      await expect(octokit.rest.users.getAuthenticated()).rejects.toMatchObject(
        { status: 403 },
      );
      expect(github).toHaveBeenCalledTimes(1);
    });
  });

  it("leaves the user alone on other errors", async () => {
    const { octokit, syncError } = await setup(
      fakeGitHub(404, { message: "Not Found" }),
    );

    await expect(octokit.rest.users.getAuthenticated()).rejects.toMatchObject({
      status: 404,
    });
    expect(await syncError()).toBeNull();
  });

  describe("counting for the admin page", () => {
    const counts = async (usage: Usage) =>
      (await savedUsage(db, usage)).map(({ key, count, low }) => ({
        key,
        count,
        low,
      }));

    it("counts requests and the lowest budget left", async () => {
      const usage = new Usage("worker", () => NOW);
      const remaining = ["4999", "4998"];
      const github = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            { login: "octocat" },
            { headers: { "x-ratelimit-remaining": remaining.shift()! } },
          ),
        ),
      );
      const { octokit } = await setup(github, usage);

      await octokit.rest.users.getAuthenticated();
      await octokit.rest.users.getAuthenticated();
      expect(await counts(usage)).toEqual([
        { key: "budget", count: 2, low: 4998 },
        { key: "requests", count: 2, low: null },
      ]);
    });

    it("counts a 403 with no budget left as rate limited", async () => {
      const usage = new Usage("worker", () => NOW);
      const { octokit } = await setup(
        fakeGitHub(
          403,
          { message: "Slow down" },
          { "x-ratelimit-remaining": "0" },
        ),
        usage,
      );

      await expect(octokit.rest.users.getAuthenticated()).rejects.toThrow();
      expect((await counts(usage)).map(({ key }) => key)).toContain(
        "rate_limited",
      );
    });

    // Octokit's throttling holds a 429 for its whole wait, so this checks the rule alone.
    it.each([
      [429, {}, true],
      [403, { "retry-after": "60" }, true],
      [403, { "x-ratelimit-remaining": "0" }, true],
      [403, { "x-ratelimit-remaining": "12" }, false],
      [404, {}, false],
    ])("treats %i with %o as rate limited: %s", (status, headers, limited) => {
      expect(isRateLimited(status, headers)).toBe(limited);
    });

    it("doesn't count other errors as rate limited", async () => {
      const usage = new Usage("worker", () => NOW);
      const { octokit } = await setup(
        fakeGitHub(404, { message: "Not Found" }),
        usage,
      );

      await expect(octokit.rest.users.getAuthenticated()).rejects.toThrow();
      expect(await counts(usage)).toEqual([
        { key: "requests", count: 1, low: null },
      ]);
    });
  });
});
