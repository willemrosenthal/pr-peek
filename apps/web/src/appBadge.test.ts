import { afterEach, expect, it, vi } from "vitest";
import { setAppBadge } from "./appBadge";

const native = vi.hoisted(() => ({
  PrPeek: { setBadge: vi.fn(() => Promise.resolve()) },
}));
vi.mock("./native", () => native);

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
  native.PrPeek.setBadge.mockClear();
  const setAppBadgeOnWeb = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { ...navigator, setAppBadge: setAppBadgeOnWeb });
  await setAppBadge(2);
  expect(setAppBadgeOnWeb).toHaveBeenCalledWith(2);
  expect(native.PrPeek.setBadge).not.toHaveBeenCalled();
});
