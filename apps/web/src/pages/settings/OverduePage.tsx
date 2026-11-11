import type { UserSettingsDto } from "@pr-peek/core";
import { useState } from "react";
import { Link } from "react-router";
import { Alert } from "../../components/Alert";
import { CardRow } from "../../components/Card";
import { Select } from "../../components/Field";
import { Group } from "../../components/Group";
import { RowText } from "../../components/RowText";
import { SettingSwitch } from "../../components/SettingSwitch";
import { Stepper } from "../../components/Stepper";
import { useSettingsSaver } from "../../hooks/useSaveSettings";
import { stepAfter, stepBefore } from "../../overdueSteps";
import { formatHours } from "../../settingsStatus";
import { timezoneOptions } from "../../timezones";
import styles from "./OverduePage.module.css";
import { SettingsPage, WithSettings } from "./SettingsLayout";

// When a review request's age turns orange, then red.
export function OverduePage() {
  return (
    <SettingsPage title="Overdue reviews">
      <WithSettings>
        {({ settings }) => <OverdueSettings settings={settings} />}
      </WithSettings>
    </SettingsPage>
  );
}

function OverdueSettings({ settings }: { settings: UserSettingsDto }) {
  // Both rows share one save, so each keeps to its side of the other's new value.
  const { save, shown } = useSettingsSaver(settings);
  const warn = shown.staleWarnHours;
  const late = shown.staleLateHours;
  const later = stepAfter(warn);
  const sooner = stepBefore(late);

  return (
    <>
      <Group label="Timeline" box>
        <Timeline warn={warn} late={late} />
      </Group>
      <Group
        title="When"
        footer="Steps of 1, 2, 4, 8, and 12 hours, then whole days. Red always comes after orange."
      >
        <CardRow>
          <RowText label="Turn orange after" />
          <Stepper
            value={formatHours(warn)}
            less={stepBefore(warn)}
            more={later !== null && later < late ? later : null}
            lessLabel="Turn orange sooner"
            moreLabel="Turn orange later"
            onStep={(staleWarnHours) => save.mutate({ staleWarnHours })}
            disabled={save.isPending}
          />
        </CardRow>
        <CardRow>
          <RowText label="Turn red after" />
          <Stepper
            value={formatHours(late)}
            less={sooner !== null && sooner > warn ? sooner : null}
            more={stepAfter(late)}
            lessLabel="Turn red sooner"
            moreLabel="Turn red later"
            onStep={(staleLateHours) => save.mutate({ staleLateHours })}
            disabled={save.isPending}
          />
        </CardRow>
        {save.isError && (
          <CardRow>
            <Alert>{save.error.message}</Alert>
          </CardRow>
        )}
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

// A review request's age, from requested to orange to red. Just a picture: the rows say
// the same.
function Timeline({ warn, late }: { warn: number; late: number }) {
  return (
    <div className={styles.timeline} aria-hidden="true">
      <p className={styles.timelineHint}>
        A review request's age turns orange, then red, the longer it waits.
      </p>
      <div className={styles.bar}>
        <span />
        <span className={styles.warn} />
        <span className={styles.late} />
      </div>
      <div className={styles.marks}>
        <span>Requested</span>
        <span className={styles.warnText}>After {formatHours(warn)}</span>
        <span className={styles.lateText}>After {formatHours(late)}</span>
      </div>
    </div>
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
