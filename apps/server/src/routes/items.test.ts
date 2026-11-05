import type { ItemsResponse, SummaryResponse } from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  const requestSync = vi.fn(() => Promise.resolve(true));
  const { agent } = makeTestApp(db, {
    routers: [itemsRouter({ db, requestSync, now: () => NOW })],
  });
  await signIn(agent);
  const user = await db.user.findFirstOrThrow();
  return { agent, user, requestSync };
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
const markImportant = (agent: Agent, id: string) =>
  agent.put(`/api/prs/${id}/important`).set("Origin", APP_URL);
const unmarkImportant = (agent: Agent, id: string) =>
  agent.delete(`/api/prs/${id}/important`).set("Origin", APP_URL);

it("needs sign in for every items endpoint", async () => {
  const { agent } = makeTestApp(db, {
    routers: [itemsRouter({ db, requestSync: vi.fn() })],
  });
  expect((await agent.get("/api/items")).status).toBe(401);
  expect((await agent.get("/api/summary")).status).toBe(401);
  expect((await markSeen(agent, ["x"])).status).toBe(401);
  expect((await quiet(agent, "x")).status).toBe(401);
  expect((await unquiet(agent, "x")).status).toBe(401);
  expect((await markImportant(agent, "x")).status).toBe(401);
  expect((await unmarkImportant(agent, "x")).status).toBe(401);
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
      waitingOnAuthor: false,
      assignedState: null,
      assigned: false,
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
        important: false,
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
      assigned: [],
      mine: [],
      idlePrs: [],
      merged: [],
      quiet: { items: [], idlePrs: [] },
    });
  });

  describe("assigned PRs", () => {
    it("shows what the PR needs next, as the sync stored it", async () => {
      const { agent, user } = await setup();
      const ready = await makePr(user.id, 7, {
        assignedState: "ready_to_merge",
      });
      const failing = await makePr(user.id, 8, {
        assignedState: "checks_failing",
      });
      // Never filled, or a state that no longer exists.
      const unknown = await makePr(user.id, 9);
      const old = await makePr(user.id, 10, { assignedState: "stuck" });
      for (const pr of [ready, failing, unknown, old]) {
        await makeItem(user.id, pr.id, "assigned");
      }

      const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
      const stateOf = (prId: string) =>
        body.assigned.find((row) => row.pr.id === prId)?.assignedState;
      expect(body.assigned).toHaveLength(4);
      expect(stateOf(ready.id)).toBe("ready_to_merge");
      expect(stateOf(failing.id)).toBe("checks_failing");
      expect(stateOf(unknown.id)).toBe("waiting_on_review");
      expect(stateOf(old.id)).toBe("waiting_on_review");
      expect(body.assigned.every((row) => row.assigned)).toBe(true);
    });

    it("keeps a PR you're asked to review in that section, tagged assigned", async () => {
      const { agent, user } = await setup();
      const pr = await makePr(user.id);
      const asked = await makeItem(user.id, pr.id, "review_requested");
      const assigned = await makeItem(user.id, pr.id, "assigned");
      const other = await makePr(user.id, 8);
      await makeItem(user.id, other.id, "reply");

      const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
      expect(body.assigned).toEqual([]);
      expect(body.review).toEqual([
        expect.objectContaining({
          id: asked.id,
          assigned: true,
          assignedState: null,
          otherIds: [assigned.id],
        }),
      ]);
      expect(body.replies[0]?.assigned).toBe(false);
    });

    it("turns orange after 3 days and red after 7", async () => {
      const { agent, user } = await setup();
      for (const [number, hoursAgo] of [
        [7, 71],
        [8, 72],
        [9, 168],
      ] as const) {
        const pr = await makePr(user.id, number);
        await makeItem(user.id, pr.id, "assigned", {
          waitingSince: hours(-hoursAgo),
        });
      }

      const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
      // Most urgent first.
      expect(body.assigned.map((row) => row.staleLevel)).toEqual([
        "late",
        "warn",
        "fresh",
      ]);
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
      group: "mine",
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
        important: false,
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

describe("waiting on the author", () => {
  it("puts the review last and leaves it out of the counts", async () => {
    const { agent, user } = await setup();
    const waiting = await makeItem(
      user.id,
      (await makePr(user.id, 7)).id,
      "re_requested",
      { waitingOnAuthor: true, seenAt: null },
    );
    const asked = await makeItem(
      user.id,
      (await makePr(user.id, 8)).id,
      "review_requested",
      { waitingSince: hours(-1), seenAt: hours(-1) },
    );

    const items = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(items.review.map((item) => item.id)).toEqual([asked.id, waiting.id]);
    expect(items.review[1]?.waitingOnAuthor).toBe(true);

    const summary = bodyOf<SummaryResponse>(await agent.get("/api/summary"));
    expect(summary).toMatchObject({ total: 1, review: 1 });
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

describe("important PRs", () => {
  it("marks a PR important on its row, separate from seen", async () => {
    const { agent, user } = await setup();
    const pr = await makePr(user.id);
    await makeItem(user.id, pr.id, "reply");
    const idle = await makePr(user.id, 8, { authorLogin: "octocat" });

    expect((await markImportant(agent, pr.id)).status).toBe(204);
    expect((await markImportant(agent, idle.id)).status).toBe(204);

    const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(body.replies[0]).toMatchObject({
      unseen: true,
      pr: { id: pr.id, important: true },
    });
    expect(body.idlePrs[0]?.pr.important).toBe(true);
  });

  it("unmarks a PR, leaving its items unseen", async () => {
    const { agent, user, requestSync } = await setup();
    const pr = await makePr(user.id, 7, { importantAt: hours(-1) });
    const reply = await makeItem(user.id, pr.id, "reply");

    expect((await unmarkImportant(agent, pr.id)).status).toBe(204);

    const after = await db.pullRequest.findUniqueOrThrow({
      where: { id: pr.id },
    });
    expect(after.importantAt).toBeNull();
    const item = await db.item.findUniqueOrThrow({ where: { id: reply.id } });
    expect(item.seenAt).toBeNull();
    // The searches found it, so nothing else changes.
    expect(requestSync).not.toHaveBeenCalled();
  });

  it("stops tracking a PR added by its link, at the next sync", async () => {
    const { agent, user, requestSync } = await setup();
    const pr = await makePr(user.id, 7, {
      importantAt: hours(-1),
      addedAt: hours(-1),
    });

    expect((await unmarkImportant(agent, pr.id)).status).toBe(204);

    const after = await db.pullRequest.findUniqueOrThrow({
      where: { id: pr.id },
    });
    expect(after).toMatchObject({
      importantAt: null,
      addedAt: null,
      lastSeenAt: hours(-24 * 7),
    });
    expect(requestSync).toHaveBeenCalledExactlyOnceWith(user.id);
  });

  it("lists open ones with nothing to do, each in its section", async () => {
    const { agent, user } = await setup();
    const important = { importantAt: hours(-9) };
    const asked = await makePr(user.id, 7, {
      ...important,
      githubUpdatedAt: hours(-1),
      listGroup: "review",
    });
    const assigned = await makePr(user.id, 8, {
      ...important,
      githubUpdatedAt: hours(-2),
      listGroup: "assigned",
    });
    // Left out: has an open item, so it's a row already, or isn't important.
    const busy = await makePr(user.id, 9, important);
    await makeItem(user.id, busy.id, "reply");
    await makePr(user.id, 10);

    const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(body.idlePrs.map(({ id, group }) => ({ id, group }))).toEqual([
      { id: asked.id, group: "review" },
      { id: assigned.id, group: "assigned" },
    ]);
    expect(body.replies.map((row) => row.pr.id)).toEqual([busy.id]);
  });

  it("lists merged ones in watched repos or added, newest first, each in its stored section", async () => {
    const { agent, user } = await setup();
    await db.watchedRepo.createMany({
      data: [
        { userId: user.id, githubRepoId: 1, owner: "acme", name: "web-app" },
        {
          userId: user.id,
          githubRepoId: 2,
          owner: "acme",
          name: "old",
          enabled: false,
        },
      ],
    });
    const merged = { state: "merged" as const, importantAt: hours(-9) };
    // Never filled, so they go by their author.
    const mine = await makePr(user.id, 7, {
      ...merged,
      mergedAt: hours(-3),
      authorLogin: "Octocat",
    });
    const other = await makePr(user.id, 9, { ...merged, mergedAt: hours(-2) });
    const assigned = await makePr(user.id, 8, {
      ...merged,
      mergedAt: hours(-1),
      listGroup: "assigned",
    });
    // Quiet, but a merge is something new.
    const quiet = await makePr(user.id, 12, {
      ...merged,
      quietAt: hours(-5),
      mergedAt: hours(-4),
      listGroup: "review",
    });
    // Added by its link, so it shows in a repo the user doesn't watch.
    const added = await makePr(user.id, 15, {
      ...merged,
      githubRepoId: 3,
      addedAt: hours(-9),
      mergedAt: hours(-5),
      listGroup: "watching",
    });
    // Left out: not important, closed, in a paused repo, or one not watched.
    await makePr(user.id, 10, { state: "merged" });
    await makePr(user.id, 11, { ...merged, state: "closed" });
    await makePr(user.id, 13, { ...merged, githubRepoId: 2 });
    await makePr(user.id, 14, { ...merged, githubRepoId: 3 });

    const body = bodyOf<ItemsResponse>(await agent.get("/api/items"));
    expect(
      body.merged.map(({ id, group, age }) => ({ id, group, age })),
    ).toEqual([
      { id: assigned.id, group: "assigned", age: "1h" },
      { id: other.id, group: "watching", age: "2h" },
      { id: mine.id, group: "mine", age: "3h" },
      { id: quiet.id, group: "review", age: "4h" },
      { id: added.id, group: "watching", age: "5h" },
    ]);
    expect(body.merged[0]?.pr.important).toBe(true);
    expect(body.idlePrs).toEqual([]);
    expect(body.quiet).toEqual({ items: [], idlePrs: [] });
  });

  it("can't mark or unmark another user's PR", async () => {
    const { agent } = await setup();
    const other = await otherUser();
    const theirs = await makePr(other.id, 7, { importantAt: hours(-1) });

    expect((await markImportant(agent, theirs.id)).status).toBe(404);
    expect((await unmarkImportant(agent, theirs.id)).status).toBe(404);
    const after = await db.pullRequest.findUniqueOrThrow({
      where: { id: theirs.id },
    });
    expect(after.importantAt).toEqual(hours(-1));
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
      assigned: 0,
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
    await makeItem(user.id, (await makePr(user.id, 10)).id, "assigned");

    const res = await agent.get("/api/summary");
    expect(bodyOf<SummaryResponse>(res)).toEqual({
      total: 4,
      review: 1,
      replies: 1,
      assigned: 1,
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

  it("doesn't flag a late assigned PR", async () => {
    const { agent, user } = await setup();
    await makeItem(user.id, (await makePr(user.id)).id, "assigned", {
      waitingSince: hours(-200),
    });

    const res = await agent.get("/api/summary");
    expect(bodyOf<SummaryResponse>(res)).toMatchObject({
      assigned: 1,
      hasStale: false,
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
