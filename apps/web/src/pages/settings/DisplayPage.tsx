import {
  SHOW_AUTHORS,
  type ShowAuthors,
  type UserSettingsDto,
} from "@pr-peek/core";
import { useEffect, useRef, useState } from "react";
import { Alert } from "../../components/Alert";
import { CardRow } from "../../components/Card";
import { Select } from "../../components/Field";
import { Group } from "../../components/Group";
import { RowText } from "../../components/RowText";
import { SectionOrder } from "../../components/SectionOrder";
import { SettingSwitch } from "../../components/SettingSwitch";
import { useSettingsSaver } from "../../hooks/useSaveSettings";
import { useLocalSetting } from "../../localSetting";
import { useSettings } from "../../queries";
import { appScale, SCALES, setScale } from "../../scale";
import styles from "./DisplayPage.module.css";
import { SettingsPage } from "./SettingsLayout";

// What shows on the list, and how it looks on this device.
export function DisplayPage() {
  const settings = useSettings();
  return (
    <SettingsPage title="List display">
      {settings.isError && <Alert>{settings.error.message}</Alert>}
      {settings.data && (
        <>
          <Group title="What shows">
            <SettingSwitch
              settings={settings.data.settings}
              field="hideBots"
              label="Hide bots"
              hint="Like dependabot and renovate"
            />
            <SettingSwitch
              settings={settings.data.settings}
              field="includeTeamRequests"
              label="Team review requests"
              hint="Not just ones that ask you"
            />
          </Group>
          <Group
            title="Authors"
            footer="Shows the picture of who opened each PR. Why it's on your list moves to a small badge on the picture."
          >
            <ShowAuthorsRow settings={settings.data.settings} />
          </Group>
        </>
      )}
      <Group
        title="Section order"
        aside="This device"
        footer="Drag a section by its handle to move it on the list."
        box
      >
        <SectionOrder inCard />
      </Group>
      <Group
        title="Size"
        aside="This device"
        footer="Makes everything bigger or smaller, like zooming in a browser."
      >
        <SizeRow />
      </Group>
    </SettingsPage>
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
      <RowText label="Show authors" />
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
      <RowText label="Size" />
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
