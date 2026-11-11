import type {
  ItemDto,
  ItemKind,
  ListSection,
  ShowAuthors,
  UserSettingsDto,
} from "@pr-peek/core";
import { useEffect, useRef, useState } from "react";
import { Alert } from "../../components/Alert";
import type { Choice } from "../../components/choice";
import { Group } from "../../components/Group";
import { ItemRow } from "../../components/ItemRow";
import { SectionOrder } from "../../components/SectionOrder";
import { Segmented } from "../../components/Segmented";
import { SettingSwitch } from "../../components/SettingSwitch";
import { useSettingsSaver } from "../../hooks/useSaveSettings";
import { useLocalSetting } from "../../localSetting";
import {
  appScale,
  NORMAL_SCALE,
  scaleLabel,
  SCALES,
  setScale,
} from "../../scale";
import { sectionTitle, showsAuthors } from "../../sections";
import styles from "./DisplayPage.module.css";
import { SettingsPage, WithSettings } from "./SettingsLayout";

// What shows on the list, and how it looks on this device.
export function DisplayPage() {
  return (
    <SettingsPage title="List display">
      <WithSettings>
        {({ settings }) => (
          <>
            <Group title="What shows">
              <SettingSwitch
                settings={settings}
                field="hideBots"
                label="Hide bots"
                hint="Like dependabot and renovate"
              />
              <SettingSwitch
                settings={settings}
                field="includeTeamRequests"
                label="Team review requests"
                hint="Not just ones that ask you"
              />
            </Group>
            <Group
              title="Author pictures"
              footer="Shows the picture of who opened each PR. Why it's on your list moves to a small badge on the picture."
              box
            >
              <AuthorPictures settings={settings} />
            </Group>
          </>
        )}
      </WithSettings>
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
        box
      >
        <SizeRow />
      </Group>
    </SettingsPage>
  );
}

const AUTHOR_CHOICES: Choice<ShowAuthors>[] = [
  { value: "off", label: "Off" },
  { value: "review", label: "My reviews" },
  { value: "all", label: "Everywhere" },
];

// Two rows the way the list draws them, one under each of two sections, to show where
// pictures go. Not a real list: nothing in it can be tapped.
const PREVIEW: { group: ListSection; item: ItemDto }[] = [
  {
    group: "review",
    item: previewItem("review_requested", "Fix login redirect on Safari", "5h"),
  },
  {
    group: "replies",
    item: previewItem("reply", "Add rate limits to the API", "1d"),
  },
];

function previewItem(kind: ItemKind, title: string, age: string): ItemDto {
  return {
    id: `preview-${kind}`,
    kind,
    summary: kind === "reply" ? "Replied to you" : "Asked for your review",
    actorLogin: "",
    actorIsBot: false,
    occurredAt: "",
    waitingSince: null,
    age,
    staleLevel: "fresh",
    waitingOnAuthor: false,
    assignedState: null,
    assigned: false,
    severity: "normal",
    unseen: false,
    otherIds: [],
    pr: {
      id: `preview-${kind}`,
      title,
      owner: "acme",
      repo: "web-app",
      number: 1,
      url: "",
      author: "octocat",
      color: null,
      important: false,
    },
  };
}

// The preview of where pictures go, and the choice of where.
function AuthorPictures({ settings }: { settings: UserSettingsDto }) {
  const { save, shown } = useSettingsSaver(settings);
  return (
    <>
      <div className={styles.preview} inert aria-hidden="true">
        {PREVIEW.map(({ group, item }) => (
          <div key={group}>
            <p className={styles.previewSection}>{sectionTitle(group)}</p>
            <ItemRow
              item={item}
              showAuthor={showsAuthors(shown.showAuthors, group)}
            />
          </div>
        ))}
      </div>
      <div className={styles.authorChoice}>
        <Segmented
          label="Author pictures"
          value={shown.showAuthors}
          options={AUTHOR_CHOICES}
          onChange={(showAuthors) => save.mutate({ showAuthors })}
          disabled={save.isPending}
        />
        {save.isError && <Alert>{save.error.message}</Alert>}
      </div>
    </>
  );
}

const scaleAt = (step: string) => SCALES[Number(step)] ?? NORMAL_SCALE;

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
    <div className={styles.size}>
      <div className={styles.sizeTrack}>
        <span className={styles.smallA} aria-hidden="true">
          A
        </span>
        <input
          ref={slider}
          type="range"
          min={0}
          max={SCALES.length - 1}
          step={1}
          value={SCALES.indexOf(scale)}
          aria-label="Size"
          aria-valuetext={scaleLabel(scale)}
          onChange={(e) => setDragging(scaleAt(e.target.value))}
        />
        <span className={styles.bigA} aria-hidden="true">
          A
        </span>
      </div>
      <p className={styles.sizeValue} aria-hidden="true">
        {scaleLabel(scale)}
      </p>
    </div>
  );
}
