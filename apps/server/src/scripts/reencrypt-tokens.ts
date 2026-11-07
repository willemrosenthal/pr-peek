// Encrypts every stored GitHub token again with TOKEN_ENC_KEY, after changing it.
// 1. Set TOKEN_ENC_KEY to the new key, and TOKEN_ENC_KEY_PREVIOUS to the old one.
// 2. Run: pnpm --filter @pr-peek/server tokens:reencrypt
// 3. Remove TOKEN_ENC_KEY_PREVIOUS.
import { loadConfig } from "../config";
import { createDb, createPool } from "../db";
import { reencryptTokens, tokenKeys } from "../github/tokens";
import { createLogger } from "../logger";

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);
const db = createDb(pool);

try {
  const users = await reencryptTokens(db, tokenKeys(config));
  logger.info({ users }, "tokens encrypted with the new key");
} finally {
  await db.$disconnect();
  await pool.end();
}
