// Encrypts every stored GitHub token again with TOKEN_ENC_KEY, after changing it.
// The steps are in docs/security.md, "Change the key".
import { loadConfig } from "../config";
import { createDb, createPool } from "../db";
import { reencryptTokens, tokenKeys } from "../github/tokens";
import { createLogger } from "../logger";

const config = loadConfig();
const logger = createLogger(config);
if (!config.TOKEN_ENC_KEY_PREVIOUS) {
  logger.error("Set TOKEN_ENC_KEY_PREVIOUS to the old key first");
  process.exit(1);
}
const pool = createPool(config);
const db = createDb(pool);

try {
  const users = await reencryptTokens(db, tokenKeys(config));
  logger.info({ users }, "tokens encrypted with the new key");
} finally {
  await db.$disconnect();
  await pool.end();
}
