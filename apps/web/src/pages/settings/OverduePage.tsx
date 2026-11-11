import type { UserSettingsDto } from "@pr-peek/core";
import { useState } from "react";
import { Link } from "react-router";
import { Alert } from "../../components/Alert";
import { CardRow } from "../../components/Card";
import { Input, Select } from "../../components/Field";
import { Group } from "../../components/Group";
import { RowText } from "../../components/RowText";
import { SettingSwitch } from "../../components/SettingSwitch";
import { useSaveSettings, useSettingsSaver } from "../../hooks/useSaveSettings";
import { useSettings } from "../../queries";
import { timezoneOptions } from "../../timezones";
import styles from "./OverduePage.module.css";
import { SettingsPage } from "./SettingsLayout";

// The server's limit, 30 days.
const MAX_HOURS = 24 * 30;

// When a review request's age turns orange, then red.
export function OverduePage() {
  const settings = useSettings();

  return (
    <SettingsPage title="Overdue reviews">
      {settings.isPending && <p className={styles.hint}>Loading</p>}
      {settings.isError && <Alert>{settings.error.message}</Alert>}
      {settings.data && <OverdueSettings settings={settings.data.settings} />}
    </SettingsPage>
  );
}

function OverdueSettings({ settings }: { settings: UserSettingsDto }) {
  return (
    <>
      <Group
        title="When"
        footer="How long a review request waits before its age turns orange, then red."
      >
        <HoursRow
          key={`warn-${settings.staleWarnHours}`}
          settings={settings}
          field="staleWarnHours"
          label="Turn orange after"
          problem={(hours) =>
            hours >= settings.staleLateHours
              ? "Orange must come before red."
              : null
          }
        />
        <HoursRow
          key={`late-${settings.staleLateHours}`}
          settings={settings}
          field="staleLateHours"
          label="Turn red after"
          problem={(hours) =>
            hours <= settings.staleWarnHours
              ? "Red must come after orange."
              : null
          }
        />
      </Group>
      <Group
        title="Counting"
        footer={
          <>
            Work hours are weekdays, 9 to 6. Ages on your list always show real
            time. The time zone also sets quiet hours. Reminders after red are
            in <Link to="/settings/notifications">Notifications</Link>.
          </>
        }
      >
        <SettingSwitch
          settings={settings}
          field="workHoursOnly"
          label="Only count work hours"
        />
        <TimezoneRow settings={settings} />
      </Group>
    </>
  );
}

// A number of hours. Saves when the box loses focus.
function HoursRow({
  settings,
  field,
  label,
  problem,
}: {
  settings: UserSettingsDto;
  field: "staleWarnHours" | "staleLateHours";
  label: string;
  // Why `hours` can't be saved, or null.
  problem: (hours: number) => string | null;
}) {
  const save = useSaveSettings();
  const stored = settings[field];
  const [draft, setDraft] = useState(String(stored));
  const [mistake, setMistake] = useState<string | null>(null);

  const commit = () => {
    const hours = Number(draft);
    const why =
      draft === "" || !Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS
        ? `Use a whole number of hours, 1 to ${MAX_HOURS}.`
        : problem(hours);
    setMistake(why);
    if (why || hours === stored) return;
    save.mutate(
      { [field]: hours },
      { onError: () => setDraft(String(stored)) },
    );
  };

  return (
    <CardRow>
      <RowText label={label} />
      <span className={styles.inline}>
        <Input
          className={styles.hours}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_HOURS}
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          disabled={save.isPending}
        />
        hours
      </span>
      {(mistake ?? save.error) && (
        <Alert>{mistake ?? save.error?.message}</Alert>
      )}
    </CardRow>
  );
}

function TimezoneRow({ settings }: { settings: UserSettingsDto }) {
  const { save, shown } = useSettingsSaver(settings);
  const [zones] = useState(() => timezoneOptions(settings.timezone));

  return (
    <CardRow>
      <RowText label="Time zone" />
      <Select
        className={styles.zone}
        aria-label="Time zone"
        value={shown.timezone}
        onChange={(e) => save.mutate({ timezone: e.target.value })}
        disabled={save.isPending}
      >
        {zones.map((zone) => (
          <option key={zone}>{zone}</option>
        ))}
      </Select>
      {save.isError && <Alert>{save.error.message}</Alert>}
    </CardRow>
  );
}
