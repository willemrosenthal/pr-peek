import type { ItemDto, ItemKind, StaleLevel } from "@pr-peek/core";
import { ItemRow } from "./ItemRow";
import styles from "./ExampleList.module.css";

const example = (
  n: number,
  kind: ItemKind,
  title: string,
  repo: string,
  summary: string,
  age: string,
  staleLevel: StaleLevel | null = null,
): ItemDto => ({
  id: `example-${n}`,
  kind,
  summary,
  actorLogin: null,
  actorIsBot: false,
  occurredAt: "",
  waitingSince: null,
  age,
  staleLevel,
  waitingOnAuthor: false,
  assignedState: null,
  assigned: false,
  severity: "normal",
  unseen: n === 1,
  otherIds: [],
  pr: {
    id: `example-pr-${n}`,
    title,
    owner: "acme",
    repo,
    number: 100 + n * 7,
    url: "#",
    author: "",
    color: null,
    important: false,
  },
});

const EXAMPLES = [
  example(
    1,
    "review_requested",
    "Add rate limits to the export API",
    "api-gateway",
    "Review requested",
    "4h",
    "warn",
  ),
  example(
    2,
    "re_requested",
    "Fix flaky login test on Safari",
    "web-app",
    "Re-review requested",
    "45m",
    "fresh",
  ),
  example(
    3,
    "reviewed",
    "Move billing to the new ledger",
    "billing",
    "jlee approved",
    "1d",
  ),
  example(
    4,
    "check_failed",
    "Upgrade to Node 24",
    "web-app",
    "test-server",
    "2h",
  ),
  example(
    5,
    "reply",
    "Search: rank exact matches first",
    "search",
    'priya: "Agreed, exact matches first"',
    "20m",
  ),
];

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
