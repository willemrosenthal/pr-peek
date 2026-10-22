import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, resetDb } from "../../test/db";
import {
  fakeOAuth,
  githubTokens,
  githubUser,
  NOW,
  TEST_KEY,
} from "../../test/fakes";
import { upsertGitHubUser } from "../users";
import { getOctokit } from "./client";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

function fakeGitHub(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(body, { status })),
  );
}

async function setup(github: typeof fetch) {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
    "oauth",
  );
  const octokit = await getOctokit(
    { db, oauth: fakeOAuth(), key: TEST_KEY, now: () => NOW, fetch: github },
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
});
