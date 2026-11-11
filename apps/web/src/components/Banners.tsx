import {
  daysLeft,
  EXPIRING_DAYS,
  plural,
  type MeResponse,
  type SyncStatusResponse,
  type TokenDto,
} from "@pr-peek/core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "../cx";
import { stateOf } from "../tokens";
import styles from "./Banners.module.css";

interface Banner {
  key: string;
  // "danger" for what stopped working, else a warning.
  danger?: boolean;
  content: ReactNode;
}

export const SYNC_FAILED =
  "Can't sync with GitHub right now, so your list may be out of date. Git Buddy keeps trying.";

// Where tokens are added and replaced.
const TOKENS_PAGE = "/settings/account";

const ReplaceLink = ({ count }: { count: number }) => (
  <Link to={TOKENS_PAGE}>{count === 1 ? "Replace it" : "Replace them"}</Link>
);

// What a token about to expire says, or one that already did.
function expiryText(tokens: TokenDto[]) {
  const [first] = tokens;
  if (tokens.length > 1) {
    return `${tokens.length} tokens expire within ${EXPIRING_DAYS} days.`;
  }
  const days = first?.expiresAt ? daysLeft(first.expiresAt) : 0;
  return days > 0
    ? `Your ${first?.name} token expires in ${plural(days, "day")}.`
    : `Your ${first?.name} token expired.`;
}

// Problems that stop or slow syncs, and tokens that need replacing, with what to do
// about each. One banner each, most pressing first.
function bannersFor(
  me: MeResponse | undefined,
  syncError: SyncStatusResponse["syncError"] | undefined,
): Banner[] {
  const banners: Banner[] = [];
  const tokens = me?.githubTokens ?? [];
  const stopped = tokens.filter((t) => stateOf(t) === "stopped");
  const expiring = tokens.filter((t) => stateOf(t) === "expiring");

  if (me?.needsReauth) {
    banners.push({
      key: "reauth",
      content: (
        <>
          GitHub stopped accepting your sign in.{" "}
          <a href="/api/auth/github">Reconnect GitHub</a>
        </>
      ),
    });
  }
  if (tokens.length > 0 && stopped.length === tokens.length) {
    // Nothing works, so syncs wait for a new token.
    banners.push({
      key: "tokens-stopped",
      danger: true,
      content: (
        <>
          Your token stopped working, so syncs are paused.{" "}
          <Link to={TOKENS_PAGE}>Add a new token</Link>
        </>
      ),
    });
  } else if (stopped.length > 0) {
    banners.push({
      key: "token-stopped",
      danger: true,
      content: (
        <>
          {stopped.length === 1
            ? `Your ${stopped[0]?.name} token stopped working. Its repos`
            : `${stopped.length} tokens stopped working. Their repos`}{" "}
          sync with another token or your GitHub sign in for now.{" "}
          <ReplaceLink count={stopped.length} />
        </>
      ),
    });
  }
  if (expiring.length > 0) {
    banners.push({
      key: "token-expiring",
      content: (
        <>
          {expiryText(expiring)} <ReplaceLink count={expiring.length} />
        </>
      ),
    });
  }
  if (syncError === "failed") {
    // Usually GitHub being down or slow. The header says how old the list is.
    banners.push({ key: "failed", content: SYNC_FAILED });
  }
  return banners;
}

export function Banners({
  me,
  syncError,
}: {
  me: MeResponse | undefined;
  syncError: SyncStatusResponse["syncError"] | undefined;
}) {
  return bannersFor(me, syncError).map(({ key, danger, content }) => (
    <p
      key={key}
      className={cx(styles.banner, danger && styles.danger)}
      role="status"
    >
      {content}
    </p>
  ));
}
