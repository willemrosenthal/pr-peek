import { createDb, createPool, type Db } from "../src/db";
import type { Prisma } from "../src/generated/prisma/client";
import { encryptPersonalToken } from "../src/github/tokens";
import { TEST_KEY } from "./fakes";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://prpeek:prpeek@localhost:5433/prpeek_test";

export function createTestDb(): Db {
  return createDb(
    createPool({ DATABASE_URL: TEST_DATABASE_URL, DB_POOL_MAX: 5 }),
  );
}

// Empties every table. Deleting users cascades to everything that belongs to them.
export async function resetDb(db: Db): Promise<void> {
  await db.$executeRaw`TRUNCATE "User", "session", "AdminAlert", "UsageStat", "AppSettings" CASCADE`;
}

// Adds a personal access token next to the user's others.
export const addToken = (
  db: Db,
  userId: string,
  token: string,
  extra: Partial<Prisma.GitHubTokenUncheckedCreateInput> = {},
) =>
  db.gitHubToken.create({
    data: {
      userId,
      name: token,
      ...encryptPersonalToken({ token, expiresAt: null, scopes: [] }, TEST_KEY),
      ...extra,
    },
  });

// Gives the user a classic personal access token, with the repo scope.
export const addPersonalToken = (
  db: Db,
  userId: string,
  token = "ghp_token",
  expiresAt: Date | null = null,
) => addToken(db, userId, token, { scopes: ["repo"], expiresAt });
