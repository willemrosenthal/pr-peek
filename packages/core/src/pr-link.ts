// A PR on GitHub, as a link names it.
export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

// GitHub owner and repo names: letters, numbers, "-", and for repos "." and "_".
const OWNER = "([a-z\\d](?:[a-z\\d-]*[a-z\\d])?)";
const REPO = "([\\w.-]+)";

// A PR's page, with anything after it: `/files`, `#discussion_r…`, or a query.
const URL_LINK = new RegExp(
  `(?:https?://)?(?:www\\.)?github\\.com/${OWNER}/${REPO}/pull/(\\d+)`,
  "i",
);
// The short form, `owner/repo#123`, on its own or between spaces.
const SHORT_LINK = new RegExp(
  `(?:^|\\s)${OWNER}/${REPO}#(\\d+)(?=$|[\\s.,;:!?)])`,
  "i",
);

// The first PR link in `text`, like an Android share with words around it. Null if
// there's none.
export function parsePrLink(text: string): PrRef | null {
  const match = URL_LINK.exec(text) ?? SHORT_LINK.exec(text);
  if (!match) return null;
  const [, owner, repo, number] = match;
  return { owner: owner!, repo: repo!, number: Number(number) };
}

// The PR's page on GitHub, in one shape whatever link named it.
export const prUrl = ({ owner, repo, number }: PrRef) =>
  `https://github.com/${owner}/${repo}/pull/${number}`;
