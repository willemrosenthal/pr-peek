// Fills the database for the browser smoke test (apps/web/e2e): one signed in user with
// one PR waiting on their review. Run by the test, with DATABASE_URL and E2E_SESSION_ID set.
import { createDb, createPool } from "../src/db";
import { resetDb } from "./db";
import { prepareDatabase } from "./prepare-db";

const DATABASE_URL = process.env.DATABASE_URL;
const sessionId = process.env.E2E_SESSION_ID;
if (!DATABASE_URL || !sessionId) {
  throw new Error("Set DATABASE_URL and E2E_SESSION_ID");
}
// This empties the database, so only ever run it on one made for the smoke test.
if (!new URL(DATABASE_URL).pathname.endsWith("_e2e")) {
  throw new Error("DATABASE_URL must name a database ending in _e2e");
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

await prepareDatabase(DATABASE_URL);
const pool = createPool({ DATABASE_URL, DB_POOL_MAX: 1 });
const db = createDb(pool);

try {
  await resetDb(db);
  const now = Date.now();
  const user = await db.user.create({
    data: {
      githubId: 42,
      login: "octocat",
      approvedAt: new Date(now),
      lastSyncedAt: new Date(now),
      settings: { create: {} },
      watchedRepos: {
        create: { githubRepoId: 1, owner: "acme", name: "web-app" },
      },
    },
  });
  const pr = await db.pullRequest.create({
    data: {
      userId: user.id,
      githubNodeId: "PR_482",
      githubRepoId: 1,
      repoOwner: "acme",
      repoName: "web-app",
      number: 482,
      title: "Add saved filters",
      url: "https://github.com/acme/web-app/pull/482",
      authorLogin: "sam",
      isDraft: false,
      state: "open",
      headSha: "abc123",
      githubUpdatedAt: new Date(now - HOUR_MS),
    },
  });
  await db.item.create({
    data: {
      userId: user.id,
      pullRequestId: pr.id,
      kind: "review_requested",
      dedupeKey: `review_requested:${pr.id}`,
      latestEventId: "E_1",
      summary: "sam requested your review",
      occurredAt: new Date(now - HOUR_MS),
    },
  });
  // The shape express-session stores, so the server reads it as signed in.
  const expires = new Date(now + DAY_MS);
  await db.session.create({
    data: {
      sid: sessionId,
      expire: expires,
      sess: {
        cookie: {
          originalMaxAge: DAY_MS,
          expires: expires.toISOString(),
          httpOnly: true,
          path: "/",
          sameSite: "lax",
        },
        userId: user.id,
      },
    },
  });
} finally {
  await db.$disconnect();
  await pool.end();
}
