import * as Sentry from "@sentry/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initSentry, LIVE_HOST, reportReactError } from "./sentry";

const { handleReactError } = vi.hoisted(() => ({ handleReactError: vi.fn() }));
vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: "BrowserTracing" })),
  reactErrorHandler: () => handleReactError,
}));

afterEach(() => vi.clearAllMocks());

describe("initSentry", () => {
  it("stays off away from the live site, like locally and in tests", () => {
    initSentry("localhost");
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("starts on the live site, sending no extra data", () => {
    initSentry(LIVE_HOST);
    expect(Sentry.init).toHaveBeenCalledOnce();
    const options = vi.mocked(Sentry.init).mock.calls[0]![0];
    expect(options).toMatchObject({
      environment: "production",
    });
    expect(options.dataCollection).toMatchObject({
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
  });
});

it("reports React's errors, and still logs them", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const err = new Error("render failed");
  reportReactError(err, { componentStack: "at List" });
  expect(log).toHaveBeenCalledWith(err);
  expect(handleReactError).toHaveBeenCalledExactlyOnceWith(err, {
    componentStack: "at List",
  });
});
