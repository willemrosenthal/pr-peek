import type { RuleGroup, RuleSettingDto, Severity } from "@pr-peek/core";
import { Bell, BellOff } from "lucide-react";
import { Alert } from "../../components/Alert";
import { CardRow } from "../../components/Card";
import { Group } from "../../components/Group";
import type { Choice } from "../../components/choice";
import { Picker } from "../../components/Picker";
import { Switch } from "../../components/Switch";
import { cx } from "../../cx";
import { useSaveRule } from "../../hooks/useSaveSettings";
import styles from "./RulesPage.module.css";
import settingsStyles from "./Settings.module.css";
import { SettingsPage, WithSettings } from "./SettingsLayout";

const GROUPS: { group: RuleGroup; title: string }[] = [
  { group: "Other PRs", title: "Other people's PRs" },
  { group: "My PRs", title: "My PRs" },
];

const SEVERITIES: Choice<Severity>[] = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

export function RulesPage() {
  return (
    <SettingsPage title="Rules">
      <p className={settingsStyles.hint}>
        Each rule puts PRs on your list. Urgency sorts them. The bell sends a
        notification to your devices.
      </p>
      <WithSettings>
        {({ rules }) =>
          GROUPS.map(({ group, title }, index) => (
            <Group
              key={group}
              title={title}
              // Column names over the first group, lined up with the controls.
              aside={index === 0 ? <ColumnNames /> : undefined}
              footer={
                index === GROUPS.length - 1
                  ? "High urgency can break quiet hours, if you let it in Notifications."
                  : undefined
              }
            >
              {rules
                .filter((rule) => rule.group === group)
                .map((rule) => (
                  <RuleRow key={rule.id} rule={rule} />
                ))}
            </Group>
          ))
        }
      </WithSettings>
    </SettingsPage>
  );
}

// Screen readers hear each control's own label instead.
function ColumnNames() {
  return (
    <span className={styles.columns} aria-hidden="true">
      <span className={styles.urgencyColumn}>Urgency</span>
      <span className={styles.bellColumn}>Notify</span>
      <span className={styles.switchColumn}>On</span>
    </span>
  );
}

// One rule on one line: its name, urgency, bell, and switch. Shows new values while
// they save.
function RuleRow({ rule }: { rule: RuleSettingDto }) {
  const save = useSaveRule(rule.id);
  const saving = save.isPending ? save.variables : {};
  const shown = {
    enabled: saving.enabled ?? rule.enabled,
    severity: saving.severity ?? rule.severity,
    notify: (saving.channels ?? rule.channels).includes("push"),
    includeDrafts:
      saving.options?.includeDrafts ?? rule.options.includeDrafts ?? false,
  };
  const BellIcon = shown.notify ? Bell : BellOff;

  return (
    <>
      <CardRow className={cx(styles.row, !shown.enabled && styles.off)}>
        <span className={styles.name}>{rule.name}</span>
        <Picker
          className={cx(styles.urgency, styles[shown.severity])}
          label={`Urgency for ${rule.name}`}
          value={shown.severity}
          options={SEVERITIES}
          onChange={(severity) => save.mutate({ severity })}
          disabled={save.isPending}
        />
        <button
          type="button"
          role="switch"
          className={cx(styles.bell, shown.notify && styles.notifying)}
          aria-label={`Notify for ${rule.name}`}
          aria-checked={shown.notify}
          onClick={() =>
            save.mutate({
              channels: shown.notify ? ["list"] : ["list", "push"],
            })
          }
          disabled={save.isPending}
        >
          <BellIcon
            size={20}
            fill={shown.notify ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
        <span className={styles.switchColumn}>
          <Switch
            label={`Turn on ${rule.name}`}
            checked={shown.enabled}
            onChange={(enabled) => save.mutate({ enabled })}
            disabled={save.isPending}
          />
        </span>
        {save.isError && <Alert>{save.error.message}</Alert>}
      </CardRow>
      {rule.id === "review_requested" && (
        <CardRow className={cx(styles.option, !shown.enabled && styles.off)}>
          <span className={styles.optionName} aria-hidden="true">
            Include draft PRs
          </span>
          <span className={styles.switchColumn}>
            <Switch
              label="Include draft PRs"
              checked={shown.includeDrafts}
              onChange={(includeDrafts) =>
                save.mutate({ options: { includeDrafts } })
              }
              disabled={save.isPending}
            />
          </span>
        </CardRow>
      )}
    </>
  );
}
