import { MAX_TOKENS, type TokenDto, type TokensResponse } from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import { Building2, Check, User } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "../api";
import { AddTokenSheet, type Adding } from "../components/AddToken";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Card, CardRow } from "../components/Card";
import { InstallHere } from "../components/InstallSteps";
import { RepoPicker } from "../components/RepoPicker";
import { SelectField } from "../components/Field";
import { TurnOnNotifications } from "../components/TurnOnNotifications";
import { WatchedRepos } from "../components/WatchedRepos";
import { cx } from "../cx";
import { useIsTray } from "../hooks/useIsTray";
import { pushSupport } from "../push";
import { useGitHubTokens, useRepos } from "../queries";
import { detectedTimezone, timezoneOptions } from "../timezones";
import { reachText, stateOf } from "../tokens";
import styles from "./Onboarding.module.css";

// Org tokens come before repos, so the picker can list the orgs' repos.
const STEPS = ["orgs", "repos", "timezone", "done"] as const;
type Step = (typeof STEPS)[number];

const isStep = (value: string | null): value is Step =>
  STEPS.includes(value as Step);

// First run, after signing in with GitHub for the first time. Also where the list
// sends anyone who watches no repos. The step is in the URL, so a reload stays on it,
// and Back goes to the step before.
export function Onboarding() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("step");
  const step = isStep(asked) ? asked : "orgs";
  const at = STEPS.indexOf(step);
  // Keeps the other params, like the menu bar app's `shell=tray`.
  const next = () =>
    setParams((current) => {
      current.set("step", STEPS[at + 1] ?? "done");
      return current;
    });

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <h1 className={styles.title}>Welcome to Git Buddy</h1>
          <div className={styles.progress}>
            <div className={styles.bar} aria-hidden="true">
              {STEPS.map((name, i) => (
                <span
                  key={name}
                  className={cx(styles.segment, i <= at && styles.reached)}
                />
              ))}
            </div>
            <p className={styles.stepCount}>
              Step {at + 1} of {STEPS.length}
            </p>
          </div>
        </header>
        {step === "orgs" && <OrgsStep onNext={next} />}
        {step === "repos" && <ReposStep onNext={next} />}
        {step === "timezone" && <TimezoneStep onNext={next} />}
        {step === "done" && <DoneStep />}
      </div>
    </main>
  );
}

// Set as a new object each time, so the sheet starts a fresh form.
const newToken = (): Adding => ({ replacing: null });

// The add token sheet, with the user's tokens. Null `adding` closes it.
function TokenSheet({
  adding,
  onSaved,
  onClose,
}: {
  adding: Adding | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const tokens = useGitHubTokens();
  return (
    <AddTokenSheet
      adding={adding}
      tokens={tokens.data?.tokens ?? []}
      syncedBy={tokens.data?.syncedBy ?? []}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

// A row in the access card: who, and whether Git Buddy can reach them yet.
function AccessRow({
  icon,
  label,
  ready,
  status,
}: {
  icon: ReactNode;
  label: ReactNode;
  ready: boolean;
  status: string;
}) {
  return (
    <CardRow className={styles.accessRow}>
      <span className={styles.accessIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.accessLabel}>{label}</span>
      <span className={cx(styles.status, ready && styles.ready)}>
        {ready && <Check aria-hidden="true" className={styles.check} />}
        {status}
      </span>
    </CardRow>
  );
}

// A saved token's row: its name, what it reaches when that says more, and whether it
// works.
function TokenRow({
  token,
  syncedBy,
}: {
  token: TokenDto;
  syncedBy: TokensResponse["syncedBy"];
}) {
  const reach = reachText(token, syncedBy);
  const stopped = stateOf(token) === "stopped";
  return (
    <AccessRow
      icon={<Building2 />}
      label={
        <>
          <strong>{token.name}</strong>
          {/* A new token is named after its org, so don't say it twice. */}
          {reach !== token.name && (
            <span className={styles.reach}>{reach}</span>
          )}
        </>
      }
      ready={!stopped}
      status={stopped ? "Stopped working" : "Added"}
    />
  );
}

// Orgs usually block outside apps, so their repos need a token. Skippable: the repos
// step offers it again, and so does Settings.
function OrgsStep({ onNext }: { onNext: () => void }) {
  const tokens = useGitHubTokens();
  const [adding, setAdding] = useState<Adding | null>(null);
  const list = tokens.data?.tokens ?? [];
  const syncedBy = tokens.data?.syncedBy ?? [];
  // A classic token reaches every org, so there's no need for one per org.
  const hasClassic = list.some((token) => token.kind === "classic");

  return (
    <section className={styles.step}>
      <h2 className={styles.stepTitle}>Repos from your orgs</h2>
      <p className={styles.hint}>
        Your own repos work right away. Orgs usually require a GitHub token.
      </p>
      <Card label="What Git Buddy can reach">
        <AccessRow icon={<User />} label="Your repos" ready status="Ready" />
        {list.length === 0 ? (
          <AccessRow
            icon={<Building2 />}
            label="Org repos"
            ready={false}
            status="Needs a token"
          />
        ) : (
          list.map((token) => (
            <TokenRow key={token.id} token={token} syncedBy={syncedBy} />
          ))
        )}
      </Card>
      {tokens.isError && <Alert>{tokens.error.message}</Alert>}
      <div className={styles.actions}>
        {list.length === 0 ? (
          <>
            <Button variant="primary" onClick={() => setAdding(newToken())}>
              Add a token
            </Button>
            <Button onClick={onNext}>Skip for now</Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={onNext}>
              Next
            </Button>
            {list.length < MAX_TOKENS && (
              <Button onClick={() => setAdding(newToken())}>Add another</Button>
            )}
          </>
        )}
      </div>
      <p className={styles.note}>
        {list.length === 0
          ? "No orgs, or not sure? Skip it. If an org's repos are missing on the next step, you can add a token there."
          : hasClassic
            ? "A classic token covers every org you're in."
            : "A fine-grained token covers one org. Add one for each org you work in."}{" "}
        Tokens are encrypted, and only ever read your repos.
      </p>
      <TokenSheet
        adding={adding}
        onSaved={() => setAdding(null)}
        onClose={() => setAdding(null)}
      />
    </section>
  );
}

function ReposStep({ onNext }: { onNext: () => void }) {
  const repos = useRepos();
  // With none, the list would only send them back here.
  const none = repos.data?.repos.length === 0;
  const [adding, setAdding] = useState<Adding | null>(null);
  const [saved, setSaved] = useState(false);
  const finish = () => {
    // Starts a first sync, so the list isn't empty. A refused one waits for the schedule.
    api("/sync", { method: "POST" }).catch(() => undefined);
    onNext();
  };
  return (
    <section className={styles.step}>
      <h2 className={styles.stepTitle}>Pick the repos to watch</h2>
      <p className={styles.hint}>
        Git Buddy only looks at these. You can change them later in settings.
      </p>
      {/* Stays after a save, for a second org. */}
      <p className={styles.hint}>
        {saved ? (
          <span className={styles.saved} role="status">
            Token saved. Its repos show below.
          </span>
        ) : (
          "Missing an org's repos?"
        )}{" "}
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => setAdding(newToken())}
        >
          {saved ? "Add another" : "Add a token"}
        </button>
      </p>
      <WatchedRepos />
      <RepoPicker />
      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={finish}
          disabled={!repos.data || none}
        >
          Next
        </Button>
        {none && (
          <span className={styles.note}>Pick at least one repo to go on.</span>
        )}
      </div>
      <TokenSheet
        adding={adding}
        onSaved={() => {
          setAdding(null);
          setSaved(true);
        }}
        onClose={() => setAdding(null)}
      />
    </section>
  );
}

function TimezoneStep({ onNext }: { onNext: () => void }) {
  const [timezone, setTimezone] = useState(detectedTimezone);
  const [zones] = useState(() => timezoneOptions(timezone));
  const save = useMutation({
    mutationFn: () => api("/settings", { method: "PATCH", body: { timezone } }),
    onSuccess: onNext,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form className={styles.step} onSubmit={submit}>
      <h2 className={styles.stepTitle}>Your timezone</h2>
      <p className={styles.hint}>
        For work hours, quiet hours, and the morning summary.
      </p>
      <SelectField
        label="Timezone"
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
      >
        {zones.map((zone) => (
          <option key={zone}>{zone}</option>
        ))}
      </SelectField>
      {save.isError && <Alert>{save.error.message}</Alert>}
      <div>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Next
        </Button>
      </div>
    </form>
  );
}

function DoneStep() {
  const navigate = useNavigate();
  const isTray = useIsTray();
  return (
    <section className={styles.step}>
      <h2 className={styles.stepTitle}>You're set</h2>
      <p className={styles.hint}>Your list fills in within a minute.</p>
      {/* The iPhone install steps below already say notifications need the app. */}
      {!isTray && pushSupport() !== "needs-install" && (
        <>
          <h3 className={styles.subTitle}>Get notifications</h3>
          <TurnOnNotifications />
        </>
      )}
      {!isTray && (
        <>
          <h3 className={styles.subTitle}>Install the app</h3>
          <InstallHere />
          <p>
            <Link to="/install">Install on other devices</Link>
          </p>
        </>
      )}
      <div>
        <Button variant="primary" onClick={() => void navigate("/")}>
          Go to your list
        </Button>
      </div>
    </section>
  );
}
