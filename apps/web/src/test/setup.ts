import { cleanup } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";
import { unknownRequests } from "./fake-api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  const unknown = unknownRequests.splice(0);
  expect(unknown, "requests with no fake").toEqual([]);
});
