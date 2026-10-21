import { PrismaPg } from "@prisma/adapter-pg";
import type { Config } from "./config";
import { PrismaClient } from "./generated/prisma/client";

export type Db = PrismaClient;

export function createDb(
  config: Pick<Config, "DATABASE_URL" | "DB_POOL_MAX">,
): Db {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: config.DATABASE_URL,
      max: config.DB_POOL_MAX,
    }),
  });
}

export async function checkDb(db: Db): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
