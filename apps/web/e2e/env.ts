// Settings shared by the smoke test and the server it starts. These are test-only values,
// not real secrets.
const PORT = 3100;

export const BASE_URL = `http://localhost:${PORT}`;
export const E2E_FIXTURE_SESSION_SECRET =
  "e2e-fixture-session-secret-not-used-anywhere-real";
export const SESSION_ID = "e2e-session";

export const SERVER_ENV = {
  PORT: String(PORT),
  APP_URL: BASE_URL,
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ??
    "postgresql://prpeek:prpeek@localhost:5433/prpeek_e2e",
  SESSION_SECRET: E2E_FIXTURE_SESSION_SECRET,
  // 32 zero bytes. Nothing is encrypted in the test.
  TOKEN_ENC_KEY: Buffer.alloc(32).toString("base64"),
  GITHUB_CLIENT_ID: "e2e-fixture",
  GITHUB_CLIENT_SECRET: "e2e-fixture",
  LOG_LEVEL: "warn",
  // Not production, so the session cookie works over plain http.
  NODE_ENV: "test",
  E2E_SESSION_ID: SESSION_ID,
};
