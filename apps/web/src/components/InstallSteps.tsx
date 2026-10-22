import { useInstall } from "../hooks/useInstall";
import { promptInstall, type Platform } from "../install";
import { Button } from "./Button";
import styles from "./InstallSteps.module.css";

interface Guide {
  title: string;
  steps: string[];
  note?: string;
}

const GUIDES: Record<Exclude<Platform, "other">, Guide> = {
  ios: {
    title: "iPhone and iPad",
    steps: [
      "Open pr-peek in Safari.",
      "Tap Share, the square with an arrow.",
      "Tap Add to Home Screen, then Add.",
      "Open pr-peek from your Home Screen and sign in again.",
    ],
    note: "On iPhone, notifications only work in the Home Screen app.",
  },
  chromium: {
    title: "Android, Chrome, and Edge",
    steps: [
      "Open the browser menu.",
      "Pick Install pr-peek. On Android it may say Add to Home screen.",
    ],
  },
  "mac-safari": {
    title: "Safari on a Mac",
    steps: ["Choose File, then Add to Dock.", "Click Add."],
  },
};

// What to do on the device this page is open on.
export function InstallHere() {
  const { installed, canPrompt, platform } = useInstall();

  if (installed) return <p>pr-peek is installed on this device.</p>;
  if (canPrompt) {
    return (
      <div>
        <Button variant="primary" onClick={() => void promptInstall()}>
          Install pr-peek
        </Button>
      </div>
    );
  }
  if (platform === "other") {
    return (
      <p className={styles.hint}>
        This browser can't install apps. Open pr-peek in Chrome, Edge, or
        Safari.
      </p>
    );
  }
  return <Steps guide={GUIDES[platform]} />;
}

// Steps for every other kind of device.
export function OtherDevices() {
  const { platform } = useInstall();
  return (
    <div className={styles.guides}>
      {Object.entries(GUIDES)
        .filter(([key]) => key !== platform)
        .map(([key, guide]) => (
          <section key={key} className={styles.guide}>
            <h3 className={styles.title}>{guide.title}</h3>
            <Steps guide={guide} />
          </section>
        ))}
    </div>
  );
}

function Steps({ guide }: { guide: Guide }) {
  return (
    <>
      <ol className={styles.steps}>
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.note && <p className={styles.hint}>{guide.note}</p>}
    </>
  );
}
