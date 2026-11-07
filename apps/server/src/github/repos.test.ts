import { describe, expect, it } from "vitest";
import { reposGitHub } from "../../test/github";
import { listTokenOwners } from "./repos";

describe("listTokenOwners", () => {
  it("lists each owner of the token's private repos once", async () => {
    const { octokit, fetch } = reposGitHub([["acme", "Globex"], ["acme"]]);
    expect(await listTokenOwners(octokit)).toEqual(["Globex", "acme"]);
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.searchParams.get("visibility")).toBe("private");
  });

  it("stops after 10 pages", async () => {
    const pages = Array.from({ length: 12 }, (_, i) => [`owner${i}`]);
    const { octokit, fetch } = reposGitHub(pages);
    expect(await listTokenOwners(octokit)).toHaveLength(10);
    expect(fetch).toHaveBeenCalledTimes(10);
  });
});
