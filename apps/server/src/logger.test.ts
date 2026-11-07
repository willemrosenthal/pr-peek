import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

describe("createLogger", () => {
  it("redacts cookies and auth headers", () => {
    let output = "";
    const logger = createLogger(
      { LOG_LEVEL: "info" },
      { write: (line: string) => (output += line) },
    );

    logger.info({
      req: { headers: { cookie: "sid=secret", authorization: "Bearer token" } },
      res: { headers: { "set-cookie": "sid=new-secret" } },
    });

    expect(output).not.toContain("secret");
    expect(output).not.toContain("Bearer token");
    expect(output).toContain("[Redacted]");
  });

  it("redacts tokens in GitHub errors and in fields named for them", () => {
    let output = "";
    const logger = createLogger(
      { LOG_LEVEL: "info" },
      { write: (line: string) => (output += line) },
    );

    logger.error({
      err: {
        message: "Bad credentials",
        request: {
          headers: { authorization: "token ghu_secret1" },
          body: "refresh_token=ghr_secret2&client_secret=secret3",
        },
      },
      tokens: { accessToken: "ghu_secret4", refreshToken: "ghr_secret5" },
      token: "ghp_secret6",
    });

    expect(output).not.toMatch(/secret\d/);
    expect(output).toContain("Bad credentials");
  });
});
