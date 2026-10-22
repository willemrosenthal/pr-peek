import {
  rules,
  type RuleSettingDto,
  type SettingsResponse,
} from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  APP_URL,
  bodyOf,
  makeTestApp,
  signIn,
  type Agent,
} from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { NOW } from "../../test/fakes";
import { fakeGraphQL } from "../../test/github";
import { githubPr, prGitHub, searchHit } from "../../test/pulls";
import { syncUser } from "../sync";
import { settingsRouter } from "./settings";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

// GitHub with PR_1 asking octocat to review, plus a bot reply to octocat's comment.
const github = () =>
  Promise.resolve(
    fakeGraphQL(
      prGitHub({
        reviewRequested: [searchHit("PR_1")],
        prs: { PR_1: githubPr() },
      }),
    ).octokit,
  );

async function setup() {
  const { agent } = makeTestApp(db, {
    routers: [settingsRouter({ db, github })],
  });
  await signIn(agent);
  const user = await db.user.findFirstOrThrow();
  return { agent, user };
}

// Syncs the user once, so they have a PR and its items.
async function synced(userId: string) {
  await db.watchedRepo.create({
    data: { userId, githubRepoId: 1, owner: "acme", name: "web-app" },
  });
  await syncUser({ db, github, now: () => NOW }, userId);
}

const patchSettings = (agent: Agent, body: unknown) =>
  agent
    .patch("/api/settings")
    .set("Origin", APP_URL)
    .send(body as object);
const patchRule = (agent: Agent, ruleId: string, body: unknown) =>
  agent
    .patch(`/api/rules/${ruleId}`)
    .set("Origin", APP_URL)
    .send(body as object);

it("needs sign in for every settings endpoint", async () => {
  const { agent } = makeTestApp(db, {
    routers: [settingsRouter({ db, github })],
  });
  expect((await agent.get("/api/settings")).status).toBe(401);
  expect((await patchSettings(agent, { hideBots: true })).status).toBe(401);
  expect((await patchRule(agent, "reply", { enabled: false })).status).toBe(
    401,
  );
});

describe("GET /api/settings", () => {
  it("returns the user's settings and every rule", async () => {
    const { agent } = await setup();
    const res = await agent.get("/api/settings");

    expect(res.status).toBe(200);
    const body = bodyOf<SettingsResponse>(res);
    expect(body.settings).toEqual({
      timezone: "UTC",
      staleWarnHours: 4,
      staleLateHours: 24,
      workHoursOnly: false,
      remindEveryHours: null,
      quietStart: null,
      quietEnd: null,
      quietWeekends: false,
      highBreaksQuiet: false,
      digestTime: null,
      hideBots: false,
      includeTeamRequests: true,
    });
    expect(body.rules).toHaveLength(rules.length);
    expect(body.rules.find((r) => r.id === "commented")).toEqual({
      id: "commented",
      name: "New comment on my PR",
      group: "My PRs",
      defaultSeverity: "low",
      defaultChannels: ["list"],
      enabled: true,
      severity: "low",
      channels: ["list"],
      options: {},
    });
  });
});

describe("PATCH /api/settings", () => {
  it("saves only the fields sent", async () => {
    const { agent } = await setup();
    const res = await patchSettings(agent, {
      timezone: "America/New_York",
      quietStart: "22:00",
      quietEnd: "07:30",
    });

    expect(res.status).toBe(200);
    expect(bodyOf<SettingsResponse>(res).settings).toMatchObject({
      timezone: "America/New_York",
      quietStart: "22:00",
      quietEnd: "07:30",
      staleWarnHours: 4,
    });
    const cleared = await patchSettings(agent, { quietStart: null });
    expect(bodyOf<SettingsResponse>(cleared).settings.quietStart).toBeNull();
  });

  it.each(["UTC", "US/Eastern", "Asia/Tokyo"])(
    "accepts the timezone %s",
    async (timezone) => {
      const { agent } = await setup();
      expect((await patchSettings(agent, { timezone })).status).toBe(200);
    },
  );

  it.each([
    { timezone: "Mars/Olympus" },
    { quietStart: "7:00" },
    { digestTime: "24:00" },
    { staleWarnHours: 0 },
    { staleWarnHours: 1.5 },
    { remindEveryHours: 0 },
    { hideBots: "yes" },
    {},
  ])("rejects %o", async (body) => {
    const { agent } = await setup();
    const res = await patchSettings(agent, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "invalid_input" } });
  });

  it("keeps the orange limit below the red one", async () => {
    const { agent } = await setup();
    // The red limit is 24 hours.
    expect((await patchSettings(agent, { staleWarnHours: 24 })).status).toBe(
      400,
    );
    expect((await patchSettings(agent, { staleLateHours: 3 })).status).toBe(
      400,
    );
    const both = await patchSettings(agent, {
      staleWarnHours: 30,
      staleLateHours: 48,
    });
    expect(both.status).toBe(200);
  });

  it("re-runs the rules when hiding bots", async () => {
    const { agent, user } = await setup();
    await synced(user.id);
    // The fixture's only reply is from a bot.
    const reply = () => db.item.findFirstOrThrow({ where: { kind: "reply" } });
    expect((await reply()).status).toBe("open");

    await patchSettings(agent, { hideBots: true });
    expect((await reply()).status).toBe("resolved");
  });
});

it("saves the setting even if re-running the rules fails", async () => {
  const { agent } = makeTestApp(db, {
    routers: [
      settingsRouter({
        db,
        github: () => Promise.reject(new Error("GitHub is down")),
      }),
    ],
  });
  await signIn(agent);
  const user = await db.user.findFirstOrThrow();
  await synced(user.id);
  await db.userSettings.update({
    where: { userId: user.id },
    data: { includeTeamRequests: false },
  });

  // The fixture asks a team to review, so turning team requests on needs GitHub.
  const res = await patchSettings(agent, { includeTeamRequests: true });
  expect(res.status).toBe(200);
  const saved = await db.userSettings.findUniqueOrThrow({
    where: { userId: user.id },
  });
  expect(saved.includeTeamRequests).toBe(true);
});

describe("PATCH /api/rules/:ruleId", () => {
  const ruleOf = (res: { body: unknown }) =>
    (res.body as { rule: RuleSettingDto }).rule;

  it("saves the user's choices", async () => {
    const { agent } = await setup();
    const res = await patchRule(agent, "commented", {
      severity: "high",
      channels: ["list", "push"],
    });

    expect(res.status).toBe(200);
    expect(ruleOf(res)).toMatchObject({
      id: "commented",
      enabled: true,
      severity: "high",
      channels: ["list", "push"],
    });
  });

  it("keeps options it wasn't sent", async () => {
    const { agent } = await setup();
    await patchRule(agent, "review_requested", {
      options: { includeDrafts: true },
    });
    const res = await patchRule(agent, "review_requested", { severity: "low" });
    expect(ruleOf(res).options).toEqual({ includeDrafts: true });
  });

  it("works for users from before rule settings existed", async () => {
    const { agent } = await setup();
    await db.ruleSetting.deleteMany();

    const res = await patchRule(agent, "reply", { enabled: false });
    expect(ruleOf(res)).toMatchObject({
      enabled: false,
      severity: "normal",
      channels: ["list", "push"],
    });
  });

  it("re-runs the rules when one is turned off", async () => {
    const { agent, user } = await setup();
    await synced(user.id);

    await patchRule(agent, "review_requested", { enabled: false });
    const item = await db.item.findFirstOrThrow({
      where: { kind: "review_requested" },
    });
    expect(item.status).toBe("resolved");
  });

  it("only changes the signed in user's settings", async () => {
    const { agent, user } = await setup();
    const other = await db.user.create({
      data: {
        githubId: 43,
        login: "other",
        ruleSettings: {
          create: { ruleId: "reply", severity: "normal", channels: ["list"] },
        },
      },
    });

    await patchRule(agent, "reply", { enabled: false });
    const theirs = await db.ruleSetting.findUniqueOrThrow({
      where: { userId_ruleId: { userId: other.id, ruleId: "reply" } },
    });
    expect(theirs.enabled).toBe(true);
    const mine = await db.ruleSetting.findUniqueOrThrow({
      where: { userId_ruleId: { userId: user.id, ruleId: "reply" } },
    });
    expect(mine.enabled).toBe(false);
  });

  it("answers 404 for an unknown rule", async () => {
    const { agent } = await setup();
    const res = await patchRule(agent, "nope", { enabled: false });
    expect(res.status).toBe(404);
  });

  it.each([
    {},
    { severity: "urgent" },
    { channels: ["email"] },
    { channels: [] },
    { channels: ["list", "list"] },
  ])("rejects %o", async (body) => {
    const { agent } = await setup();
    expect((await patchRule(agent, "reply", body)).status).toBe(400);
  });
});
