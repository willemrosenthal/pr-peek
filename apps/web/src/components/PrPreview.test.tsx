import type {
  ItemDto,
  PreviewCommentDto,
  PrPreviewResponse,
} from "@pr-peek/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { apiError, fakeApi, important, item, json } from "../test/fake-api";
import { PrPreview, type PreviewTarget } from "./PrPreview";
import styles from "./PrPreview.module.css";

const comment = (
  id: string,
  fields: Partial<PreviewCommentDto> = {},
): PreviewCommentDto => ({
  id,
  author: "jordan",
  bodyHtml: `<p>Comment ${id}</p>`,
  createdAt: "2026-10-21T12:00:00Z",
  age: "1h",
  where: null,
  reviewState: null,
  ...fields,
});

const preview = (
  fields: Partial<PrPreviewResponse> = {},
): PrPreviewResponse => ({
  bodyHtml: "<h2>Why</h2><p>See the screenshots.</p>",
  openedAge: "2d",
  failingChecks: [],
  reviewers: [],
  comments: [],
  focusId: null,
  ...fields,
});

function setup(
  answer: () => Response,
  fields: Partial<ItemDto> = {},
  quiet = false,
) {
  const row = item({
    kind: "reply",
    summary: 'jordan: "Thanks!"',
    age: "5m",
    ...fields,
  });
  fakeApi({ [`GET /api/prs/${row.pr.id}/preview?item=${row.id}`]: answer });
  const onToggleQuiet = vi.fn();
  const onToggleImportant = vi.fn();
  const onClose = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const sheet = (target: PreviewTarget | null) => (
    <QueryClientProvider client={queryClient}>
      <PrPreview
        target={target}
        onToggleQuiet={onToggleQuiet}
        onToggleImportant={onToggleImportant}
        onClose={onClose}
      />
    </QueryClientProvider>
  );
  const target = { pr: row.pr, item: row, quiet };
  const { rerender } = render(sheet(target));
  // Gives the sheet a new target, like the list does. Null closes it.
  const show = (next: PreviewTarget | null) => rerender(sheet(next));
  return { row, target, onToggleQuiet, onToggleImportant, onClose, show };
}

it("shows the PR right away, then its description as formatted text", async () => {
  const { row } = setup(() => json(preview()));
  expect(screen.getByRole("dialog", { name: row.pr.title })).toBeTruthy();
  expect(screen.getByText(/acme \/ web-app/)).toBeTruthy();
  // Why it's on the list, until the comments load.
  expect(screen.getByText('jordan: "Thanks!"')).toBeTruthy();

  expect(await screen.findByRole("heading", { name: "Why" })).toBeTruthy();
  expect(screen.getByText("See the screenshots.")).toBeTruthy();
  expect(screen.getByText("sam · opened 2d ago")).toBeTruthy();
});

it("puts focus on the sheet, not its first button", async () => {
  setup(() => json(preview()));
  const sheet = screen.getByRole("dialog");
  await waitFor(() => expect(document.activeElement).toBe(sheet));
});

it("lists every reviewer with where they stand, and You for the user", async () => {
  setup(() =>
    json(
      preview({
        reviewers: [
          { name: "octocat", isTeam: false, isYou: true, status: "requested" },
          { name: "acme/web", isTeam: true, isYou: false, status: "requested" },
          { name: "jules", isTeam: false, isYou: false, status: "approved" },
          {
            name: "dev",
            isTeam: false,
            isYou: false,
            status: "changes_requested",
          },
          { name: "lee", isTeam: false, isYou: false, status: "commented" },
        ],
      }),
    ),
  );
  expect(await screen.findByText("Reviewers")).toBeTruthy();
  // Each reads as its name, then its status for screen readers.
  expect(
    screen.getAllByRole("listitem").map((item) => item.textContent),
  ).toEqual([
    "You, waiting",
    "acme/web, waiting",
    "jules, approved",
    "dev, requested changes",
    "lee, commented",
  ]);
});

it("leaves out the reviewers line when there are none", async () => {
  setup(() => json(preview()));
  await screen.findByText("See the screenshots.");
  expect(screen.queryByText("Reviewers")).toBeNull();
});

it("lists failing checks", async () => {
  setup(() => json(preview({ failingChecks: ["lint", "e2e"] })));
  expect(await screen.findByText("2 checks failing:")).toBeTruthy();
  expect(screen.getByText(/lint, e2e/)).toBeTruthy();
});

it("shows the reply and the comment before it, with the rest behind a button", async () => {
  const comments = ["C_1", "C_2", "C_3", "C_4"].map((id) => comment(id));
  setup(() => json(preview({ comments, focusId: "C_4" })));

  expect(await screen.findByText("replied to you")).toBeTruthy();
  const more = screen.getByRole("button", { name: "See 2 earlier comments" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  // Hidden ones are there for the animation, but out of reach.
  expect(screen.getByText("Comment C_1").closest("[inert]")).toBeTruthy();
  expect(screen.getByText("Comment C_3").closest("[inert]")).toBeNull();
  // The one before the reply is greyed, the reply isn't.
  const muted = `.${styles.mutedComment}`;
  expect(screen.getByText("Comment C_3").closest(muted)).toBeTruthy();
  expect(screen.getByText("Comment C_4").closest(muted)).toBeNull();
  // The reply is the marked one.
  expect(
    screen.getByText("Comment C_4").closest(`.${styles.focus}`),
  ).toBeTruthy();
  expect(
    screen.getByText("Comment C_3").closest(`.${styles.focus}`),
  ).toBeNull();

  await userEvent.click(more);
  expect(more.getAttribute("aria-expanded")).toBe("true");
  expect(more.textContent).toBe("Hide earlier comments");
  expect(screen.getByText("Comment C_1").closest("[inert]")).toBeNull();
});

it("labels reviews by what they did, and comments by their file", async () => {
  setup(() =>
    json(
      preview({
        comments: [
          comment("T_1", { where: "Email.tsx:18" }),
          comment("R_1", { reviewState: "CHANGES_REQUESTED" }),
        ],
        focusId: "R_1",
      }),
    ),
  );
  expect(await screen.findByText("requested changes")).toBeTruthy();
  expect(screen.getByText("Email.tsx:18")).toBeTruthy();
});

it("shows the conversation after the description for a review request", async () => {
  setup(() => json(preview({ comments: [comment("C_1"), comment("C_2")] })), {
    kind: "review_requested",
    summary: "dev-sam asked you to review",
  });
  expect(await screen.findByRole("heading", { name: "Comments" })).toBeTruthy();
  expect(screen.getByText("dev-sam asked you to review")).toBeTruthy();
  expect(screen.getByText("Comment C_2")).toBeTruthy();
  // None is the item's, so none is greyed.
  expect(document.querySelector(`.${styles.mutedComment}`)).toBeNull();
});

it("has Quiet, Mark important, and Open at the top", async () => {
  const { row, onToggleQuiet, onToggleImportant } = setup(() =>
    json(preview()),
  );
  await userEvent.click(screen.getByRole("button", { name: "Quiet" }));
  expect(onToggleQuiet).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Mark important" }));
  expect(onToggleImportant).toHaveBeenCalledTimes(1);
  const open = screen.getByRole("link", { name: "Open" });
  expect(open.getAttribute("href")).toBe(row.pr.url);
});

it("offers Remove flag for a PR that's marked", () => {
  setup(() => json(preview()), { pr: important(item()).pr });
  expect(screen.getByRole("button", { name: "Remove flag" })).toBeTruthy();
});

it("offers Bring back for a quiet PR, and no Mark important", () => {
  setup(() => json(preview()), {}, true);
  expect(screen.getByRole("button", { name: "Bring back" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mark important" })).toBeNull();
});

describe("dragging the sheet down", () => {
  // Base UI sets this on the sheet while it's dragged.
  const moveTo = (px: number) => {
    const sheet = screen.getByRole("dialog");
    sheet.style.setProperty("--drawer-swipe-movement-y", `${px}px`);
    fireEvent.pointerMove(sheet);
  };
  // A press, a move, and a release. A phone sends each pointer event, then a touch
  // event, except for the moves: Base UI keeps those to itself.
  const drag = (px: number, { phone = false } = {}) => {
    const sheet = screen.getByRole("dialog");
    fireEvent.pointerDown(sheet);
    if (phone) fireEvent.touchStart(sheet);
    moveTo(px);
    fireEvent.pointerUp(sheet);
    if (phone) fireEvent.touchEnd(sheet);
  };

  it.each([false, true])(
    "closes it once it's let go past a short distance (phone: %s)",
    (phone) => {
      const { onClose } = setup(() => json(preview()));
      drag(90, { phone });
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it("leaves it open after a small drag", () => {
    const { onClose } = setup(() => json(preview()));
    drag(40);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("doesn't close on a tap after a drag that never let go", () => {
    const { onClose } = setup(() => json(preview()));
    // The browser cancelled this drag, so no release came.
    fireEvent.pointerDown(screen.getByRole("dialog"));
    moveTo(150);
    // A later tap, with no move.
    fireEvent.pointerDown(screen.getByRole("dialog"));
    fireEvent.pointerUp(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

it("marks the sheet as sliding away until it's opened again", () => {
  const { target, show } = setup(() => json(preview()));
  // Hidden too, in case Base UI hides the sheet from screen readers as it goes.
  const sheet = () => screen.getByRole("dialog", { hidden: true });
  const closing = () => sheet().matches(`.${styles.closing}`);
  expect(closing()).toBe(false);

  // jsdom has no animations, so Base UI would take the sheet away as soon as it
  // closes. A slide that hasn't ended keeps it on screen.
  const slide = {
    finished: new Promise(() => {}),
    effect: { getTiming: () => ({ duration: 300, iterations: 1 }) },
  };
  Element.prototype.getAnimations = () => [slide as unknown as Animation];
  onTestFinished(() => {
    delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
  });

  show(null);
  // On a phone, Base UI ends its drag after the sheet closes. Short of half its
  // height, it takes its own closing mark off. Ours stays.
  sheet().removeAttribute("data-ending-style");
  expect(closing()).toBe(true);

  // Opened again before it's gone, it comes back up.
  show(target);
  expect(closing()).toBe(false);
});

it("offers to try again when the details don't load", async () => {
  let fails = true;
  setup(() =>
    fails ? apiError(502, "github", "GitHub is down") : json(preview()),
  );
  const retry = await screen.findByRole("button", { name: "Try again" });
  fails = false;
  await userEvent.click(retry);
  await waitFor(() =>
    expect(screen.getByText("See the screenshots.")).toBeTruthy(),
  );
});
