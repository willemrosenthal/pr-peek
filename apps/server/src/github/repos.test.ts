import { describe, expect, it } from "vitest";
import { reposGitHub } from "../../test/github";
import { listTokenOwners, withTokenOwners } from "./repos";

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

describe("withTokenOwners", () => {
  const listed = [
    { login: "octocat", kind: "you" as const },
    { login: "Acme", kind: "org" as const },
    { login: "dana", kind: "shared" as const },
  ];

  it("adds the owners tokens reach as orgs, by name, once each", () => {
    expect(withTokenOwners(listed, ["zeta", "acme", "beta", "zeta"])).toEqual([
      { login: "octocat", kind: "you" },
      { login: "Acme", kind: "org" },
      { login: "beta", kind: "org" },
      { login: "zeta", kind: "org" },
      { login: "dana", kind: "shared" },
    ]);
  });

  it("leaves the list as it is when tokens add nothing new", () => {
    expect(withTokenOwners(listed, ["OCTOCAT", "dana"])).toBe(listed);
  });
});
