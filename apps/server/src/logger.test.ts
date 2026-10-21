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
});
