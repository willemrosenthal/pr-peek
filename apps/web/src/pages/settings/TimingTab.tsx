import type { UserSettingsDto } from "@pr-peek/core";
import { useState } from "react";
import { Alert } from "../../components/Alert";
import { CardRow } from "../../components/Card";
import { Input, Select } from "../../components/Field";
import { RowText } from "../../components/RowText";
import { SettingSwitch } from "../../components/SettingSwitch";
import { SettingsGroup } from "../../components/SettingsGroup";
import { Switch } from "../../components/Switch";
import { useSaveSettings, useSettingsSaver } from "../../hooks/useSaveSettings";
import { useSettings } from "../../queries";
import { timezoneOptions } from "../../timezones";
import styles from "./TimingTab.module.css";
import { TabHeading } from "./SettingsLayout";

// The server's limit, 30 days.
const MAX_HOURS = 24 * 30;
// Times a setting starts at when it's turned on.
const QUIET_FROM = "18:00";
const QUIET_TO = "09:00";
const SUMMARY_AT = "09:00";
// Choices for reminders after red.
const REMIND_HOURS = [1, 2, 4, 8, 24];

export function TimingTab() {
  const settings = useSettings();

  return (
    <>
      <TabHeading title="Timing">
        When reviews count as overdue, and when to stay quiet.
      </TabHeading>
      {settings.isPending && <p className={styles.hint}>Loading</p>}
      {settings.isError && <Alert>{settings.error.message}</Alert>}
      {settings.data && <TimingSettings settings={settings.data.settings} />}
    </>
  );
}

function TimingSettings({ settings }: { settings: UserSettingsDto }) {
  return (
    <>
      <SettingsGroup
        title="Overdue reviews"
        hint="How long a review request waits before its row turns orange, then red."
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
        <SettingSwitch
          settings={settings}
          field="workHoursOnly"
          label="Only count work hours"
          hint="Only weekdays, 9 to 6, count toward orange and red. Ages always show real time."
        />
        <RemindRow settings={settings} />
        <TimezoneRow settings={settings} />
      </SettingsGroup>
      <SettingsGroup
        title="Notifications"
        hint="Notifications held during quiet times are left for the morning summary."
      >
        <QuietHoursRow settings={settings} />
        <SettingSwitch
          settings={settings}
          field="quietWeekends"
          label="Quiet all weekend"
        />
        <SettingSwitch
          settings={settings}
          field="highBreaksQuiet"
          label="Let high urgency through"
          hint="High urgency notifications still arrive during quiet times."
        />
        <SummaryRow settings={settings} />
      </SettingsGroup>
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

function RemindRow({ settings }: { settings: UserSettingsDto }) {
  const { save, shown } = useSettingsSaver(settings);

  return (
    <CardRow>
      <RowText
        label="Remind me again every"
        hint="You get a notification when a review turns orange, and when it turns red. After red, this often again. Counts work hours only if that's on."
      />
      <Select
        aria-label="Remind me again every"
        value={shown.remindEveryHours ?? ""}
        onChange={(e) =>
          save.mutate({
            remindEveryHours: e.target.value ? Number(e.target.value) : null,
          })
        }
        disabled={save.isPending}
      >
        <option value="">Never</option>
        {REMIND_HOURS.map((hours) => (
          <option key={hours} value={hours}>
            {hours === 1 ? "1 hour" : `${hours} hours`}
          </option>
        ))}
      </Select>
      {save.isError && <Alert>{save.error.message}</Alert>}
    </CardRow>
  );
}

function TimezoneRow({ settings }: { settings: UserSettingsDto }) {
  const { save, shown } = useSettingsSaver(settings);
  const [zones] = useState(() => timezoneOptions(settings.timezone));

  return (
    <CardRow>
      <RowText label="Timezone" hint="For work hours and quiet hours." />
      <Select
        aria-label="Timezone"
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

function QuietHoursRow({ settings }: { settings: UserSettingsDto }) {
  const { save, shown } = useSettingsSaver(settings);
  const on = shown.quietStart !== null && shown.quietEnd !== null;

  return (
    <CardRow>
      <RowText
        label="Quiet hours"
        hint="No notifications between these times."
      />
      <Switch
        label="Quiet hours"
        checked={on}
        onChange={(checked) =>
          save.mutate(
            checked
              ? { quietStart: QUIET_FROM, quietEnd: QUIET_TO }
              : { quietStart: null, quietEnd: null },
          )
        }
        disabled={save.isPending}
      />
      {on && (
        <span className={styles.times}>
          <TimeInput
            key={`from-${shown.quietStart}`}
            label="Quiet from"
            value={shown.quietStart ?? QUIET_FROM}
            onSave={(quietStart) => save.mutate({ quietStart })}
            disabled={save.isPending}
          />
          <TimeInput
            key={`to-${shown.quietEnd}`}
            label="Quiet until"
            value={shown.quietEnd ?? QUIET_TO}
            onSave={(quietEnd) => save.mutate({ quietEnd })}
            disabled={save.isPending}
          />
        </span>
      )}
      {save.isError && <Alert>{save.error.message}</Alert>}
    </CardRow>
  );
}

function SummaryRow({ settings }: { settings: UserSettingsDto }) {
  const { save, shown } = useSettingsSaver(settings);
  const on = shown.digestTime !== null;

  return (
    <CardRow>
      <RowText
        label="Morning summary"
        hint="One notification a day with what's waiting."
      />
      <Switch
        label="Morning summary"
        checked={on}
        onChange={(checked) =>
          save.mutate({ digestTime: checked ? SUMMARY_AT : null })
        }
        disabled={save.isPending}
      />
      {on && (
        <span className={styles.times}>
          <TimeInput
            key={`at-${shown.digestTime}`}
            label="Summary at"
            value={shown.digestTime ?? SUMMARY_AT}
            onSave={(digestTime) => save.mutate({ digestTime })}
            disabled={save.isPending}
          />
        </span>
      )}
      {save.isError && <Alert>{save.error.message}</Alert>}
    </CardRow>
  );
}

// A time of day, "HH:MM". Saves when the box loses focus.
function TimeInput({
  label,
  value,
  onSave,
  disabled,
}: {
  label: string;
  value: string;
  onSave: (time: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <label className={styles.time}>
      <span>{label}</span>
      <Input
        type="time"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft && draft !== value) onSave(draft);
          else setDraft(value);
        }}
        disabled={disabled}
      />
    </label>
  );
}
