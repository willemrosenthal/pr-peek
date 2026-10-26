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
import { itemRows } from "../../test/items";
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

const { makePr, makeItem } = itemRows(db);

async function otherUser() {
  const { user } = await upsertGitHubUser(
    db,
    githubUser({ id: 43, login: "other" }),
    githubTokens(),
    TEST_KEY,
  );
  return user;
}

const markSeen = (agent: Agent, ids: unknown) =>
  agent.post("/api/items/seen").set("Origin", APP_URL).send({ ids });
const quiet = (agent: Agent, id: string) =>
  agent.put(`/api/prs/${id}/quiet`).set("Origin", APP_URL);
const unquiet = (agent: Agent, id: string) =>
  agent.delete(`/api/prs/${id}/quiet`).set("Origin", APP_URL);
const markUnread = (agent: Agent, id: string) =>
  agent.put(`/api/prs/${id}/unread`).set("Origin", APP_URL);
const markRead = (agent: Agent, id: string) =>
  agent.delete(`/api/prs/${id}/unread`).set("Origin", APP_URL);

it("needs sign in for every items endpoint", async () => {
  const { agent } = makeTestApp(db, { routers: [itemsRouter({ db })] });
  expect((await agent.get("/api/items")).status).toBe(401);
  expect((await agent.get("/api/summary")).status).toBe(401);
  expect((await markSeen(agent, ["x"])).status).toBe(401);
  expect((await quiet(agent, "x")).status).toBe(401);
  expect((await unquiet(agent, "x")).status).toBe(401);
  expect((await markUnread(agent, "x")).status).toBe(401);
  expect((await markRead(agent, "x")).status).toBe(401);
});

describe("GET /api/items", () => {
  it("returns open items in sections, most urgent first", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id);
    const asked = await makeItem(user.id, pr.id, "review_requested", {
      waitingSince: hours(-5),
      occurredAt: hours(-5),
      seenAt: hours(-4),
    });
    const askedAgain = await makeItem(
      user.id,
      (await makePr(user.id, 8)).id,
      "re_requested",
      { waitingSince: hours(-1) },
    );
    const reply = await makeItem(
      user.id,
      (await makePr(user.id, 9)).id,
      "reply",
    );
    const mine = await makePr(user.id, 10);
    const failed = await makeItem(user.id, mine.id, "check_failed");
    await makeItem(user.id, mine.id, "commented", { status: "resolved" });

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
      actorIsBot: false,
      occurredAt: hours(-5).toISOString(),
      waitingSince: hours(-5).toISOString(),
      age: "5h",
      staleLevel: "warn",
      severity: "normal",
      unseen: false,
      otherIds: [],
      pr: {
        id: pr.id,
        title: "Add login",
        owner: "acme",
        repo: "web-app",
        number: 7,
        url: "https://github.com/acme/web-app/pull/7",
        author: "sam",
        color: null,
        markedUnread: false,
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
    const pr = await makePr(user.id);
    await makeItem(user.id, pr.id, "retired_rule");
    // A name every object has, so a plain `in` check would let it through.
    await makeItem(user.id, pr.id, "constructor");

    const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(body).toEqual({
      review: [],
      replies: [],
      mine: [],
      idlePrs: [],
      quiet: { items: [], idlePrs: [] },
    });
  });

  it("lists the user's open PRs with nothing to do, newest change first", async () => {
    const { agent, user } = await setup();
    const older = await makePr(user.id, 7, {
      authorLogin: "Octocat",
      githubUpdatedAt: hours(-5),
    });
    const draft = await makePr(user.id, 8, {
      authorLogin: "octocat",
      isDraft: true,
    });
    // Left out: has an open item, isn't the user's, or has ended.
    const busy = await makePr(user.id, 9, { authorLogin: "octocat" });
    await makeItem(user.id, busy.id, "check_failed");
    await makePr(user.id, 10);
    await makePr(user.id, 11, { authorLogin: "octocat", state: "merged" });
    const resolved = await makePr(user.id, 12, {
      authorLogin: "octocat",
      githubUpdatedAt: hours(-9),
    });
    await makeItem(user.id, resolved.id, "reviewed", { status: "resolved" });

    const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(body.idlePrs.map((pr) => pr.id)).toEqual([
      draft.id,
      older.id,
      resolved.id,
    ]);
    expect(body.idlePrs[1]).toEqual({
      id: older.id,
      isDraft: false,
      age: "5h",
      pr: {
        id: older.id,
        title: "Add login",
        owner: "acme",
        repo: "web-app",
        number: 7,
        url: "https://github.com/acme/web-app/pull/7",
        author: "Octocat",
        color: null,
        markedUnread: false,
      },
    });
    expect(body.idlePrs[0]?.isDraft).toBe(true);
  });

  it("adds the watched repo's color to each row while it's on", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id, 7, { authorLogin: "octocat" });
    await makeItem(user.id, (await makePr(user.id, 8)).id, "reply");
    const repo = await db.watchedRepo.create({
      data: {
        userId: user.id,
        githubRepoId: pr.githubRepoId,
        owner: "acme",
        name: "web-app",
        color: "#e11d48",
        colorOn: true,
      },
    });

    const on = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(on.replies[0]?.pr.color).toBe("#e11d48");
    expect(on.idlePrs[0]?.pr.color).toBe("#e11d48");

    await db.watchedRepo.update({
      where: { id: repo.id },
      data: { colorOn: false },
    });
    const off = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(off.replies[0]?.pr.color).toBe(null);
  });
});

describe("one row per PR", () => {
  const getItems = async (agent: Agent) =>
    bodyOf<ItemsResponse>(await agent.get("/api/items"));

  it("shows the PR's top item, unseen if any item is, with the others' ids", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id);
    const asked = await makeItem(user.id, pr.id, "review_requested", {
      seenAt: hours(-1),
    });
    // Unseen, so it scores higher, but a review request still leads the row.
    const mention = await makeItem(user.id, pr.id, "mention");

    const body = await getItems(agent);
    expect(body.replies).toEqual([]);
    expect(body.review).toHaveLength(1);
    expect(body.review[0]).toMatchObject({
      id: asked.id,
      kind: "review_requested",
      unseen: true,
      otherIds: [mention.id],
    });
  });

  it("puts the user's higher severity first", async () => {
    const { agent, user } = await setup();
    await db.ruleSetting.update({
      where: { userId_ruleId: { userId: user.id, ruleId: "reply" } },
      data: { severity: "high" },
    });
    const pr = await makePr(user.id);
    await makeItem(user.id, pr.id, "review_requested");
    const reply = await makeItem(user.id, pr.id, "reply");

    const body = await getItems(agent);
    expect(body.review).toEqual([]);
    expect(body.replies.map((row) => row.id)).toEqual([reply.id]);
  });

  it("places each PR by its most urgent item", async () => {
    const { agent, user } = await setup();
    const quiet = await makePr(user.id, 7);
    await makeItem(user.id, quiet.id, "review_requested", {
      seenAt: hours(-1),
    });
    // The same request, plus an unseen mention.
    const busy = await makePr(user.id, 8);
    const busyAsk = await makeItem(user.id, busy.id, "review_requested", {
      seenAt: hours(-1),
    });
    await makeItem(user.id, busy.id, "mention");

    const body = await getItems(agent);
    expect(body.review.map((row) => row.pr.number)).toEqual([8, 7]);
    expect(body.review[0]?.id).toBe(busyAsk.id);
  });
});

describe("quiet PRs", () => {
  it("lists quiet PRs on their own, one row per PR, out of the sections", async () => {
    const { agent, user } = await setup();
    const loud = await makePr(user.id, 7);
    await makeItem(user.id, loud.id, "reply");
    const hushed = await makePr(user.id, 8, { quietAt: hours(-1) });
    const asked = await makeItem(user.id, hushed.id, "review_requested");
    const mention = await makeItem(user.id, hushed.id, "mention");
    const idle = await makePr(user.id, 9, { authorLogin: "octocat" });
    const quietIdle = await makePr(user.id, 10, {
      authorLogin: "octocat",
      quietAt: hours(-1),
    });

    const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(body.review).toEqual([]);
    expect(body.replies.map((row) => row.pr.id)).toEqual([loud.id]);
    expect(body.idlePrs.map((pr) => pr.id)).toEqual([idle.id]);
    expect(body.quiet.items).toHaveLength(1);
    expect(body.quiet.items[0]).toMatchObject({
      id: asked.id,
      otherIds: [mention.id],
    });
    expect(body.quiet.idlePrs.map((pr) => pr.id)).toEqual([quietIdle.id]);
  });

  it("quiets a PR and brings it back", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id);

    expect((await quiet(agent, pr.id)).status).toBe(204);
    const quieted = await db.pullRequest.findUniqueOrThrow({
      where: { id: pr.id },
    });
    expect(quieted.quietAt).toEqual(NOW);

    expect((await unquiet(agent, pr.id)).status).toBe(204);
    const back = await db.pullRequest.findUniqueOrThrow({
      where: { id: pr.id },
    });
    expect(back.quietAt).toBeNull();
  });

  it("can't quiet another user's PR", async () => {
    const { agent } = await setup();
    const other = await otherUser();
    const theirs = await makePr(other.id);

    const res = await quiet(agent, theirs.id);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "not_found" } });
    expect((await unquiet(agent, "missing")).status).toBe(404);
    const after = await db.pullRequest.findUniqueOrThrow({
      where: { id: theirs.id },
    });
    expect(after.quietAt).toBeNull();
  });
});

describe("marking PRs unread", () => {
  it("marks a PR unread on its row, and keeps it through marking items seen", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id);
    const reply = await makeItem(user.id, pr.id, "reply", {
      seenAt: hours(-1),
    });
    const idle = await makePr(user.id, 8, { authorLogin: "octocat" });

    expect((await markUnread(agent, pr.id)).status).toBe(204);
    expect((await markUnread(agent, idle.id)).status).toBe(204);
    expect((await markSeen(agent, [reply.id])).status).toBe(204);

    const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(body.replies[0]).toMatchObject({
      unseen: false,
      pr: { id: pr.id, markedUnread: true },
    });
    expect(body.idlePrs[0]?.pr.markedUnread).toBe(true);
  });

  it("marks a PR read, which also marks its items seen", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id, 7, { unreadAt: hours(-1) });
    const reply = await makeItem(user.id, pr.id, "reply");
    const other = await makePr(user.id, 8, { unreadAt: hours(-1) });
    const otherReply = await makeItem(user.id, other.id, "reply");

    expect((await markRead(agent, pr.id)).status).toBe(204);

    const read = await db.pullRequest.findUniqueOrThrow({
      where: { id: pr.id },
    });
    expect(read.unreadAt).toBeNull();
    const seenAt = async (id: string) =>
      (await db.item.findUniqueOrThrow({ where: { id } })).seenAt;
    expect(await seenAt(reply.id)).toEqual(NOW);
    // Other PRs keep theirs.
    expect(await seenAt(otherReply.id)).toBeNull();
    const kept = await db.pullRequest.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(kept.unreadAt).not.toBeNull();
  });

  it("can't mark another user's PR", async () => {
    const { agent } = await setup();
    const other = await otherUser();
    const theirs = await makePr(other.id);
    await makeItem(other.id, theirs.id, "reply");

    expect((await markUnread(agent, theirs.id)).status).toBe(404);
    expect((await markRead(agent, theirs.id)).status).toBe(404);
    const after = await db.pullRequest.findUniqueOrThrow({
      where: { id: theirs.id },
    });
    expect(after.unreadAt).toBeNull();
    const item = await db.item.findFirstOrThrow();
    expect(item.seenAt).toBeNull();
  });
});

describe("GET /api/summary", () => {
  it("leaves out quiet PRs", async () => {
    const { agent, user } = await setup();
    await makeItem(user.id, (await makePr(user.id, 7)).id, "reply");
    const hushed = await makePr(user.id, 8, { quietAt: hours(-1) });
    await makeItem(user.id, hushed.id, "review_requested", {
      waitingSince: hours(-30),
    });
    await makeItem(user.id, hushed.id, "check_failed");

    const res = await agent.get("/api/summary");
    expect(bodyOf<SummaryResponse>(res)).toEqual({
      total: 1,
      review: 0,
      replies: 1,
      mine: 0,
      hasStale: false,
      hasFailing: false,
    });
  });

  it("counts PRs with open items, like the list", async () => {
    const { agent, user } = await setup();
    const asked = await makePr(user.id, 7);
    await makeItem(user.id, asked.id, "review_requested", {
      waitingSince: hours(-1),
    });
    // Same PR, so one row.
    await makeItem(user.id, asked.id, "mention");
    await makeItem(user.id, (await makePr(user.id, 8)).id, "reply");
    const mine = await makePr(user.id, 9);
    await makeItem(user.id, mine.id, "reviewed");
    await makeItem(user.id, mine.id, "commented", { status: "resolved" });

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

  it("flags late requests and failing checks, even when another item leads the row", async () => {
    const { agent, user } = await setup();
    await db.ruleSetting.update({
      where: { userId_ruleId: { userId: user.id, ruleId: "check_failed" } },
      data: { severity: "low" },
    });
    await makeItem(user.id, (await makePr(user.id, 7)).id, "review_requested", {
      waitingSince: hours(-30),
    });
    const mine = await makePr(user.id, 8);
    await makeItem(user.id, mine.id, "reviewed");
    await makeItem(user.id, mine.id, "check_failed");

    const res = await agent.get("/api/summary");
    expect(bodyOf<SummaryResponse>(res)).toMatchObject({
      hasStale: true,
      hasFailing: true,
    });
  });
});

describe("POST /api/items/seen", () => {
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
});
