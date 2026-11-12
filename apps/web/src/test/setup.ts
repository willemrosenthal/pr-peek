import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { resetPickReposAsked } from "../components/PickReposSheet";
import { resetInstall } from "../install";
import { unknownRequests } from "./fake-api";
import { fakeStream } from "./fake-stream";
import { stubDisplayMode } from "./install";
import { resetVisibility } from "./visibility";

beforeEach(() => {
  fakeStream();
  stubDisplayMode();
});

afterEach(async () => {
  cleanup();
  // Lets work timed for after unmount finish while the fakes are in place.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetInstall();
  resetPickReposAsked();
  localStorage.clear();
  sessionStorage.clear();
  resetVisibility();
  const unknown = unknownRequests.splice(0);
  expect(unknown, "requests with no fake").toEqual([]);
});
