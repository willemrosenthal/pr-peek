import type {
  ItemDto,
  PreviewCommentDto,
  PrPreviewResponse,
} from "@pr-peek/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { apiError, fakeApi, important, item, json } from "../test/fake-api";
import { COPIED_MS, HOLD_MS, PrPreview, type PreviewTarget } from "./PrPreview";
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

it("has Quiet, Important, and Open at the top", async () => {
  const { row, onToggleQuiet, onToggleImportant } = setup(() =>
    json(preview()),
  );
  await userEvent.click(screen.getByRole("button", { name: "Quiet" }));
  expect(onToggleQuiet).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Important" }));
  expect(onToggleImportant).toHaveBeenCalledTimes(1);
  const open = screen.getByRole("link", { name: "Open" });
  expect(open.getAttribute("href")).toBe(row.pr.url);
});

it("offers Remove flag for a PR that's marked", () => {
  setup(() => json(preview()), { pr: important(item()).pr });
  expect(screen.getByRole("button", { name: "Remove flag" })).toBeTruthy();
});

it("offers Bring back and Important for a quiet PR", () => {
  setup(() => json(preview()), {}, true);
  expect(screen.getByRole("button", { name: "Bring back" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Important" })).toBeTruthy();
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

describe("Open's menu", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  // user-event puts in its own clipboard, so these tests use fireEvent.
  function stubClipboard() {
    const writeText = vi.fn(() => Promise.resolve());
    const before = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    onTestFinished(() => {
      if (before) Object.defineProperty(navigator, "clipboard", before);
      else Reflect.deleteProperty(navigator, "clipboard");
    });
    return writeText;
  }

  const touch = (x: number) => ({ touches: [{ clientX: x, clientY: 20 }] });

  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  // Whether a click on `link` would open it. The test browser can't open links, so the
  // click is stopped after the check.
  function clickOpens(link: Element) {
    let opens = false;
    const check = (event: Event) => {
      opens = !event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", check, { once: true });
    fireEvent.click(link);
    return opens;
  }

  function setupOpen() {
    const sheet = setup(() => json(preview()));
    return { ...sheet, open: screen.getByRole("link", { name: "Open" }) };
  }

  it("copies the PR's link from a right click, and says so for a moment", async () => {
    const writeText = stubClipboard();
    const { row, onClose, open } = setupOpen();
    expect(fireEvent.contextMenu(open)).toBe(false);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(row.pr.url);
    expect(await screen.findByRole("link", { name: "Copied" })).toBeTruthy();
    // The sheet stays open.
    expect(onClose).not.toHaveBeenCalled();
    // Halfway steps, since this fake clock also moves a little on its own.
    wait(COPIED_MS / 2);
    expect(screen.getByRole("link", { name: "Copied" })).toBeTruthy();
    wait(COPIED_MS / 2);
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
  });

  it("says Copied for the full time again after copying again", async () => {
    stubClipboard();
    const { open } = setupOpen();
    const copy = async () => {
      fireEvent.contextMenu(open);
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Copy link" }),
      );
      await screen.findByRole("link", { name: "Copied" });
    };
    await copy();
    wait(COPIED_MS * 0.75);
    await copy();
    // Past the first copy's time, but not the second's.
    wait(COPIED_MS * 0.75);
    expect(screen.getByRole("link", { name: "Copied" })).toBeTruthy();
    wait(COPIED_MS / 2);
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
  });

  it("opens the link again once the menu closes", async () => {
    const { open } = setupOpen();
    fireEvent.contextMenu(open);
    expect(clickOpens(open)).toBe(false);
    fireEvent.keyDown(await screen.findByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(clickOpens(open)).toBe(true);
  });

  it("opens the menu after a held finger, and not the link", () => {
    const { open } = setupOpen();
    fireEvent.touchStart(open, touch(200));
    wait(HOLD_MS - 1);
    expect(screen.queryByRole("menuitem")).toBeNull();
    wait(1);
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeTruthy();
    fireEvent.touchEnd(open);
    expect(clickOpens(open)).toBe(false);
  });

  it("lets a drag move the sheet instead", () => {
    const { open } = setupOpen();
    fireEvent.touchStart(open, touch(200));
    fireEvent.touchMove(open, touch(230));
    wait(HOLD_MS);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("leaves a tap to open the link", () => {
    const { open } = setupOpen();
    fireEvent.touchStart(open, touch(200));
    fireEvent.touchEnd(open);
    wait(HOLD_MS);
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(clickOpens(open)).toBe(true);
  });
});
