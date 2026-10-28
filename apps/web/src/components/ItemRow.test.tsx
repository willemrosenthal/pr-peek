import type { AssignedState, ItemKind, StaleLevel } from "@pr-peek/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { idlePr, important, item } from "../test/fake-api";
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
          author: "sam",
          color: null,
          important: false,
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

it("tags and dims a review waiting on the author", () => {
  render(<ItemRow item={item({ waitingOnAuthor: true })} />);
  expect(screen.getByText("Waiting on author")).toBeTruthy();
  const link = screen.getByRole("link");
  expect(link.className).toContain("waiting");
  const svg = link.querySelector("svg");
  expect(svg?.classList).toContain("lucide-message-circle-question-mark");
  expect(svg?.parentElement?.className).toContain("talk");
});

it("has no tag when it's your turn", () => {
  render(<ItemRow item={item()} />);
  expect(screen.queryByText("Waiting on author")).toBe(null);
});

describe("a PR you're assigned to", () => {
  const assigned = (assignedState: AssignedState) =>
    item({ kind: "assigned", assigned: true, assignedState });

  it.each<[AssignedState, string, string, string]>([
    ["draft", "Draft", "lucide-squircle-dashed", "muted"],
    ["conflicts", "Has conflicts", "lucide-triangle-alert", "warning"],
    ["checks_failing", "Checks failing", "lucide-circle-x", "failed"],
    [
      "changes_requested",
      "Changes requested",
      "lucide-message-square-text",
      "comment",
    ],
    ["ready_to_merge", "Ready to merge", "lucide-git-merge", "approved"],
    ["checks_running", "Checks running", "lucide-circle-dashed", "muted"],
    [
      "waiting_on_review",
      "Waiting on review",
      "lucide-circle-user-round",
      "muted",
    ],
  ])("shows %s as %o", (state, label, icon, tone) => {
    render(<ItemRow item={assigned(state)} />);
    const shown = screen.getByText(label);
    expect(shown.className).toContain(tone);
    expect(shown.querySelector("svg")?.classList).toContain(icon);
  });

  it("puts the state before the summary, with no tag", () => {
    render(<ItemRow item={assigned("ready_to_merge")} />);
    expect(screen.getByRole("link").textContent).toMatch(
      /Ready to merge.*jlee asked for your review/,
    );
    expect(screen.queryByText("Assigned")).toBe(null);
  });

  it("tags a row of another kind", () => {
    render(<ItemRow item={item({ assigned: true })} />);
    expect(screen.getByText("Assigned").className).toContain("tag");
  });
});

it("marks unseen items for screen readers too", () => {
  render(<ItemRow item={item({ unseen: true })} />);
  expect(screen.getByRole("link").textContent).toMatch(/^New: /);
});

describe("a PR marked important", () => {
  it("has a flag, after the dot for something new", () => {
    render(<ItemRow item={important(item({ unseen: true }))} />);
    expect(screen.getByRole("link").textContent).toMatch(/^New: Important: /);
  });

  it("has a flag on an idle PR too", () => {
    render(<IdlePrRow pr={important(idlePr())} />);
    expect(screen.getByRole("link").textContent).toMatch(/^Important: /);
  });

  it("keeps its flag when quiet", () => {
    render(<ItemRow item={important(item())} quiet />);
    expect(screen.getByRole("link").textContent).toContain("Important: ");
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
  ["assigned", "assigned"],
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
