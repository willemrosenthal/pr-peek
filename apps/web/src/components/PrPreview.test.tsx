import type {
  ItemDto,
  PreviewCommentDto,
  PrPreviewResponse,
} from "@pr-peek/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { apiError, fakeApi, item, json } from "../test/fake-api";
import { PrPreview } from "./PrPreview";
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
  const onClose = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PrPreview
        target={{ pr: row.pr, item: row, quiet }}
        onToggleQuiet={onToggleQuiet}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { row, onToggleQuiet, onClose };
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

it("has Quiet and Open at the top", async () => {
  const { row, onToggleQuiet } = setup(() => json(preview()));
  await userEvent.click(screen.getByRole("button", { name: "Quiet" }));
  expect(onToggleQuiet).toHaveBeenCalledTimes(1);
  const open = screen.getByRole("link", { name: "Open" });
  expect(open.getAttribute("href")).toBe(row.pr.url);
});

it("offers Bring back for a quiet PR", () => {
  setup(() => json(preview()), {}, true);
  expect(screen.getByRole("button", { name: "Bring back" })).toBeTruthy();
});

it("undoes a scroll the user didn't start, so the PR's card stays in view", () => {
  setup(() => json(preview()));
  const scroller = document.querySelector<HTMLElement>(`.${styles.scroll}`)!;
  // jsdom doesn't scroll, so scrollTop is stood in for.
  Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true });
  const scrollTo = (top: number) => {
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
    return scroller.scrollTop;
  };

  expect(scrollTo(200)).toBe(0);
  fireEvent.pointerDown(scroller);
  expect(scrollTo(200)).toBe(200);
});

describe("dragging the sheet down", () => {
  // Base UI sets this on the sheet while it's dragged.
  const drag = (px: number) => {
    const sheet = screen.getByRole("dialog");
    sheet.style.setProperty("--drawer-swipe-movement-y", `${px}px`);
    fireEvent.pointerMove(sheet);
    fireEvent.pointerUp(sheet);
  };

  it("closes it once it's let go past a short distance", () => {
    const { onClose } = setup(() => json(preview()));
    drag(90);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves it open after a small drag", () => {
    const { onClose } = setup(() => json(preview()));
    drag(40);
    expect(onClose).not.toHaveBeenCalled();
  });
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
