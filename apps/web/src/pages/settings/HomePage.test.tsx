import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  fakeApi,
  githubToken,
  json,
  settingsResponse,
  signedInApi,
  watchedRepo,
} from "../../test/fake-api";
import { renderApp } from "../../test/render";

// A row's name is its label, then its status line.
const row = (label: string, status: string) =>
  screen.findByRole("link", { name: `${label}, ${status}` });

it("shows how each page is set", async () => {
  const settings = settingsResponse({
    staleWarnHours: 24,
    staleLateHours: 48,
    quietStart: "18:00",
    quietEnd: "09:00",
  });
  settings.rules[0]!.enabled = false;
  fakeApi(
    signedInApi({
      "GET /api/settings": () => json(settings),
      "GET /api/repos": () =>
        json({
          repos: [
            watchedRepo(),
            watchedRepo({ muted: true }),
            watchedRepo({ enabled: false }),
          ],
        }),
      "GET /api/github-tokens": () =>
        json({
          tokens: [githubToken({ status: "stopped" })],
          syncedBy: [],
        }),
    }),
  );
  renderApp("/settings");

  const on = settings.rules.filter((rule) => rule.enabled);
  const notify = on.filter((rule) => rule.channels.includes("push")).length;
  expect(
    await row("Repositories", "3 watched · 1 list only · 1 paused"),
  ).toBeTruthy();
  expect(
    await row(
      "Rules",
      `${on.length} of ${settings.rules.length} on · ${notify} notify`,
    ),
  ).toBeTruthy();
  expect(
    await row("Overdue reviews", "Orange after 1 day, red after 2 days"),
  ).toBeTruthy();
  expect(await row("Notifications", "Quiet 6:00 PM to 9:00 AM")).toBeTruthy();
  expect(await row("GitHub tokens", "1 stopped working")).toBeTruthy();
  expect(
    await screen.findByRole("link", { name: /octocat Signed in with GitHub/ }),
  ).toBeTruthy();
});
