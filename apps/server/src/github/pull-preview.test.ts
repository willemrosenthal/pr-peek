import { describe, expect, it } from "vitest";
import { fakeGraphQL } from "../../test/github";
import { fetchPrPreview } from "./pull-preview";

const user = (login: string) => ({ __typename: "User", login });

const time = (minute: number) =>
  `2026-10-21T12:${String(minute).padStart(2, "0")}:00Z`;

const comment = (id: string, minute: number, body = `<p>${id}</p>`) => ({
  id,
  author: user("jordan"),
  bodyHTML: body,
  createdAt: time(minute),
});

const review = (id: string, state: string, minute: number, body = "") => ({
  id,
  state,
  submittedAt: state === "PENDING" ? null : time(minute),
  bodyHTML: body,
  author: user("jules"),
});

function thread(
  path: string,
  line: number | null,
  originalLine: number | null,
  comments: object[],
) {
  return { path, line, originalLine, comments: { nodes: comments } };
}

function prNode(overrides: object = {}) {
  return {
    bodyHTML: "  <h2>Why</h2><p>Adds login.</p>  ",
    createdAt: "2026-10-19T12:00:00Z",
    comments: { nodes: [] },
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    ...overrides,
  };
}

async function preview(node: object | null, focusId: string | null = null) {
  const fake = fakeGraphQL(() =>
    node
      ? { data: { node } }
      : { data: { node: null }, errors: [{ type: "NOT_FOUND" }] },
  );
  const result = await fetchPrPreview(fake.octokit, "PR_7", focusId);
  return { result, requests: fake.requests };
}

it("asks for the PR by its node id, and trims the description's HTML", async () => {
  const { result, requests } = await preview(prNode());
  expect(requests[0]!.variables).toEqual({ id: "PR_7" });
  expect(result?.bodyHtml).toBe("<h2>Why</h2><p>Adds login.</p>");
  expect(result?.createdAt).toBe("2026-10-19T12:00:00Z");
  expect(result?.comments).toEqual([]);
});

it("is null when the PR is gone from GitHub", async () => {
  expect((await preview(null)).result).toBeNull();
});

describe("the conversation", () => {
  const node = prNode({
    comments: { nodes: [comment("C_1", 1), comment("C_2", 6)] },
    reviews: {
      nodes: [
        review("R_1", "COMMENTED", 2, "<p>Looks close.</p>"),
        review("R_2", "APPROVED", 5),
        // Empty, so it only holds comments on files. Or still a draft.
        review("R_3", "COMMENTED", 3),
        review("R_4", "PENDING", 4, "<p>Draft</p>"),
      ],
    },
    reviewThreads: {
      nodes: [thread("src/badge.ts", 42, 40, [comment("T_1", 3)])],
    },
  });

  it("lists comments, reviews, and comments on files, oldest first", async () => {
    const { result } = await preview(node);
    expect(result?.comments.map((c) => [c.id, c.where, c.reviewState])).toEqual(
      [
        ["C_1", null, null],
        ["R_1", null, "COMMENTED"],
        ["T_1", "src/badge.ts:42", null],
        ["R_2", null, "APPROVED"],
        ["C_2", null, null],
      ],
    );
    expect(result?.comments[0]).toEqual({
      id: "C_1",
      author: { login: "jordan", isBot: false },
      bodyHtml: "<p>C_1</p>",
      createdAt: time(1),
      where: null,
      reviewState: null,
    });
  });

  it("marks the item's comment, when it's there", async () => {
    expect((await preview(node, "T_1")).result?.focusId).toBe("T_1");
    expect((await preview(node, "R_2")).result?.focusId).toBe("R_2");
    // A review request's event, or a mention in the description.
    expect((await preview(node, "RRE_1")).result?.focusId).toBeNull();
  });

  it("falls back to the original line, then the path, once the code changed", async () => {
    const where = async (line: number | null, originalLine: number | null) => {
      const threads = [thread("a.ts", line, originalLine, [comment("T_1", 1)])];
      const { result } = await preview(
        prNode({ reviewThreads: { nodes: threads } }),
      );
      return result?.comments[0]?.where;
    };
    expect(await where(null, 8)).toBe("a.ts:8");
    expect(await where(null, null)).toBe("a.ts");
  });
});
