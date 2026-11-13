import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAppBadge } from "./appBadge";
import * as native from "./test/native";

vi.mock("./native", () => import("./test/native"));

beforeEach(() => native.resetNative());

afterEach(() => {
  history.replaceState(null, "", "/");
  sessionStorage.clear();
});

it("sets the iPhone app's own badge inside the app", async () => {
  history.replaceState(null, "", "/?shell=ios");
  await setAppBadge(3);
  expect(native.PrPeek.setBadge).toHaveBeenCalledWith({ count: 3 });
});

it("uses the web's badge elsewhere", async () => {
  const setAppBadgeOnWeb = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { setAppBadge: setAppBadgeOnWeb });
  await setAppBadge(2);
  expect(setAppBadgeOnWeb).toHaveBeenCalledWith(2);
  expect(native.PrPeek.setBadge).not.toHaveBeenCalled();
});
