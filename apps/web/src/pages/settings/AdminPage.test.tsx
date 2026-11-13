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
  noContent,
  signedInApi,
  signUpRequest,
  type Handlers,
} from "../../test/fake-api";
import { renderApp } from "../../test/render";

function adminApi(overrides: Handlers = {}) {
  return fakeApi(
    signedInApi({
      "GET /api/me": () => json(me({ isAdmin: true })),
      "GET /api/admin/overview": () => json(adminOverview()),
      "GET /api/admin/requests": () => json({ requests: [] }),
      ...overrides,
    }),
  );
}

describe("the Admin page", () => {
  it.each([
    [true, "shows"],
    [false, "hides"],
  ])("isAdmin %s %s it in Settings", async (isAdmin) => {
    fakeApi(
      signedInApi({
        "GET /api/me": () => json(me({ isAdmin })),
        "GET /api/admin/requests": () => json({ requests: [] }),
      }),
    );
    renderApp("/settings");

    await screen.findByRole("link", { name: /^Rules/ });
    expect(screen.queryByRole("link", { name: /^Admin/ }) !== null).toBe(
      isAdmin,
    );
  });

  it("counts sign-ups waiting on the home screen", async () => {
    adminApi({
      "GET /api/admin/requests": () =>
        json({ requests: [signUpRequest(), signUpRequest({ id: "r2" })] }),
    });
    renderApp("/settings");
    expect(
      await screen.findByRole("link", { name: "Admin, 2 waiting to sign up" }),
    ).toBeTruthy();
  });

  it("shows each section, asking the server once", async () => {
    const fetch = adminApi();
    renderApp("/settings/admin?tab=stats");

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
    // Each count is in the description next to its label.
    const people = screen.getByRole("region", { name: "People and pushes" });
    const countOf = (label: string) =>
      within(people).getByText(label).nextElementSibling?.textContent;
    expect(countOf("Tokens working")).toBe("2");
    expect(countOf("Expiring within 7 days")).toBe("1");
    expect(countOf("Tokens stopped")).toBe("0");
    expect(callsTo(fetch, "/api/admin/overview")).toHaveLength(1);
  });

  it("says so when the query stats can't be read", async () => {
    adminApi({
      "GET /api/admin/overview": () => json(adminOverview({ queries: null })),
    });
    renderApp("/settings/admin?tab=stats");

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
        "GET /api/admin/requests": () =>
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
    [
      false,
      "None of your devices took it. Turn on notifications in Settings, Notifications.",
    ],
  ])("sends a test alert, sent: %s", async (sent, message) => {
    adminApi({ "POST /api/admin/test-alert": () => json({ sent }) });
    renderApp("/settings/admin?tab=tests");

    await userEvent.click(
      await screen.findByRole("button", { name: "Send a test alert" }),
    );
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("approves a request, then shows the list without it", async () => {
    let waiting = [signUpRequest()];
    const fetch = adminApi({
      "GET /api/admin/requests": () => json({ requests: waiting }),
      "POST /api/admin/requests/r1/approve": () => {
        waiting = [];
        return noContent();
      },
    });
    renderApp("/settings/admin");

    const section = await screen.findByRole("region", {
      name: "Sign-up requests",
    });
    expect(within(section).getByText("dana-k")).toBeTruthy();
    expect(within(section).getByText("1 waiting")).toBeTruthy();

    await userEvent.click(
      within(section).getByRole("button", { name: "Approve dana-k" }),
    );
    expect(
      await within(section).findByText("No requests waiting."),
    ).toBeTruthy();
    expect(within(section).getByRole("status").textContent).toBe(
      "Approved dana-k. They can come in now.",
    );
    expect(callsTo(fetch, "/api/admin/requests/r1/approve")).toHaveLength(1);
  });

  it("declines a request", async () => {
    let waiting = [signUpRequest()];
    const fetch = adminApi({
      "GET /api/admin/requests": () => json({ requests: waiting }),
      "DELETE /api/admin/requests/r1": () => {
        waiting = [];
        return noContent();
      },
    });
    renderApp("/settings/admin");

    await userEvent.click(
      await screen.findByRole("button", { name: "Decline dana-k" }),
    );
    expect(await screen.findByText("Declined dana-k.")).toBeTruthy();
    expect(callsTo(fetch, "/api/admin/requests/r1")).toHaveLength(1);
  });

  it("opens on Sign-ups, with the count, and keeps the tab in the URL", async () => {
    adminApi({
      "GET /api/admin/requests": () => json({ requests: [signUpRequest()] }),
    });
    const { router } = renderApp("/settings/admin");

    const tabs = await screen.findByRole("radiogroup", {
      name: "Admin section",
    });
    const signUps = await within(tabs).findByRole<HTMLInputElement>("radio", {
      name: "Sign-ups (1)",
    });
    expect(signUps.checked).toBe(true);
    expect(
      screen.getByRole("region", { name: "Sign-up requests" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send a test alert" })).toBe(
      null,
    );

    await userEvent.click(within(tabs).getByRole("radio", { name: "Tests" }));
    expect(
      await screen.findByRole("button", { name: "Send a test alert" }),
    ).toBeTruthy();
    expect(router.state.location.search).toBe("?tab=tests");
    expect(screen.queryByRole("region", { name: "Sign-up requests" })).toBe(
      null,
    );
  });

  it.each([
    [{ sent: 1, failed: 0 }, "Sent to 1 iPhone. They arrive in a few seconds."],
    [
      { sent: 2, failed: 1 },
      "Sent to 2 iPhones. They arrive in a few seconds. 1 didn't take them.",
    ],
    [{ sent: 0, failed: 1 }, "Apple couldn't deliver them. Try again later."],
  ])("sends each kind to the iPhone apps, %o", async (answer, message) => {
    const fetch = adminApi({
      "POST /api/apple-devices/test": () => json(answer),
    });
    renderApp("/settings/admin?tab=tests");

    await userEvent.click(
      await screen.findByRole("button", { name: "Send to my iPhones" }),
    );
    expect(await screen.findByText(message)).toBeTruthy();
    expect(callsTo(fetch, "/api/apple-devices/test")).toHaveLength(1);
  });

  it("says when no iPhone has notifications on", async () => {
    adminApi({
      "POST /api/apple-devices/test": () =>
        apiError(404, "not_found", "Not found"),
    });
    renderApp("/settings/admin?tab=tests");

    await userEvent.click(
      await screen.findByRole("button", { name: "Send to my iPhones" }),
    );
    expect(
      await screen.findByText(/None of your iPhones has notifications on/),
    ).toBeTruthy();
  });

  it("says so when the requests can't load", async () => {
    adminApi({
      "GET /api/admin/requests": () =>
        apiError(500, "server_error", "Something went wrong"),
    });
    renderApp("/settings/admin");

    expect(await screen.findByText("Something went wrong")).toBeTruthy();
  });
});
