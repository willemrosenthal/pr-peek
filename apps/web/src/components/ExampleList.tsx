import type { ItemDto, ItemKind, StaleLevel } from "@pr-peek/core";
import { ItemRow } from "./ItemRow";
import styles from "./ExampleList.module.css";

interface Example {
  kind: ItemKind;
  title: string;
  repo: string;
  summary: string;
  age: string;
  staleLevel?: StaleLevel;
}

// A full row from the few fields that show. The first one is new, so it has a dot.
const toItem = (
  { kind, title, repo, summary, age, staleLevel }: Example,
  i: number,
): ItemDto => ({
  id: `example-${i}`,
  kind,
  summary,
  actorLogin: null,
  actorIsBot: false,
  occurredAt: "",
  waitingSince: null,
  age,
  staleLevel: staleLevel ?? null,
  waitingOnAuthor: false,
  assignedState: null,
  assigned: false,
  severity: "normal",
  unseen: i === 0,
  otherIds: [],
  pr: {
    id: `example-pr-${i}`,
    title,
    owner: "acme",
    repo,
    number: 107 + i * 7,
    url: "#",
    author: "",
    color: null,
    important: false,
  },
});

const EXAMPLES: ItemDto[] = (
  [
    {
      kind: "review_requested",
      title: "Add rate limits to the export API",
      repo: "api-gateway",
      summary: "Review requested",
      age: "4h",
      staleLevel: "warn",
    },
    {
      kind: "re_requested",
      title: "Fix flaky login test on Safari",
      repo: "web-app",
      summary: "Re-review requested",
      age: "45m",
      staleLevel: "fresh",
    },
    {
      kind: "reviewed",
      title: "Move billing to the new ledger",
      repo: "billing",
      summary: "jlee approved",
      age: "1d",
    },
    {
      kind: "check_failed",
      title: "Upgrade to Node 24",
      repo: "web-app",
      summary: "test-server",
      age: "2h",
    },
    {
      kind: "reply",
      title: "Search: rank exact matches first",
      repo: "search",
      summary: 'priya: "Agreed, exact matches first"',
      age: "20m",
    },
  ] satisfies Example[]
).map(toItem);

// The real list's rows, with made-up PRs, to show what Git Buddy looks like before
// signing in. Inert, so its rows aren't links.
export function ExampleList() {
  return (
    <figure className={styles.card} aria-label="An example list">
      <div className={styles.header}>
        <span className={styles.title}>Needs you</span>
        <span className={styles.caption}>Example</span>
      </div>
      <div inert>
        {EXAMPLES.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </div>
    </figure>
  );
}
