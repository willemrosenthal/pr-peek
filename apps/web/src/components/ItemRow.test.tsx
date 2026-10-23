import type { ItemKind, StaleLevel } from "@pr-peek/core";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { idlePr, item } from "../test/fake-api";
import { IdlePrRow, ItemRow } from "./ItemRow";

it("links to the PR and shows what happened", () => {
  render(
    <ItemRow
      item={item({
        summary: "jlee re-requested your review",
        pr: {
          id: "pr-482",
          title: "Add saved filters",
          owner: "acme",
          repo: "web-app",
          number: 482,
          url: "https://github.com/acme/web-app/pull/482",
          color: null,
        },
      })}
    />,
  );
  const link = screen.getByRole("link", { name: /Add saved filters/ });
  expect(link.getAttribute("href")).toBe(
    "https://github.com/acme/web-app/pull/482",
  );
  expect(link.getAttribute("target")).toBe("_blank");
  expect(screen.getByText("jlee re-requested your review")).toBeTruthy();
  expect(link.textContent).toContain("web-app #482");
});

it("colors the repo name with the repo's color", () => {
  const row = item();
  render(<ItemRow item={{ ...row, pr: { ...row.pr, color: "#1e3a8a" } }} />);
  expect(screen.getByText("web-app").style.color).toBe("rgb(30, 58, 138)");
});

it("leaves the repo name plain without a color", () => {
  render(<ItemRow item={item()} />);
  expect(screen.getByText("web-app").getAttribute("style")).toBe(null);
});

it("says how many more open items the PR has", () => {
  render(<ItemRow item={item({ otherIds: ["a", "b"] })} />);
  expect(screen.getByText("+2 more")).toBeTruthy();
});

it("leaves out the count when the PR has one item", () => {
  render(<ItemRow item={item()} />);
  expect(screen.queryByText(/more$/)).toBe(null);
});

it("marks unseen items for screen readers too", () => {
  render(<ItemRow item={item({ unseen: true })} />);
  expect(screen.getByRole("link").textContent).toMatch(/^New: /);
});

it.each<[ItemKind, string]>([
  ["review_requested", "accent"],
  ["re_requested", "accent"],
  ["reply", "reply"],
  ["mention", "reply"],
  ["reviewed", "success"],
  ["commented", "muted"],
  ["check_failed", "danger"],
])("colors the %s icon %s", (kind, tone) => {
  render(<ItemRow item={item({ kind })} />);
  const svg = screen.getByRole("link").querySelector("svg");
  expect(svg?.parentElement?.className).toContain(tone);
  // Screen readers skip it. The row's text says what happened.
  expect(svg?.getAttribute("aria-hidden")).toBe("true");
});

it.each([
  [true, "lucide-bot-message-square"],
  [false, "lucide-message-circle"],
])("shows the bot icon when a bot did it: %s", (actorIsBot, icon) => {
  render(<ItemRow item={item({ kind: "reply", actorIsBot })} />);
  const svg = screen.getByRole("link").querySelector("svg");
  expect(svg?.classList).toContain(icon);
  expect(svg?.parentElement?.className).toContain("reply");
});

it.each([
  [false, "lucide-squircle", "Nothing to do"],
  [true, "lucide-squircle-dashed", "Draft"],
])("shows an idle PR, dimmed if it's a draft: %s", (isDraft, icon, summary) => {
  render(<IdlePrRow pr={idlePr({ isDraft, age: "3d" })} />);
  const link = screen.getByRole("link");
  expect(link.querySelector("svg")?.classList).toContain(icon);
  expect(link.className.includes("draft")).toBe(isDraft);
  expect(screen.getByText(summary)).toBeTruthy();
  expect(screen.getByText("3d")).toBeTruthy();
});

it.each<[StaleLevel | null, string]>([
  ["fresh", "muted"],
  ["warn", "warning"],
  ["late", "danger"],
  [null, "muted"],
])("colors a %s age %s", (staleLevel, tone) => {
  render(<ItemRow item={item({ staleLevel, age: "5h" })} />);
  expect(screen.getByText("5h").className).toContain(tone);
});
