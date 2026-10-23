import { expect, it, vi } from "vitest";
import { localSetting } from "./localSetting";

const isWord = (value: unknown): value is string => typeof value === "string";

it("falls back until set, then keeps the value as JSON", () => {
  const setting = localSetting("test:word", "fallback", isWord);
  expect(setting.get()).toBe("fallback");
  setting.set("hello");
  expect(localStorage.getItem("test:word")).toBe('"hello"');
  expect(setting.get()).toBe("hello");
});

it("reads values saved as plain text, before settings used JSON", () => {
  localStorage.setItem("test:word", "split");
  expect(localSetting("test:word", "fallback", isWord).get()).toBe("split");
});

it("falls back when the stored value isn't valid", () => {
  localStorage.setItem("test:word", "42");
  expect(localSetting("test:word", "fallback", isWord).get()).toBe("fallback");
});

it("tells subscribers about changes", () => {
  const setting = localSetting("test:word", "fallback", isWord);
  const listener = vi.fn();
  const stop = setting.subscribe(listener);
  setting.set("hello");
  stop();
  setting.set("bye");
  expect(listener).toHaveBeenCalledOnce();
});
