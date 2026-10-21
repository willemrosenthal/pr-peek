import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { TEST_DATABASE_URL } from "./db";

const serverDir = resolve(import.meta.dirname, "..");

// Runs once before all server tests: creates the test database if needed and applies migrations.
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const found = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );
    if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  execFileSync(
    resolve(serverDir, "node_modules/.bin/prisma"),
    ["migrate", "deploy"],
    {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "ignore",
    },
  );
}
