import type {
  CheckTokenResponse,
  TokenDto,
  TokenResponse,
  TokensResponse,
} from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { queryKeys } from "../queries";
import { formatDate, plural, watchedReposOf } from "../tokens";
import { Alert } from "./Alert";
import { Button, ButtonLink } from "./Button";
import { Input, TextField } from "./Field";
import styles from "./GitHubTokens.module.css";

const FINE_GRAINED_URL =
  "https://github.com/settings/personal-access-tokens/new";
// The classic page ticks these scopes when it opens.
const CLASSIC_URL =
  "https://github.com/settings/tokens/new?scopes=repo,read:org&description=Git%20Buddy";

const canPaste = () =>
  typeof navigator !== "undefined" && "readText" in (navigator.clipboard ?? {});

// Adds a token in two steps, make one on GitHub then paste and check it, or replaces
// `replacing`. A checked token shows what it reaches, and gets a name, before it's saved.
export function AddToken({
  replacing,
  tokens,
  syncedBy,
  onSaved,
  onCancel,
}: {
  replacing: TokenDto | null;
  tokens: TokenDto[];
  syncedBy: TokensResponse["syncedBy"];
  // With a line saying what changed.
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const panel = useRef<HTMLElement>(null);

  // On a phone the panel takes the place of the list, so bring it into view.
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: "start" });
  }, []);

  const check = useMutation({
    mutationFn: () =>
      api<CheckTokenResponse>("/github-tokens/check", {
        method: "POST",
        body: { token },
      }),
    onSuccess: (checked) => setName(replacing?.name ?? checked.name),
  });
  const save = useMutation({
    // `replaceId`: the token this one replaces, from Replace or "Replace that one?".
    mutationFn: (replaceId: string | null) =>
      api<TokenResponse>(
        replaceId ? `/github-tokens/${replaceId}` : "/github-tokens",
        { method: replaceId ? "PUT" : "POST", body: { token, name } },
      ),
    onSuccess: async ({ token: saved }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.githubTokens }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      ]);
      onSaved(
        `Saved ${saved.name}. Its repos sync with it from the next sync.`,
      );
    },
  });

  const checked = check.data;
  const sameAs = !replacing
    ? tokens.find((t) => t.id === checked?.sameOwnersAs)
    : undefined;
  const startOver = () => {
    check.reset();
    save.reset();
    setToken("");
  };
  const submitToken = (e: FormEvent) => {
    e.preventDefault();
    check.mutate();
  };
  const paste = async () => {
    setToken((await navigator.clipboard.readText()).trim());
  };

  return (
    <section
      ref={panel}
      className={styles.panel}
      aria-labelledby="add-token-heading"
    >
      <h3 id="add-token-heading" className={styles.heading}>
        {replacing ? `Replace ${replacing.name}` : "Add a token"}
      </h3>

      {!checked ? (
        <>
          <div className={styles.step}>
            <strong>1. Make one on GitHub</strong>
            <div className={styles.links}>
              <ButtonLink
                href={FINE_GRAINED_URL}
                target="_blank"
                rel="noreferrer"
              >
                Fine-grained token, for one org
              </ButtonLink>
              <ButtonLink href={CLASSIC_URL} target="_blank" rel="noreferrer">
                Classic token, for everything
              </ButtonLink>
            </div>
            <TokenSteps />
          </div>
          <form className={styles.step} onSubmit={submitToken}>
            <label htmlFor="token-input" className={styles.label}>
              2. Copy it, then paste it here
            </label>
            <div className={styles.pasteRow}>
              <Input
                id="token-input"
                className={styles.tokenInput}
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="github_pat_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              {canPaste() && (
                <Button onClick={() => void paste()}>Paste</Button>
              )}
            </div>
            {check.isError && <Alert>{check.error.message}</Alert>}
            <div className={styles.actions}>
              <Button
                type="submit"
                variant="primary"
                disabled={!token.trim() || check.isPending}
              >
                {check.isPending ? "Checking token" : "Check token"}
              </Button>
              <Button onClick={onCancel}>Cancel</Button>
            </div>
          </form>
        </>
      ) : (
        <form
          className={styles.step}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(replacing?.id ?? null);
          }}
        >
          <div className={styles.accepted} role="status">
            <strong>GitHub accepted it.</strong>
            <span>
              {checked.kind === "classic" ? "Classic" : "Fine-grained"}.{" "}
              {checked.expiresAt
                ? `Expires ${formatDate(checked.expiresAt)}.`
                : "Never expires."}
            </span>
            <span>
              {checked.kind === "classic" ? (
                "It reaches every repo your account can see."
              ) : checked.owners.length > 0 ? (
                <>
                  It reaches <strong>{checked.owners.join(", ")}</strong>:{" "}
                  {plural(watchedReposOf(syncedBy, checked.owners), "repo")} you
                  watch.
                </>
              ) : (
                "It reaches no private repos."
              )}
            </span>
          </div>
          {!checked.reachesWatched && (
            <p className={styles.warning}>
              It doesn't reach any repo you watch yet. Save it anyway, or check
              its resource owner on GitHub.
            </p>
          )}
          <TextField
            label="Name"
            autoComplete="off"
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {save.isError && <Alert>{save.error.message}</Alert>}
          {sameAs ? (
            <div className={styles.confirm}>
              <span>
                This reaches the same orgs as <strong>{sameAs.name}</strong>.
                Replace that one? Its repos switch over with no gap.
              </span>
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  onClick={() => save.mutate(sameAs.id)}
                  disabled={save.isPending}
                >
                  Replace {sameAs.name}
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  Keep both
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <Button type="submit" variant="primary" disabled={save.isPending}>
                {save.isPending ? "Saving" : "Save token"}
              </Button>
              <Button onClick={startOver}>Use a different token</Button>
            </div>
          )}
          <Button onClick={onCancel}>Cancel</Button>
        </form>
      )}
    </section>
  );
}

// How to make each kind of token, each in a section that opens on click.
function TokenSteps() {
  return (
    <div className={styles.kinds}>
      <details className={styles.kind}>
        <summary className={styles.summary}>
          What to tick for a classic token
        </summary>
        <div className={styles.kindBody}>
          <p className={styles.hint}>
            Easiest. Works for all your repos and orgs. The button above ticks
            the scopes for you.
          </p>
          <ol className={styles.steps}>
            <li>
              Keep <code>repo</code> (its sub-boxes tick with it) and{" "}
              <code>read:org</code> ticked. Leave the rest. For public repos
              only, tick just <code>public_repo</code> instead of{" "}
              <code>repo</code>. Pick an expiry you're happy with.
            </li>
            <li>
              If your company uses single sign-on, click{" "}
              <strong>Configure SSO</strong>, then <strong>Authorize</strong>{" "}
              next to your org. Without this, work repos won't show up.
            </li>
            <li>Copy the token and paste it below.</li>
          </ol>
        </div>
      </details>
      <details className={styles.kind}>
        <summary className={styles.summary}>
          What to tick for a fine-grained token
        </summary>
        <div className={styles.kindBody}>
          <p className={styles.hint}>
            For orgs that only allow fine-grained tokens. Each one works for a
            single org or account, so add one for each. GitHub doesn't let these
            tokens read check runs, so failed checks from GitHub Actions and
            similar tools aren't named. Whether checks passed still shows.
          </p>
          <ol className={styles.steps}>
            <li>
              Set <strong>Resource owner</strong> to your org. Set{" "}
              <strong>Repository access</strong> to All repositories, or pick
              the repos you watch here. Pick an expiry you're happy with.
            </li>
            <li>
              Under <strong>Repository permissions</strong>, set these to
              Read-only: <code>Commit statuses</code>, <code>Contents</code>,
              and <code>Pull requests</code>. <code>Metadata</code> turns on by
              itself.
            </li>
            <li>
              Under <strong>Organization permissions</strong>, set{" "}
              <code>Members</code> to Read-only. This finds your teams, for
              review requests sent to them.
            </li>
            <li>
              If your org has to approve tokens, wait for an org owner to
              approve it. Syncs fail until then.
            </li>
            <li>Copy the token and paste it below.</li>
          </ol>
        </div>
      </details>
    </div>
  );
}
