import { createDb, createPool, type Db } from "../src/db";

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
  await db.$executeRaw`TRUNCATE "User", "session" CASCADE`;
}
