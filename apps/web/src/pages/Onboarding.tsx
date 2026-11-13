import { MAX_TOKENS, type TokenDto, type TokensResponse } from "@pr-peek/core";
import { Building2, Check, User } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "../api";
import { AddTokenSheet, newToken, type Adding } from "../components/AddToken";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Card, CardRow } from "../components/Card";
import { InstallHere } from "../components/InstallSteps";
import { IosNotifications } from "../components/IosNotifications";
import { RepoPicker } from "../components/RepoPicker";
import { RepoTokenNote } from "../components/RepoTokenNote";
import { SelectField } from "../components/Field";
import { TurnOnNotifications } from "../components/TurnOnNotifications";
import { WatchedRepos } from "../components/WatchedRepos";
import { cx } from "../cx";
import { useInIosApp, useInNativeApp } from "../hooks/useIsTray";
import { useSaveSettings } from "../hooks/useSaveSettings";
import { detectPlatform, isStandalone } from "../install";
import { useGitHubTokens, useRepos } from "../queries";
import { detectedTimezone, timezoneOptions } from "../timezones";
import { reachText, stateOf } from "../tokens";
import styles from "./Onboarding.module.css";

// Org tokens come before repos, so the picker can list the orgs' repos.
const STEPS = ["orgs", "repos", "timezone", "done"] as const;
type Step = (typeof STEPS)[number];

const isStep = (value: string | null): value is Step =>
  STEPS.includes(value as Step);

// The step the user was on, for when the list sends them back here.
const STEP_KEY = "pr-peek:onboarding-step";

function rememberedStep(): string | null {
  try {
    return localStorage.getItem(STEP_KEY);
  } catch {
    return null;
  }
}

function rememberStep(step: Step) {
  try {
    // Done is the end, so the next visit starts over.
    if (step === "done") localStorage.removeItem(STEP_KEY);
    else localStorage.setItem(STEP_KEY, step);
  } catch {
    // Private windows can block storage. The URL still holds the step.
  }
}

// First run, after signing in with GitHub for the first time. Also where the list
// sends anyone who hasn't finished it. The step is in the URL, so a reload stays on it,
// and Back goes to the step before. Without one, it goes back to the last step seen.
export function Onboarding() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("step") ?? rememberedStep();
  const step = isStep(asked) ? asked : "orgs";
  const at = STEPS.indexOf(step);
  useEffect(() => rememberStep(step), [step]);
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

// Signing in only reads public repos, so private ones, the user's own too, need a
// fine-grained token (plan 22). Skippable: the repos step offers it again, and so does
// Settings.
function OrgsStep({ onNext }: { onNext: () => void }) {
  const tokens = useGitHubTokens();
  const [adding, setAdding] = useState<Adding | null>(null);
  const list = tokens.data?.tokens ?? [];
  const syncedBy = tokens.data?.syncedBy ?? [];
  // A classic token reaches every org, so there's no need for one per org.
  const hasClassic = list.some((token) => token.kind === "classic");

  return (
    <section className={styles.step}>
      <h2 className={styles.stepTitle}>Private repos</h2>
      <p className={styles.hint}>
        Public repos work right away. Private repos, yours or your org's, need a
        read-only GitHub token.
      </p>
      <Card label="What Git Buddy can reach">
        <AccessRow icon={<User />} label="Public repos" ready status="Ready" />
        {list.length === 0 ? (
          <AccessRow
            icon={<Building2 />}
            label="Private repos"
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
          ? "Only public repos, or not sure? Skip it. If private repos are missing on the next step, you can add a token there."
          : hasClassic
            ? "A classic token covers every org you're in."
            : "A token covers one account or org. Add one for each with private repos you watch."}{" "}
        Tokens are encrypted, and only ever read your repos.
      </p>
      <AddTokenSheet
        adding={adding}
        tokens={list}
        syncedBy={syncedBy}
        onSaved={() => setAdding(null)}
        onClose={() => setAdding(null)}
      />
    </section>
  );
}

// Skippable too. With no repos, the list asks again for them.
function ReposStep({ onNext }: { onNext: () => void }) {
  const repos = useRepos();
  const none = repos.data?.repos.length === 0;
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
      <RepoTokenNote />
      <WatchedRepos />
      <RepoPicker />
      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={finish}
          // Waits only while loading. A list that failed to load doesn't block.
          disabled={repos.isPending || none}
        >
          Next
        </Button>
        {none && <Button onClick={onNext}>Set up later</Button>}
      </div>
    </section>
  );
}

function TimezoneStep({ onNext }: { onNext: () => void }) {
  const [timezone, setTimezone] = useState(detectedTimezone);
  const [zones] = useState(() => timezoneOptions(timezone));
  // Also marks onboarding finished in the cached settings, so the list doesn't send
  // them back here.
  const save = useSaveSettings();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ timezone }, { onSuccess: onNext });
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
  const inNativeApp = useInNativeApp();
  const inIosApp = useInIosApp();
  return (
    <section className={styles.step}>
      <h2 className={styles.stepTitle}>You're set</h2>
      <p className={styles.hint}>Your list fills in within a minute.</p>
      {inIosApp && (
        <>
          <h3 className={styles.subTitle}>Get notifications</h3>
          <IosNotifications />
        </>
      )}
      {/* The Mac and iPhone apps don't need installing, and the Mac app notifies on its
          own. Elsewhere, notifications come with the installed app, so a browser tab
          offers the install first. */}
      {!inNativeApp &&
        (isStandalone() ? (
          <>
            <h3 className={styles.subTitle}>Get notifications</h3>
            <TurnOnNotifications />
          </>
        ) : (
          <>
            <h3 className={styles.subTitle}>Install the app</h3>
            {/* The iPhone steps already say this. */}
            {detectPlatform() !== "ios" && (
              <p className={styles.hint}>
                Notifications come with the app. Turn them on there once it's
                installed.
              </p>
            )}
            <InstallHere />
            <p>
              <Link to="/install">Install on other devices</Link>
            </p>
          </>
        ))}
      <div>
        <Button variant="primary" onClick={() => void navigate("/")}>
          Go to your list
        </Button>
      </div>
    </section>
  );
}
