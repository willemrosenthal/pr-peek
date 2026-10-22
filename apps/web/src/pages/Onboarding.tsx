import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { InstallHere } from "../components/InstallSteps";
import { RepoPicker } from "../components/RepoPicker";
import { SelectField } from "../components/Field";
import { TurnOnNotifications } from "../components/TurnOnNotifications";
import { WatchedRepos } from "../components/WatchedRepos";
import { useIsTray } from "../hooks/useIsTray";
import { pushSupport } from "../push";
import { detectedTimezone, timezoneOptions } from "../timezones";
import styles from "./Onboarding.module.css";

const STEPS = ["repos", "timezone", "done"] as const;
type Step = (typeof STEPS)[number];

// First run, after signing in with GitHub for the first time.
export function Onboarding() {
  const [step, setStep] = useState<Step>("repos");
  const next = () => setStep(STEPS[STEPS.indexOf(step) + 1] ?? "done");

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <h1 className={styles.title}>Welcome to pr-peek</h1>
          <p className={styles.hint}>
            Step {STEPS.indexOf(step) + 1} of {STEPS.length}
          </p>
        </header>
        {step === "repos" && <ReposStep onNext={next} />}
        {step === "timezone" && <TimezoneStep onNext={next} />}
        {step === "done" && <DoneStep />}
      </div>
    </main>
  );
}

function ReposStep({ onNext }: { onNext: () => void }) {
  const finish = () => {
    // Starts a first sync, so the list isn't empty. A refused one waits for the schedule.
    api("/sync", { method: "POST" }).catch(() => undefined);
    onNext();
  };
  return (
    <section className={styles.step}>
      <h2 className={styles.stepTitle}>Pick the repos to watch</h2>
      <p className={styles.hint}>
        pr-peek only looks at these. You can change them later in settings.
      </p>
      <WatchedRepos />
      <RepoPicker />
      <div>
        <Button variant="primary" onClick={finish}>
          Next
        </Button>
      </div>
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
