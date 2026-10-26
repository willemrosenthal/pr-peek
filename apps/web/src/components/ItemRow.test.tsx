import type { ItemKind, StaleLevel } from "@pr-peek/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { idlePr, item } from "../test/fake-api";
import { IdlePrRow, ItemRow } from "./ItemRow";
import styles from "./ItemRow.module.css";

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
          author: "sam",
          color: null,
          markedUnread: false,
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

describe("a PR marked unread", () => {
  const marked = () => {
    const row = item();
    return { ...row, pr: { ...row.pr, markedUnread: true } };
  };

  it("shows the dot, and says Unread to screen readers", () => {
    render(<ItemRow item={marked()} />);
    const link = screen.getByRole("link");
    expect(link.className).toContain(styles.unseen);
    expect(link.textContent).toMatch(/^Unread: /);
  });

  it("shows the dot on an idle PR too", () => {
    const idle = idlePr();
    render(
      <IdlePrRow pr={{ ...idle, pr: { ...idle.pr, markedUnread: true } }} />,
    );
    expect(screen.getByRole("link").className).toContain(styles.unseen);
  });

  it("has no dot when quiet", () => {
    render(<ItemRow item={marked()} quiet />);
    expect(screen.getByRole("link").className).not.toContain(styles.unseen);
  });

  it("tells the list when its link opens", () => {
    const onOpen = vi.fn();
    render(<ItemRow item={marked()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("link"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

it.each<[ItemKind, string]>([
  ["review_requested", "review"],
  ["re_requested", "review"],
  ["reply", "talk"],
  ["mention", "talk"],
  ["reviewed", "approved"],
  ["commented", "comment"],
  ["check_failed", "failed"],
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
  expect(svg?.parentElement?.className).toContain("talk");
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

describe("showing the author", () => {
  const avatar = () => screen.getByRole("link").querySelector("img");
  // The row's own icon, in the badge or on its own.
  const icon = () => screen.getByRole("link").querySelector("svg");

  it("shows the author's picture with the kind icon in its badge", () => {
    const row = item({ kind: "check_failed" });
    render(
      <ItemRow
        item={{ ...row, pr: { ...row.pr, author: "jlee[bot]" } }}
        showAuthor
      />,
    );
    expect(avatar()?.getAttribute("src")).toBe(
      "https://avatars.githubusercontent.com/jlee%5Bbot%5D?s=56",
    );
    expect(icon()?.parentElement?.className).toContain("badge");
    expect(icon()?.parentElement?.className).toContain("failed");
  });

  it("shows idle PRs' authors too", () => {
    render(<IdlePrRow pr={idlePr()} showAuthor />);
    expect(avatar()).not.toBe(null);
  });

  it("falls back to the plain icon when the picture can't load", () => {
    render(<ItemRow item={item()} showAuthor />);
    fireEvent.error(avatar()!);
    expect(avatar()).toBe(null);
    expect(icon()?.parentElement?.className).not.toContain("badge");
  });

  it.each([
    ["off", false, false],
    ["on, in a quiet row", true, true],
  ])("leaves it out when the setting is %s", (_, showAuthor, quiet) => {
    render(<ItemRow item={item()} showAuthor={showAuthor} quiet={quiet} />);
    expect(avatar()).toBe(null);
  });
});
