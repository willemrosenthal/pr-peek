import { describe, expect, it } from "vitest";
import { cleanReports, cleanUrl, cleanUrls } from "./error-reports";

describe("cleanUrl", () => {
  it.each([
    [
      "https://www.git-buddy.com/api/github/repos?owner=acme&q=secret",
      "https://www.git-buddy.com/api/github/repos",
    ],
    ["/api/github/repos?owner=acme", "/api/github/repos"],
    ["/settings#tokens", "/settings"],
    [
      "https://api.github.com/repos/acme/secret-project/pulls/7",
      "https://api.github.com",
    ],
    ["https://github.com/acme/secret-project/pull/7?x=1", "https://github.com"],
    [
      "https://private-user-images.githubusercontent.com/1/a.png?jwt=x",
      "https://private-user-images.githubusercontent.com",
    ],
    ["https://notgithub.com/acme/repo", "https://notgithub.com/acme/repo"],
  ])("cleans %s", (url, clean) => {
    expect(cleanUrl(url)).toBe(clean);
  });
});

it("cleans every URL in a longer text", () => {
  expect(
    cleanUrls(
      "GET https://api.github.com/repos/acme/secret/pulls then GET /api/items?x=1",
    ),
  ).toBe("GET https://api.github.com then GET /api/items");
});

describe("cleanReports", () => {
  it("cleans a breadcrumb's message and data", () => {
    const crumb = cleanReports.beforeBreadcrumb({
      message: "GET https://api.github.com/repos/acme/secret",
      data: {
        url: "https://api.github.com/repos/acme/secret",
        status_code: 200,
      },
    });
    expect(crumb).toEqual({
      message: "GET https://api.github.com",
      data: { url: "https://api.github.com", status_code: 200 },
    });
  });

  it("cleans a span's name and attributes", () => {
    const span = cleanReports.beforeSendSpan({
      name: "GET https://api.github.com/repos/acme/secret",
      attributes: {
        "url.full": "https://api.github.com/repos/acme/secret",
        "http.response.status_code": 200,
      },
    });
    expect(span).toEqual({
      name: "GET https://api.github.com",
      attributes: {
        "url.full": "https://api.github.com",
        "http.response.status_code": 200,
      },
    });
  });

  it("cleans an error report's request, transaction, and error text", () => {
    const event = cleanReports.beforeSend({
      transaction: "GET /api/github/repos?owner=acme",
      request: { url: "https://www.git-buddy.com/api/github/repos?owner=acme" },
      exception: {
        values: [
          { value: "Failed: https://api.github.com/repos/acme/secret" },
          { value: "Caused by: GET https://github.com/acme/secret" },
          {},
        ],
      },
    });
    expect(event).toEqual({
      transaction: "GET /api/github/repos",
      request: { url: "https://www.git-buddy.com/api/github/repos" },
      exception: {
        values: [
          { value: "Failed: https://api.github.com" },
          { value: "Caused by: GET https://github.com" },
          {},
        ],
      },
    });
  });

  it("cleans a message sent on its own", () => {
    expect(
      cleanReports.beforeSend({ message: "Couldn't load /api/items?x=1" }),
    ).toEqual({ message: "Couldn't load /api/items" });
  });
});
