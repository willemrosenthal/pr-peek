import type { UserSettingsDto } from "@pr-peek/core";
import { useState } from "react";
import { Alert } from "../../components/Alert";
import { CardRow } from "../../components/Card";
import { Input, Select } from "../../components/Field";
import { Group } from "../../components/Group";
import { RowText } from "../../components/RowText";
import { SettingSwitch } from "../../components/SettingSwitch";
import { Switch } from "../../components/Switch";
import { TurnOnNotifications } from "../../components/TurnOnNotifications";
import { useInInstalledApp } from "../../hooks/useIsTray";
import { useSettingsSaver } from "../../hooks/useSaveSettings";
import styles from "./NotificationsPage.module.css";
import { SettingsPage, WithSettings } from "./SettingsLayout";

// Times a setting starts at when it's turned on.
const QUIET_FROM = "18:00";
const QUIET_TO = "09:00";
const SUMMARY_AT = "09:00";
// Choices for reminders after red.
const REMIND_HOURS = [1, 2, 4, 8, 24];

// Whether this device gets notifications, and when to stay quiet.
export function NotificationsPage() {
  // Only the installed app sets up notifications. The Mac app notifies on its own.
  const inInstalledApp = useInInstalledApp();

  return (
    <SettingsPage title="Notifications">
      {inInstalledApp && (
        <Group title="This device">
          <CardRow>
            <TurnOnNotifications />
          </CardRow>
        </Group>
      )}
      <WithSettings>
        {({ settings }) => <NotificationSettings settings={settings} />}
      </WithSettings>
    </SettingsPage>
  );
}

function NotificationSettings({ settings }: { settings: UserSettingsDto }) {
  return (
    <>
      <Group
        title="Quiet times"
        footer="Notifications held during quiet times wait for the morning summary."
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
        />
      </Group>
      <Group
        label="Morning summary"
        footer="One notification a day with what's waiting."
      >
        <SummaryRow settings={settings} />
      </Group>
      <Group
        title="Overdue reminders"
        footer="You get one when a review turns orange, and one when it turns red. After red, this often again. It counts work hours only, if that's on."
      >
        <RemindRow settings={settings} />
      </Group>
    </>
  );
}

function RemindRow({ settings }: { settings: UserSettingsDto }) {
  const { save, shown } = useSettingsSaver(settings);

  return (
    <CardRow>
      <RowText label="After red, remind me" />
      <Select
        aria-label="After red, remind me"
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
            {hours === 1 ? "Every hour" : `Every ${hours} hours`}
          </option>
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
    <>
      <CardRow>
        <RowText label="Quiet hours" />
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
        {save.isError && <Alert>{save.error.message}</Alert>}
      </CardRow>
      {on && (
        <>
          <TimeRow
            key={`from-${shown.quietStart}`}
            name="From"
            label="Quiet from"
            value={shown.quietStart ?? QUIET_FROM}
            onSave={(quietStart) => save.mutate({ quietStart })}
            disabled={save.isPending}
          />
          <TimeRow
            key={`to-${shown.quietEnd}`}
            name="Until"
            label="Quiet until"
            value={shown.quietEnd ?? QUIET_TO}
            onSave={(quietEnd) => save.mutate({ quietEnd })}
            disabled={save.isPending}
          />
        </>
      )}
    </>
  );
}

function SummaryRow({ settings }: { settings: UserSettingsDto }) {
  const { save, shown } = useSettingsSaver(settings);
  const on = shown.digestTime !== null;

  return (
    <>
      <CardRow>
        <RowText label="Morning summary" />
        <Switch
          label="Morning summary"
          checked={on}
          onChange={(checked) =>
            save.mutate({ digestTime: checked ? SUMMARY_AT : null })
          }
          disabled={save.isPending}
        />
        {save.isError && <Alert>{save.error.message}</Alert>}
      </CardRow>
      {on && (
        <TimeRow
          key={`at-${shown.digestTime}`}
          name="At"
          label="Summary at"
          value={shown.digestTime ?? SUMMARY_AT}
          onSave={(digestTime) => save.mutate({ digestTime })}
          disabled={save.isPending}
        />
      )}
    </>
  );
}

// A time of day, "HH:MM", in a row of its own under the switch it belongs to. The
// phone opens its own time picker. Saves when the box loses focus.
function TimeRow({
  name,
  label,
  value,
  onSave,
  disabled,
}: {
  // Shown, like "From".
  name: string;
  // For screen readers, like "Quiet from".
  label: string;
  value: string;
  onSave: (time: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <CardRow className={styles.timeRow}>
      <span className={styles.timeName} aria-hidden="true">
        {name}
      </span>
      <Input
        className={styles.time}
        type="time"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft && draft !== value) onSave(draft);
          else setDraft(value);
        }}
        disabled={disabled}
      />
    </CardRow>
  );
}
