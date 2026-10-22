import type { RuleGroup, RuleSettingDto, Severity } from "@pr-peek/core";
import type { ReactNode } from "react";
import { Alert } from "../../components/Alert";
import { Card, CardRow } from "../../components/Card";
import { Select } from "../../components/Field";
import { RowText } from "../../components/RowText";
import { Switch } from "../../components/Switch";
import { useSaveRule } from "../../hooks/useSaveSettings";
import { useSettings } from "../../queries";
import styles from "./RulesTab.module.css";
import { TabHeading } from "./SettingsLayout";

const GROUPS: { group: RuleGroup; title: string }[] = [
  { group: "Other PRs", title: "Other people's PRs" },
  { group: "My PRs", title: "My PRs" },
];

const SEVERITIES: { value: Severity; label: string }[] = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

export function RulesTab() {
  const settings = useSettings();

  return (
    <>
      <TabHeading title="Rules">
        Each rule decides what shows on your list. Urgency sorts the list.
        Notify sends a push notification, once those arrive.
      </TabHeading>
      {settings.isPending && <p className={styles.hint}>Loading</p>}
      {settings.isError && <Alert>{settings.error.message}</Alert>}
      {settings.data &&
        GROUPS.map(({ group, title }) => (
          <section key={group} className={styles.group}>
            <h3 className={styles.groupTitle}>{title}</h3>
            <Card label={title}>
              {settings.data.rules
                .filter((rule) => rule.group === group)
                .map((rule) => (
                  <RuleRow key={rule.id} rule={rule} />
                ))}
            </Card>
          </section>
        ))}
    </>
  );
}

// A control with a short visible name. Screen readers hear the control's own label,
// which names the rule too.
function Control({ name, children }: { name: string; children: ReactNode }) {
  return (
    <span className={styles.control}>
      <span aria-hidden="true">{name}</span>
      {children}
    </span>
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
      <RowText label={rule.name} />
      <span className={styles.controls}>
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
      </span>
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
