import type { ItemsResponse, SummaryResponse } from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  APP_URL,
  bodyOf,
  makeTestApp,
  signIn,
  type Agent,
} from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import {
  githubTokens,
  githubUser,
  hours,
  NOW,
  TEST_KEY,
} from "../../test/fakes";
import type { Prisma } from "../generated/prisma/client";
import { upsertGitHubUser } from "../users";
import { itemsRouter } from "./items";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

async function setup() {
  const { agent } = makeTestApp(db, {
    routers: [itemsRouter({ db, now: () => NOW })],
  });
  await signIn(agent);
  const user = await db.user.findFirstOrThrow();
  return { agent, user };
}

async function makePr(userId: string, number = 7) {
  return db.pullRequest.create({
    data: {
      userId,
      githubNodeId: `PR_${number}`,
      githubRepoId: 1,
      repoOwner: "acme",
      repoName: "web-app",
      number,
      title: "Add login",
      url: `https://github.com/acme/web-app/pull/${number}`,
      authorLogin: "sam",
      isDraft: false,
      state: "open",
      headSha: "abc123",
      githubUpdatedAt: NOW,
      snapshot: {},
    },
  });
}

async function makeItem(
  userId: string,
  pullRequestId: string,
  kind: string,
  fields: Partial<
    Pick<
      Prisma.ItemUncheckedCreateInput,
      "occurredAt" | "waitingSince" | "status" | "seenAt"
    >
  > = {},
) {
  return db.item.create({
    data: {
      userId,
      pullRequestId,
      kind,
      dedupeKey: `${kind}:${pullRequestId}`,
      latestEventId: "E_1",
      summary: `${kind} summary`,
      occurredAt: hours(-1),
      ...fields,
    },
  });
}

async function otherUser() {
  const { user } = await upsertGitHubUser(
    db,
    githubUser({ id: 43, login: "other" }),
    githubTokens(),
    TEST_KEY,
    "oauth",
  );
  return user;
}

describe("GET /api/items", () => {
  it("needs sign in", async () => {
    const { agent } = makeTestApp(db, { routers: [itemsRouter({ db })] });
    expect((await agent.get("/api/items")).status).toBe(401);
  });

  it("returns open items in sections, most urgent first", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id);
    const asked = await makeItem(user.id, pr.id, "review_requested", {
      waitingSince: hours(-5),
      occurredAt: hours(-5),
      seenAt: hours(-4),
    });
    const askedAgain = await makeItem(user.id, pr.id, "re_requested", {
      waitingSince: hours(-1),
    });
    const reply = await makeItem(user.id, pr.id, "reply");
    const failed = await makeItem(user.id, pr.id, "check_failed");
    await makeItem(user.id, pr.id, "commented", { status: "resolved" });

    const res = await agent.get("/api/items");

    expect(res.status).toBe(200);
    const body = bodyOf<ItemsResponse>(res);
    // Re-requested and high severity beats an older, normal request.
    expect(body.review.map((item) => item.id)).toEqual([
      askedAgain.id,
      asked.id,
    ]);
    expect(body.replies.map((item) => item.id)).toEqual([reply.id]);
    expect(body.mine.map((item) => item.id)).toEqual([failed.id]);
    expect(body.review[1]).toEqual({
      id: asked.id,
      kind: "review_requested",
      summary: "review_requested summary",
      actorLogin: null,
      occurredAt: hours(-5).toISOString(),
      waitingSince: hours(-5).toISOString(),
      age: "5h",
      staleLevel: "warn",
      severity: "normal",
      unseen: false,
      pr: {
        title: "Add login",
        owner: "acme",
        repo: "web-app",
        number: 7,
        url: "https://github.com/acme/web-app/pull/7",
      },
    });
    expect(body.replies[0]).toMatchObject({
      age: "1h",
      staleLevel: null,
      unseen: true,
    });
  });

  it("uses the user's severity for each rule", async () => {
    const { agent, user } = await setup();
    await db.ruleSetting.update({
      where: { userId_ruleId: { userId: user.id, ruleId: "reply" } },
      data: { severity: "low" },
    });
    await makeItem(user.id, (await makePr(user.id)).id, "reply");

    const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(body.replies[0]?.severity).toBe("low");
  });

  it("leaves out other users' items and unknown kinds", async () => {
    const { agent, user } = await setup();
    const other = await otherUser();
    await makeItem(other.id, (await makePr(other.id)).id, "reply");
    await makeItem(user.id, (await makePr(user.id)).id, "retired_rule");

    const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(body).toEqual({ review: [], replies: [], mine: [] });
  });
});

describe("GET /api/summary", () => {
  it("needs sign in", async () => {
    const { agent } = makeTestApp(db, { routers: [itemsRouter({ db })] });
    expect((await agent.get("/api/summary")).status).toBe(401);
  });

  it("counts open items", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id);
    await makeItem(user.id, pr.id, "review_requested", {
      waitingSince: hours(-1),
    });
    await makeItem(user.id, pr.id, "reply");
    await makeItem(user.id, pr.id, "reviewed");
    await makeItem(user.id, pr.id, "commented", { status: "resolved" });

    const res = await agent.get("/api/summary");
    expect(bodyOf<SummaryResponse>(res)).toEqual({
      total: 3,
      review: 1,
      replies: 1,
      mine: 1,
      hasStale: false,
      hasFailing: false,
    });
  });

  it("flags late requests and failing checks", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id);
    await makeItem(user.id, pr.id, "review_requested", {
      waitingSince: hours(-30),
    });
    await makeItem(user.id, pr.id, "check_failed");

    const res = await agent.get("/api/summary");
    expect(bodyOf<SummaryResponse>(res)).toMatchObject({
      hasStale: true,
      hasFailing: true,
    });
  });
});

describe("POST /api/items/seen", () => {
  const markSeen = (agent: Agent, ids: unknown) =>
    agent.post("/api/items/seen").set("Origin", APP_URL).send({ ids });

  it("marks the user's items as seen", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id);
    const item = await makeItem(user.id, pr.id, "reply");
    const earlier = await makeItem(user.id, pr.id, "reviewed", {
      seenAt: hours(-2),
    });

    const res = await markSeen(agent, [item.id, earlier.id]);

    expect(res.status).toBe(204);
    const seen = await db.item.findMany({ orderBy: { kind: "asc" } });
    expect(seen.map((i) => i.seenAt)).toEqual([NOW, hours(-2)]);
  });

  it("can't touch another user's items", async () => {
    const { agent } = await setup();
    const other = await otherUser();
    const theirs = await makeItem(
      other.id,
      (await makePr(other.id)).id,
      "reply",
    );

    expect((await markSeen(agent, [theirs.id])).status).toBe(204);
    const after = await db.item.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.seenAt).toBeNull();
  });

  it("rejects bad input", async () => {
    const { agent } = await setup();
    const res = await markSeen(agent, []);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "invalid_input" } });
  });

  it("needs sign in", async () => {
    const { agent } = makeTestApp(db, { routers: [itemsRouter({ db })] });
    expect((await markSeen(agent, ["x"])).status).toBe(401);
  });
});
