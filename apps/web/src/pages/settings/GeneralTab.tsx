import {
  SHOW_AUTHORS,
  type ShowAuthors,
  type UserSettingsDto,
} from "@pr-peek/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { setBadge } from "../../badge";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Card, CardRow } from "../../components/Card";
import { Select } from "../../components/Field";
import { GitHubToken } from "../../components/GitHubToken";
import { RowText } from "../../components/RowText";
import { SectionOrder } from "../../components/SectionOrder";
import { SettingSwitch } from "../../components/SettingSwitch";
import { Switch } from "../../components/Switch";
import {
  clearTrayState,
  coloredIcon,
  COUNT_STYLES,
  countStyle,
  inDesktopApp,
  launchAtLogin,
  setLaunchAtLogin,
  type CountStyle,
} from "../../desktop";
import { useSettingsSaver } from "../../hooks/useSaveSettings";
import { useLocalSetting } from "../../localSetting";
import { queryKeys, useMe, useSettings } from "../../queries";
import { appScale, SCALES, setScale } from "../../scale";
import styles from "./GeneralTab.module.css";
import { TabHeading } from "./SettingsLayout";

export function GeneralTab() {
  const { data } = useMe();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: () => api("/auth/signout", { method: "POST" }),
    onSuccess: async () => {
      queryClient.clear();
      void setBadge(0);
      clearTrayState();
      await navigate("/signin", { replace: true });
    },
  });

  return (
    <>
      <TabHeading title="General">Signed in as {data?.user.login}</TabHeading>
      {settings.isError && <Alert>{settings.error.message}</Alert>}
      {settings.data && (
        <Card label="General settings">
          <SettingSwitch
            settings={settings.data.settings}
            field="hideBots"
            label="Hide bots"
            hint="Leaves out comments and reviews by bots, like dependabot and renovate."
          />
          <SettingSwitch
            settings={settings.data.settings}
            field="includeTeamRequests"
            label="Team review requests"
            hint="Lists PRs that ask one of your teams to review, not just you."
          />
          <ShowAuthorsRow settings={settings.data.settings} />
        </Card>
      )}
      <Card label="This device">
        <SizeRow />
        <SectionOrderRow />
      </Card>
      {inDesktopApp() && (
        <Card label="Menu bar">
          <LaunchAtLoginRow />
          <MenuBarCountRow />
          <ColoredIconRow />
        </Card>
      )}
      <GitHubToken />
      <hr className={styles.divider} />
      <div>
        <Button onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Sign out
        </Button>
      </div>
    </>
  );
}

const SHOW_AUTHORS_LABELS: Record<ShowAuthors, string> = {
  off: "Off",
  review: "Needs my review only",
  all: "Everywhere",
};

function ShowAuthorsRow({ settings }: { settings: UserSettingsDto }) {
  const { save, shown } = useSettingsSaver(settings);
  return (
    <CardRow>
      <RowText
        label="Show authors"
        hint="Shows the picture of who opened each PR. Why it's on your list moves to a small badge on the picture."
      />
      <Select
        aria-label="Show authors"
        value={shown.showAuthors}
        onChange={(e) =>
          save.mutate({ showAuthors: e.target.value as ShowAuthors })
        }
        disabled={save.isPending}
      >
        {SHOW_AUTHORS.map((value) => (
          <option key={value} value={value}>
            {SHOW_AUTHORS_LABELS[value]}
          </option>
        ))}
      </Select>
      {save.isError && <Alert>{save.error.message}</Alert>}
    </CardRow>
  );
}

const percent = (scale: number) => `${Math.round(scale * 100)}%`;

const scaleAt = (step: string) => SCALES[Number(step)] ?? 1;

// Applies the size when the user lets go. Resizing mid-drag would move the slider under
// the pointer and pick another size by accident.
function SizeRow() {
  const saved = useLocalSetting(appScale);
  const [dragging, setDragging] = useState<number | null>(null);
  const scale = dragging ?? saved;
  const slider = useRef<HTMLInputElement>(null);

  // The browser's own change event fires on letting go, wherever the pointer is, and on
  // each arrow key. React's onChange fires on every move instead.
  useEffect(() => {
    const input = slider.current;
    if (!input) return;
    const apply = () => {
      setScale(scaleAt(input.value));
      setDragging(null);
    };
    input.addEventListener("change", apply);
    return () => input.removeEventListener("change", apply);
  }, []);

  return (
    <CardRow>
      <RowText
        label="Size"
        hint="Makes everything bigger or smaller, like zooming in a browser. Only on this device."
      />
      <span className={styles.size}>
        <input
          ref={slider}
          type="range"
          min={0}
          max={SCALES.length - 1}
          step={1}
          value={SCALES.indexOf(scale)}
          aria-label="Size"
          aria-valuetext={percent(scale)}
          onChange={(e) => setDragging(scaleAt(e.target.value))}
        />
        <span aria-hidden="true">{percent(scale)}</span>
      </span>
    </CardRow>
  );
}

function SectionOrderRow() {
  return (
    <CardRow>
      <RowText
        label="Section order"
        hint="Drag a section by its handle to move it on the list. Only on this device."
      />
      <SectionOrder />
    </CardRow>
  );
}

// The same switch as "Launch at login" in the menu bar icon's right click menu.
function LaunchAtLoginRow() {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: queryKeys.launchAtLogin,
    queryFn: launchAtLogin,
  });
  const save = useMutation({
    mutationFn: setLaunchAtLogin,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.launchAtLogin }),
  });
  // Shows the new state while it saves.
  const on = save.isPending ? save.variables : (state.data ?? false);

  return (
    <CardRow>
      <RowText
        label="Launch at login"
        hint="Opens Git Buddy in the menu bar when you log in to this Mac."
      />
      <Switch
        label="Launch at login"
        checked={on}
        onChange={(checked) => save.mutate(checked)}
        disabled={state.isPending || save.isPending}
      />
      {save.isError && <Alert>Couldn't change it. Try again.</Alert>}
    </CardRow>
  );
}

// Kept on this Mac, since only its menu bar uses it.
function MenuBarCountRow() {
  const style = useLocalSetting(countStyle);
  return (
    <CardRow>
      <RowText
        label="Menu bar count"
        hint="Next to the icon. Only on this Mac."
      />
      <Select
        aria-label="Menu bar count"
        value={style}
        onChange={(e) => countStyle.set(e.target.value as CountStyle)}
      >
        {COUNT_STYLES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </CardRow>
  );
}

// Kept on this Mac, like the count.
function ColoredIconRow() {
  const colored = useLocalSetting(coloredIcon);
  return (
    <CardRow>
      <RowText
        label="Colored icon"
        hint="Turns orange when a review is late, and red when a check fails. Off keeps it plain."
      />
      <Switch
        label="Colored icon"
        checked={colored}
        onChange={coloredIcon.set}
      />
    </CardRow>
  );
}
