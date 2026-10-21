import { describe, expect, it } from "vitest";
import { APP_NAME } from "./index";

describe("core", () => {
  it("exports the app name", () => {
    expect(APP_NAME).toBe("pr-peek");
  });
});
