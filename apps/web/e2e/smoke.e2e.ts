import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASE_URL, E2E_FIXTURE_SESSION_SECRET, SESSION_ID } from "./env";

// The session cookie for the seeded session, signed the way express-session signs it.
function sessionCookie() {
  const signature = createHmac("sha256", E2E_FIXTURE_SESSION_SECRET)
    .update(SESSION_ID)
    .digest("base64")
    .replace(/=+$/, "");
  return {
    name: "sid",
    value: encodeURIComponent(`s:${SESSION_ID}.${signature}`),
    url: BASE_URL,
  };
}

test("a signed in user sees the PR waiting on them and opens it", async ({
  context,
  page,
}) => {
  await context.addCookies([sessionCookie()]);
  // The PR link opens GitHub. Answer it here, so the test never leaves the machine.
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ body: "GitHub" }),
  );

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Needs my review/ }),
  ).toBeVisible();
  await expect(page.getByText("sam requested your review")).toBeVisible();

  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: /Add saved filters/ }).click();
  await expect(await opened).toHaveURL(
    "https://github.com/acme/web-app/pull/482",
  );
});
