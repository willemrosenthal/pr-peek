import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  apiError,
  fakeApi,
  json,
  sentBodies,
  settingsResponse,
  signedInApi,
} from "../../test/fake-api";
import { renderApp } from "../../test/render";

const defaultRule = (id: string) =>
  settingsResponse().rules.find((rule) => rule.id === id)!;

// Answers each rule change with the rule as it was. Tests check what was sent.
const rulesApi = () =>
  fakeApi(
    signedInApi(
      Object.fromEntries(
        settingsResponse().rules.map((rule) => [
          `PATCH /api/rules/${rule.id}`,
          () => json({ rule }),
        ]),
      ),
    ),
  );

const urgency = (rule: string) =>
  screen.findByRole("combobox", { name: `Urgency for ${rule}` });

// Opens a rule's urgency menu and picks one.
async function pickUrgency(rule: string, label: string) {
  await userEvent.click(await urgency(rule));
  await userEvent.click(await screen.findByRole("option", { name: label }));
}

describe("the Rules page", () => {
  it("lists each rule under its group", async () => {
    rulesApi();
    renderApp("/settings/rules");

    const others = await screen.findByRole("list", {
      name: "Other people's PRs",
    });
    expect(within(others).getByText("Review requested")).toBeTruthy();
    expect(within(others).getByText("Mentioned me")).toBeTruthy();
    expect(within(others).getByText("Assigned to me")).toBeTruthy();
    const mine = screen.getByRole("list", { name: "My PRs" });
    expect(within(mine).getByText("Check failed on my PR")).toBeTruthy();
  });

  it("turns a rule off", async () => {
    const fetch = rulesApi();
    renderApp("/settings/rules");

    await userEvent.click(
      await screen.findByRole("switch", { name: "Turn on Mentioned me" }),
    );
    expect(sentBodies(fetch, "PATCH /api/rules/mention")).toEqual([
      { enabled: false },
    ]);
  });

  it("changes a rule's urgency", async () => {
    const fetch = rulesApi();
    renderApp("/settings/rules");

    await pickUrgency("Reply to my comment", "High");
    expect(sentBodies(fetch, "PATCH /api/rules/reply")).toEqual([
      { severity: "high" },
    ]);
  });

  it("turns notifications on and off", async () => {
    const fetch = rulesApi();
    renderApp("/settings/rules");

    // New comments only go on the list by default.
    const notify = await screen.findByRole("switch", {
      name: "Notify for New comment on my PR",
    });
    expect(notify.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(notify);
    expect(sentBodies(fetch, "PATCH /api/rules/commented")).toEqual([
      { channels: ["list", "push"] },
    ]);

    // Review requests notify by default.
    const reviews = screen.getByRole("switch", {
      name: "Notify for Review requested",
    });
    expect(reviews.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(reviews);
    expect(sentBodies(fetch, "PATCH /api/rules/review_requested")).toEqual([
      { channels: ["list"] },
    ]);
  });

  it("includes drafts for review requests", async () => {
    const fetch = rulesApi();
    renderApp("/settings/rules");

    await userEvent.click(await screen.findByLabelText("Include draft PRs"));
    expect(sentBodies(fetch, "PATCH /api/rules/review_requested")).toEqual([
      { options: { includeDrafts: true } },
    ]);
  });

  it("shows the saved value", async () => {
    fakeApi(
      signedInApi({
        "PATCH /api/rules/reply": () =>
          json({ rule: { ...defaultRule("reply"), severity: "high" } }),
      }),
    );
    renderApp("/settings/rules");

    await pickUrgency("Reply to my comment", "High");
    await waitFor(async () =>
      expect((await urgency("Reply to my comment")).textContent).toBe("High"),
    );
  });

  it("shows why a change couldn't be saved", async () => {
    fakeApi(
      signedInApi({
        "PATCH /api/rules/reply": () =>
          apiError(400, "invalid_input", "Bad severity"),
      }),
    );
    renderApp("/settings/rules");

    await pickUrgency("Reply to my comment", "Low");
    expect((await screen.findByRole("alert")).textContent).toBe("Bad severity");
    expect((await urgency("Reply to my comment")).textContent).toBe("Normal");
  });
});
