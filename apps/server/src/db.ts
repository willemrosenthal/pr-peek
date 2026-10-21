import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import type { Config } from "./config";
import { PrismaClient } from "./generated/prisma/client";

export type Db = PrismaClient;

// One pool shared by Prisma and the session store, to keep connection counts low.
export function createPool(
  config: Pick<Config, "DATABASE_URL" | "DB_POOL_MAX">,
): pg.Pool {
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
  });
}

export function createDb(pool: pg.Pool): Db {
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export async function checkDb(db: Db): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
