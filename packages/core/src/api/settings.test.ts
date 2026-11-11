import { expect, it } from "vitest";
import { keptTimes } from "./settings";

it("keeps each time set, and nothing for a time turned off", () => {
  expect(
    keptTimes({ quietStart: "22:00", quietEnd: null, digestTime: "08:15" }),
  ).toEqual({ keptQuietStart: "22:00", keptDigestTime: "08:15" });
  expect(keptTimes({})).toEqual({});
});
