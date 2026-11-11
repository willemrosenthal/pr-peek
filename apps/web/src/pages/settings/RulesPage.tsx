import type { RuleGroup, RuleSettingDto, Severity } from "@pr-peek/core";
import { Alert } from "../../components/Alert";
import { CardRow } from "../../components/Card";
import { Control, Controls } from "../../components/Control";
import { Select } from "../../components/Field";
import { RowText } from "../../components/RowText";
import { Group } from "../../components/Group";
import { Switch } from "../../components/Switch";
import { useSaveRule } from "../../hooks/useSaveSettings";
import { useSettings } from "../../queries";
import styles from "./RulesPage.module.css";
import { SettingsPage } from "./SettingsLayout";

const GROUPS: { group: RuleGroup; title: string }[] = [
  { group: "Other PRs", title: "Other people's PRs" },
  { group: "My PRs", title: "My PRs" },
];

const SEVERITIES: { value: Severity; label: string }[] = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

export function RulesPage() {
  const settings = useSettings();

  return (
    <SettingsPage title="Rules">
      <p className={styles.hint}>
        Each rule decides what shows on your list. Urgency sorts the list.
        Notify sends a push notification to your devices.
      </p>
      {settings.isPending && <p className={styles.hint}>Loading</p>}
      {settings.isError && <Alert>{settings.error.message}</Alert>}
      {settings.data &&
        GROUPS.map(({ group, title }) => (
          <Group key={group} title={title}>
            {settings.data.rules
              .filter((rule) => rule.group === group)
              .map((rule) => (
                <RuleRow key={rule.id} rule={rule} />
              ))}
          </Group>
        ))}
    </SettingsPage>
  );
}

// One rule's switch, urgency, and notify setting. Shows new values while they save.
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

  return (
    <CardRow>
      <RowText label={rule.name} full />
      <Controls>
        <Control name="Urgency">
          <Select
            aria-label={`Urgency for ${rule.name}`}
            value={shown.severity}
            onChange={(e) =>
              save.mutate({ severity: e.target.value as Severity })
            }
            disabled={save.isPending}
          >
            {SEVERITIES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Control>
        <Control name="Notify">
          <Switch
            label={`Notify for ${rule.name}`}
            checked={shown.notify}
            onChange={(on) =>
              save.mutate({ channels: on ? ["list", "push"] : ["list"] })
            }
            disabled={save.isPending}
          />
        </Control>
        <Control name="On">
          <Switch
            label={`Turn on ${rule.name}`}
            checked={shown.enabled}
            onChange={(enabled) => save.mutate({ enabled })}
            disabled={save.isPending}
          />
        </Control>
      </Controls>
      {rule.id === "review_requested" && (
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={shown.includeDrafts}
            onChange={(e) =>
              save.mutate({ options: { includeDrafts: e.target.checked } })
            }
            disabled={save.isPending}
          />
          Include draft PRs
        </label>
      )}
      {save.isError && <Alert>{save.error.message}</Alert>}
    </CardRow>
  );
}
