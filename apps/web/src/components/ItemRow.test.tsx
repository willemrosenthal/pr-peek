import type { ItemKind, StaleLevel } from "@pr-peek/core";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { item } from "../test/fake-api";
import { ItemRow } from "./ItemRow";

it("links to the PR and shows what happened", () => {
  render(
    <ItemRow
      item={item({
        summary: "jlee re-requested your review",
        pr: {
          title: "Add saved filters",
          owner: "acme",
          repo: "web-app",
          number: 482,
          url: "https://github.com/acme/web-app/pull/482",
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
  expect(screen.getByText("web-app #482")).toBeTruthy();
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
  const icon = screen.getByRole("link").querySelector("svg")?.parentElement;
  expect(icon?.className).toContain(tone);
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
