import { Tabs } from "@base-ui/react/tabs";
import type {
  CheckTokenResponse,
  TokenDto,
  TokenKind,
  TokenResponse,
  TokensResponse,
} from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api";
import { refreshTokens } from "../queries";
import { formatDate, kindLabel, reachText } from "../tokens";
import { Alert } from "./Alert";
import { Button, ButtonLink } from "./Button";
import { Input, TextField } from "./Field";
import styles from "./GitHubTokens.module.css";
import { Sheet } from "./Sheet";

const FINE_GRAINED_URL =
  "https://github.com/settings/personal-access-tokens/new";
// The classic page ticks these scopes when it opens.
const CLASSIC_URL =
  "https://github.com/settings/tokens/new?scopes=repo,read:org&description=Git%20Buddy";

// On touch screens only: pasting into a hidden field there takes a long press. A
// keyboard has Cmd+V.
const showPaste = () =>
  "readText" in (navigator.clipboard ?? {}) &&
  window.matchMedia("(pointer: coarse)").matches;

export interface Adding {
  // The token being replaced, or null to add one.
  replacing: TokenDto | null;
}

// Adds a new token. A new object each time, so the sheet starts a fresh form.
export const newToken = (): Adding => ({ replacing: null });

// A sheet that adds a token, or replaces one. Null `adding` closes it.
export function AddTokenSheet({
  adding,
  tokens,
  syncedBy,
  onSaved,
  onClose,
}: {
  adding: Adding | null;
  tokens: TokenDto[];
  syncedBy: TokensResponse["syncedBy"];
  // With a line saying what changed.
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  // The form keeps showing while the sheet slides away. Each opening starts a fresh one.
  const [shown, setShown] = useState({ adding, count: 0 });
  if (adding && adding !== shown.adding) {
    setShown({ adding, count: shown.count + 1 });
  }
  const replacing = shown.adding?.replacing;
  return (
    <Sheet
      open={adding !== null}
      onClose={onClose}
      title={replacing ? `Replace ${replacing.name}` : "Add a token"}
    >
      {shown.adding && (
        <AddToken
          key={shown.count}
          replacing={shown.adding.replacing}
          tokens={tokens}
          syncedBy={syncedBy}
          onSaved={onSaved}
        />
      )}
    </Sheet>
  );
}

// Make a token on GitHub (a tab for each kind), paste and check it, then see what it
// reaches and name it before it's saved.
function AddToken({
  replacing,
  tokens,
  syncedBy,
  onSaved,
}: {
  replacing: TokenDto | null;
  tokens: TokenDto[];
  syncedBy: TokensResponse["syncedBy"];
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  // Replacing a classic token opens on its tab. Else fine-grained, the safer kind.
  const [kind, setKind] = useState<TokenKind>(
    replacing?.kind === "classic" ? "classic" : "fine_grained",
  );

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
      await refreshTokens(queryClient);
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
  // The browser may refuse. Then the field still takes a normal paste.
  const paste = () =>
    navigator.clipboard.readText().then(
      (text) => setToken(text.trim()),
      () => {},
    );

  return (
    <>
      {!checked ? (
        <>
          <Tabs.Root
            value={kind}
            onValueChange={(value: TokenKind) => setKind(value)}
          >
            <div className={styles.tabsCard}>
              <Tabs.List className={styles.tabs}>
                <Tabs.Tab value="fine_grained" className={styles.tab}>
                  Fine-grained
                  <span className={styles.recommended}>Recommended</span>
                </Tabs.Tab>
                <Tabs.Tab value="classic" className={styles.tab}>
                  Classic token
                </Tabs.Tab>
              </Tabs.List>
            </div>
            <Tabs.Panel value="fine_grained" className={styles.step}>
              <FineGrainedSteps />
            </Tabs.Panel>
            <Tabs.Panel value="classic" className={styles.step}>
              <ClassicSteps />
            </Tabs.Panel>
          </Tabs.Root>
          <form className={styles.stepCard} onSubmit={submitToken}>
            <StepTitle number={2}>
              <label htmlFor="token-input">Copy it, then paste it here</label>
            </StepTitle>
            <div className={styles.pasteRow}>
              <Input
                id="token-input"
                className={styles.tokenInput}
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={kind === "classic" ? "ghp_…" : "github_pat_…"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              {showPaste() && (
                <Button onClick={() => void paste()}>Paste</Button>
              )}
            </div>
            {check.isError && <Alert>{check.error.message}</Alert>}
            <Button
              type="submit"
              variant="primary"
              wide
              disabled={!token.trim() || check.isPending}
            >
              {check.isPending ? "Checking" : "Submit"}
            </Button>
          </form>
        </>
      ) : (
        <form
          className={styles.stepCard}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(replacing?.id ?? null);
          }}
        >
          <div className={styles.accepted} role="status">
            <strong>GitHub accepted it.</strong>
            <span>
              {kindLabel(checked.kind)}.{" "}
              {checked.expiresAt
                ? `Expires ${formatDate(checked.expiresAt)}.`
                : "Never expires."}
            </span>
            <span>It reaches {reachText(checked, syncedBy)}.</span>
          </div>
          {/* With no repos watched yet, like during onboarding, there's nothing to reach. */}
          {!checked.reachesWatched && syncedBy.length > 0 && (
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
            <div className={styles.sheetActions}>
              <Button type="submit" variant="primary" disabled={save.isPending}>
                {save.isPending ? "Saving" : "Save token"}
              </Button>
              <Button onClick={startOver}>Use a different token</Button>
            </div>
          )}
        </form>
      )}
    </>
  );
}

// A numbered step's title. The number is only drawn, so screen readers read the words.
function StepTitle({
  number,
  children,
}: {
  number: number;
  children: ReactNode;
}) {
  return (
    <div className={styles.stepTitle}>
      <span className={styles.stepNumber} aria-hidden="true">
        {number}
      </span>
      {children}
    </div>
  );
}

// The first step: a link to GitHub's page for making the token, and what to set there.
function MakeStep({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.stepCard}>
      <StepTitle number={1}>
        <span>Make one on GitHub</span>
      </StepTitle>
      <ButtonLink href={href} target="_blank" rel="noreferrer" wide>
        {label}
        <ExternalLink aria-hidden="true" className={styles.linkIcon} />
      </ButtonLink>
      <ol className={styles.steps}>{children}</ol>
    </div>
  );
}

function FineGrainedSteps() {
  return (
    <>
      <p className={styles.kindHint}>
        Can be read-only, and reaches only the account or org and repos you
        pick, so it's the safer kind. Set it to read-only: Git Buddy can't check
        this for you. Add one for each account or org. GitHub doesn't let these
        tokens read check runs, so failed checks from GitHub Actions and similar
        tools aren't named. Whether checks passed still shows.
      </p>
      <MakeStep
        href={FINE_GRAINED_URL}
        label="Make a fine-grained token on GitHub"
      >
        <li>
          Set <strong>Resource owner</strong> to your org, or to you for your
          own repos. Set <strong>Repository access</strong> to All repositories,
          or pick the repos you watch here. Pick a short expiry, like 30 days.
          Git Buddy reminds you before it ends.
        </li>
        <li>
          Under <strong>Repository permissions</strong>, set these to Read-only:{" "}
          <code>Commit statuses</code>, <code>Contents</code>, and{" "}
          <code>Pull requests</code>. <code>Metadata</code> turns on by itself.
        </li>
        <li>
          Under <strong>Organization permissions</strong>, set{" "}
          <code>Members</code> to Read-only. This finds your teams, for review
          requests sent to them.
        </li>
        <li>
          If your org has to approve tokens, wait for an org owner to approve
          it. Syncs fail until then.
        </li>
      </MakeStep>
    </>
  );
}

function ClassicSteps() {
  return (
    <>
      <p className={styles.kindHint}>
        Easiest. One token reaches all your repos and orgs, but it can do
        anything you can on GitHub. Some orgs don't allow them.
      </p>
      <MakeStep href={CLASSIC_URL} label="Make a classic token on GitHub">
        <li>
          The link ticks <code>repo</code> (its sub-boxes tick with it) and{" "}
          <code>read:org</code>. Leave the rest. Pick a short expiry, like 30
          days. Git Buddy reminds you before it ends.
        </li>
        <li>
          If your company uses single sign-on, click{" "}
          <strong>Configure SSO</strong>, then <strong>Authorize</strong> next
          to your org. Without this, work repos won't show up.
        </li>
      </MakeStep>
    </>
  );
}
