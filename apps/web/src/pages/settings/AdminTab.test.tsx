import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  adminOverview,
  apiError,
  callsTo,
  fakeApi,
  json,
  me,
  signedInApi,
  type Handlers,
} from "../../test/fake-api";
import { renderApp } from "../../test/render";

function adminApi(overrides: Handlers = {}) {
  return fakeApi(
    signedInApi({
      "GET /api/me": () => json(me({ isAdmin: true })),
      "GET /api/admin/overview": () => json(adminOverview()),
      ...overrides,
    }),
  );
}

const nav = () => screen.findByRole("navigation", { name: "Settings" });

describe("the Admin tab", () => {
  it.each([
    [true, "shows"],
    [false, "hides"],
  ])("isAdmin %s %s it in Settings", async (isAdmin) => {
    fakeApi(signedInApi({ "GET /api/me": () => json(me({ isAdmin })) }));
    renderApp("/settings/general");

    await within(await nav()).findByRole("link", { name: "General" });
    expect(
      within(await nav()).queryByRole("link", { name: "Admin" }) !== null,
    ).toBe(isAdmin);
  });

  it("shows each section, asking the server once", async () => {
    const fetch = adminApi();
    renderApp("/settings/admin");

    expect(await screen.findByText("38 MB")).toBeTruthy();
    for (const section of [
      "Database egress per day",
      "Busiest queries",
      "Worker",
      "GitHub today",
      "People and pushes",
    ]) {
      expect(screen.getByRole("region", { name: section })).toBeTruthy();
    }
    expect(screen.getByText("PullRequest select")).toBeTruthy();
    expect(screen.getByText("sync-user")).toBeTruthy();
    // The worker's 288 requests over 120 syncs. The web service's 12 aren't syncs.
    expect(screen.getByText("2.4")).toBeTruthy();
    // 30,240 calls over the 24 hours since the stats started.
    expect(screen.getByText("1,260")).toBeTruthy();
    expect(screen.queryAllByText("Worth a look")).toEqual([]);
    expect(callsTo(fetch, "/api/admin/overview")).toHaveLength(1);
  });

  it("says so when the query stats can't be read", async () => {
    adminApi({
      "GET /api/admin/overview": () => json(adminOverview({ queries: null })),
    });
    renderApp("/settings/admin");

    expect(
      await screen.findByText(
        /query stats \(pg_stat_statements\) can't be read/,
      ),
    ).toBeTruthy();
  });

  it("tells someone who isn't an admin", async () => {
    fakeApi(
      signedInApi({
        "GET /api/admin/overview": () =>
          apiError(404, "not_found", "Not found"),
      }),
    );
    renderApp("/settings/admin");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Only admins can see this.",
    );
  });

  it.each([
    [true, "Sent. Check your phone."],
    [false, "None of your devices took it. Turn on notifications in Devices."],
  ])("sends a test alert, sent: %s", async (sent, message) => {
    adminApi({ "POST /api/admin/test-alert": () => json({ sent }) });
    renderApp("/settings/admin");

    await userEvent.click(
      await screen.findByRole("button", { name: "Send a test alert" }),
    );
    expect(await screen.findByText(message)).toBeTruthy();
  });
});
