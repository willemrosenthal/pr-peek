import * as Sentry from "@sentry/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSentry, REPEAT_MS, reportError } from "./sentry";

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

beforeEach(() => {
  vi.spyOn(process, "setSourceMapsEnabled").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("initSentry", () => {
  it("stays off away from Render, like locally and in CI", () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "");
    initSentry("web");
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("starts on Render, tagged with the commit and the service, sending no extra data", () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "abc123");
    initSentry("worker");
    expect(Sentry.init).toHaveBeenCalledOnce();
    const options = vi.mocked(Sentry.init).mock.calls[0]![0]!;
    expect(options).toMatchObject({
      release: "abc123",
      initialScope: { tags: { service: "worker" } },
    });
    expect(options.dataCollection).toMatchObject({
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });
});

describe("reportError", () => {
  it("sends an error with its log message", () => {
    const err = new Error("boom");
    reportError(err, "sync failed");
    expect(Sentry.captureException).toHaveBeenCalledExactlyOnceWith(err, {
      extra: { message: "sync failed" },
    });
  });

  it("sends a message on its own", () => {
    reportError(undefined, "shutdown timed out");
    expect(Sentry.captureMessage).toHaveBeenCalledExactlyOnceWith(
      "shutdown timed out",
      "error",
    );
  });

  it("sends the same error once in REPEAT_MS, like a poll failing again and again", () => {
    const failure = () => new Error("connection refused");
    reportError(failure(), "pg-boss error", 0);
    reportError(failure(), "pg-boss error", REPEAT_MS - 1);
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    reportError(failure(), "pg-boss error", REPEAT_MS);
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it("still sends different errors logged with the same message", () => {
    reportError(new Error("a is undefined"), "request failed", 0);
    reportError(new Error("b is undefined"), "request failed", 0);
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it("sends nothing without an error or a message", () => {
    reportError(undefined, undefined);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
