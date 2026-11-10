import { describe, expect, it, vi } from "vitest";
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

  describe("reporting errors", () => {
    const setup = () => {
      const report = vi.fn();
      const logger = createLogger(
        { LOG_LEVEL: "info" },
        { write: () => {} },
        report,
      );
      return { report, logger };
    };

    it("reports an error with its message, from children too", () => {
      const { report, logger } = setup();
      const err = new Error("boom");
      logger
        .child({ userId: "u1" })
        .error({ err, userId: "u1" }, "sync failed");
      expect(report).toHaveBeenCalledExactlyOnceWith(err, "sync failed");
    });

    it("reports an error logged with only a message", () => {
      const { report, logger } = setup();
      logger.error("shutdown timed out");
      expect(report).toHaveBeenCalledExactlyOnceWith(
        undefined,
        "shutdown timed out",
      );
    });

    it("doesn't report warnings or below", () => {
      const { report, logger } = setup();
      logger.warn({ err: new Error("slow") }, "sync failed");
      logger.info("heartbeat");
      expect(report).not.toHaveBeenCalled();
    });
  });
});
