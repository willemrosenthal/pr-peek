import { expect, it } from "vitest";
import { parsePrLink, prUrl } from "./pr-link";

const pr7 = { owner: "acme", repo: "web-app", number: 7 };

it.each([
  "https://github.com/acme/web-app/pull/7",
  "http://www.github.com/acme/web-app/pull/7",
  "github.com/acme/web-app/pull/7",
  "https://github.com/acme/web-app/pull/7/files",
  "https://github.com/acme/web-app/pull/7/commits/abc123",
  "https://github.com/acme/web-app/pull/7#discussion_r1234",
  "https://github.com/acme/web-app/pull/7?w=1",
  "acme/web-app#7",
  "  acme/web-app#7  ",
  "Check this out https://github.com/acme/web-app/pull/7 thanks",
  "Can you look at acme/web-app#7?",
])("reads %s", (text) => {
  expect(parsePrLink(text)).toEqual(pr7);
});

it("keeps dots and underscores in repo names", () => {
  expect(parsePrLink("https://github.com/my-org/site.io_v2/pull/12")).toEqual({
    owner: "my-org",
    repo: "site.io_v2",
    number: 12,
  });
});

it.each([
  "",
  "not a link",
  "https://github.com/acme/web-app",
  "https://github.com/acme/web-app/issues/7",
  "https://gitlab.com/acme/web-app/pull/7",
  "acme/web-app",
  "see https://example.com/acme/web-app#7",
])("finds no PR in %j", (text) => {
  expect(parsePrLink(text)).toBeNull();
});

it("writes every shape of a PR's link the same way", () => {
  expect(prUrl(parsePrLink("acme/web-app#7")!)).toBe(
    "https://github.com/acme/web-app/pull/7",
  );
});
