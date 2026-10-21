import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export type Db = PrismaClient;

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

export async function checkDb(db: Db): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
