import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useWhenHidden } from "../hooks/useWhenHidden";
import { useRepos, useSettings } from "../queries";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import styles from "./Sheet.module.css";

// Asked once per page load, so moving between the list and Settings doesn't ask again.
// Hiding the app asks again, so reopening shows it.
let asked = false;

// For tests.
export const resetPickReposAsked = () => {
  asked = false;
};

// On the list, for someone past onboarding who watches no repos, like after skipping
// that step. Points them to Add repos.
export function PickReposSheet() {
  const navigate = useNavigate();
  const settings = useSettings();
  const repos = useRepos();
  // Wants to ask, unless this load already did. Shows once there are no repos.
  const [open, setOpen] = useState(() => !asked);
  const none =
    settings.data?.settings.onboarded === true &&
    repos.data?.repos.length === 0;
  const shown = open && none;

  useEffect(() => {
    if (shown) asked = true;
  }, [shown]);
  // Opens while hidden, so it's there when the app comes back.
  useWhenHidden(useCallback(() => setOpen(true), []));

  return (
    <Sheet
      open={shown}
      onClose={() => setOpen(false)}
      title="Pick repos to watch"
    >
      <p className={styles.text}>
        You're not watching any repos yet. Git Buddy only looks at the ones you
        pick.
      </p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={() => {
            setOpen(false);
            void navigate("/settings/repos/add");
          }}
        >
          Pick repos
        </Button>
        <Button onClick={() => setOpen(false)}>Later</Button>
      </div>
    </Sheet>
  );
}
