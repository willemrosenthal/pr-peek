import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, resetDb } from "../test/db";
import { githubTokens, githubUser, TEST_KEY } from "../test/fakes";
import { includeDraftsFrom, loadRuleSettings } from "./items";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

async function makeUser() {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
    "oauth",
  );
  return user;
}

describe("loadRuleSettings", () => {
  it("uses the user's settings", async () => {
    const user = await makeUser();
    await db.ruleSetting.update({
      where: { userId_ruleId: { userId: user.id, ruleId: "commented" } },
      data: {
        enabled: false,
        severity: "high",
        channels: ["list", "push"],
        options: { includeDrafts: true },
      },
    });

    const commented = (await loadRuleSettings(db, user.id)).find(
      (s) => s.rule.id === "commented",
    );
    expect(commented).toMatchObject({
      enabled: false,
      severity: "high",
      channels: ["list", "push"],
      options: { includeDrafts: true },
    });
  });

  it("falls back to each rule's defaults for users without settings", async () => {
    const user = await makeUser();
    await db.ruleSetting.deleteMany();

    const settings = await loadRuleSettings(db, user.id);
    expect(settings).toHaveLength(6);
    expect(settings.find((s) => s.rule.id === "commented")).toMatchObject({
      enabled: true,
      severity: "low",
      channels: ["list"],
      options: {},
    });
    expect(includeDraftsFrom(settings)).toBe(false);
  });

  it("ignores options it doesn't understand", async () => {
    const user = await makeUser();
    await db.ruleSetting.updateMany({
      data: { options: { includeDrafts: "yes" } },
    });
    expect(includeDraftsFrom(await loadRuleSettings(db, user.id))).toBe(false);
  });
});
