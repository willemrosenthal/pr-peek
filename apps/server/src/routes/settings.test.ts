import {
  rules,
  type RuleSettingDto,
  type SettingsResponse,
  type UpdateRuleResponse,
  type UpdateSettingsResponse,
} from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_URL,
  bodyOf,
  makeTestApp,
  signIn,
  type Agent,
} from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { NOW } from "../../test/fakes";
import { settingsRouter } from "./settings";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

async function setup(requestSync = vi.fn(() => Promise.resolve(true))) {
  const { agent } = makeTestApp(db, {
    routers: [settingsRouter({ db, requestSync, now: () => NOW })],
  });
  await signIn(agent);
  const user = await db.user.findFirstOrThrow();
  return { agent, user, requestSync };
}

// When a setting last changed what the rules find.
const rulesStaleAt = async () =>
  (await db.user.findFirstOrThrow()).rulesStaleAt;

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
    routers: [settingsRouter({ db, requestSync: vi.fn() })],
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
      keptQuietStart: null,
      keptQuietEnd: null,
      keptDigestTime: null,
      hideBots: false,
      includeTeamRequests: true,
      showAuthors: "off",
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

  it("keeps the last times set while quiet hours and the summary are off", async () => {
    const { agent } = await setup();
    await patchSettings(agent, {
      quietStart: "22:00",
      quietEnd: "07:30",
      digestTime: "08:15",
    });
    const off = await patchSettings(agent, {
      quietStart: null,
      quietEnd: null,
      digestTime: null,
    });

    expect(bodyOf<SettingsResponse>(off).settings).toMatchObject({
      quietStart: null,
      quietEnd: null,
      digestTime: null,
      keptQuietStart: "22:00",
      keptQuietEnd: "07:30",
      keptDigestTime: "08:15",
    });

    // A new time replaces the kept one.
    const changed = await patchSettings(agent, { quietStart: "23:00" });
    expect(bodyOf<SettingsResponse>(changed).settings.keptQuietStart).toBe(
      "23:00",
    );
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
    { showAuthors: true },
    { showAuthors: "some" },
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

  it("has every PR checked again when hiding bots", async () => {
    const { agent, user, requestSync } = await setup();

    const res = await patchSettings(agent, { hideBots: true });
    expect(await rulesStaleAt()).toEqual(NOW);
    expect(requestSync).toHaveBeenCalledExactlyOnceWith(user.id);
    expect(bodyOf<UpdateSettingsResponse>(res).listUpdatingSince).toBe(
      NOW.toISOString(),
    );
  });

  it("doesn't for a setting the rules don't use", async () => {
    const { agent, requestSync } = await setup();

    const res = await patchSettings(agent, { staleWarnHours: 2 });
    expect(await rulesStaleAt()).toBeNull();
    expect(bodyOf<UpdateSettingsResponse>(res).listUpdatingSince).toBeNull();
    expect(requestSync).not.toHaveBeenCalled();
  });
});

it("saves the setting even if the sync can't be queued", async () => {
  const { agent, user } = await setup(
    vi.fn(() => Promise.reject(new Error("database is busy"))),
  );

  const res = await patchSettings(agent, { includeTeamRequests: false });
  expect(res.status).toBe(200);
  const saved = await db.userSettings.findUniqueOrThrow({
    where: { userId: user.id },
  });
  expect(saved.includeTeamRequests).toBe(false);
  // The next scheduled sync still checks every PR.
  expect(await rulesStaleAt()).toEqual(NOW);
});

describe("PATCH /api/rules/:ruleId", () => {
  const ruleOf = (res: { body: unknown }) =>
    (res.body as { rule: RuleSettingDto }).rule;

  it("saves the user's choices", async () => {
    const { agent, requestSync } = await setup();
    const res = await patchRule(agent, "commented", {
      severity: "high",
      channels: ["list", "push"],
    });

    expect(res.status).toBe(200);
    // Severity and channels don't change what the rules find.
    expect(bodyOf<UpdateRuleResponse>(res).listUpdatingSince).toBeNull();
    expect(requestSync).not.toHaveBeenCalled();
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

  it("has every PR checked again when one is turned off", async () => {
    const { agent, user, requestSync } = await setup();

    const res = await patchRule(agent, "review_requested", { enabled: false });
    expect(await rulesStaleAt()).toEqual(NOW);
    expect(requestSync).toHaveBeenCalledExactlyOnceWith(user.id);
    expect(bodyOf<UpdateRuleResponse>(res).listUpdatingSince).toBe(
      NOW.toISOString(),
    );
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
