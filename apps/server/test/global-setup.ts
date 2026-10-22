import { TEST_DATABASE_URL } from "./db";
import { prepareDatabase } from "./prepare-db";

// Runs once before all server tests.
export default async function setup(): Promise<void> {
  await prepareDatabase(TEST_DATABASE_URL);
}
