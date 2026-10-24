import {
  formatAge,
  MAX_DEVICE_LABEL,
  TEST_PUSHES,
  type PushSubscriptionDto,
  type Severity,
  type TestPushBody,
  type UpdatePushSubscriptionBody,
} from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../../api";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Card, CardRow } from "../../components/Card";
import { Input, Select } from "../../components/Field";
import styles from "../../components/Notifications.module.css";
import { TurnOnNotifications } from "../../components/TurnOnNotifications";
import { useIsTray } from "../../hooks/useIsTray";
import { useNow } from "../../hooks/useNow";
import { unsubscribeThisDevice } from "../../push";
import { useDevices, useReloadDevices, useThisDevice } from "../../queries";
import { TabHeading } from "./SettingsLayout";

export function DevicesTab() {
  const isTray = useIsTray();
  return (
    <>
      <TabHeading title="Devices">
        Where Git Buddy sends notifications. Turn them on from each device.
      </TabHeading>
      {!isTray && <TurnOnNotifications />}
      <DeviceList />
      {!isTray && (
        <p>
          <Link to="/install">Install Git Buddy on your devices</Link>
        </p>
      )}
    </>
  );
}

function DeviceList() {
  const devices = useDevices();
  const thisDevice = useThisDevice();

  if (devices.isPending) return <p className={styles.hint}>Loading</p>;
  if (devices.isError) return <Alert>{devices.error.message}</Alert>;
  if (devices.data.subscriptions.length === 0) {
    return <p className={styles.hint}>No devices get notifications yet.</p>;
  }
  return (
    <Card label="Devices">
      {devices.data.subscriptions.map((device) => (
        <DeviceRow
          key={device.id}
          device={device}
          isThis={device.endpoint === thisDevice.data}
        />
      ))}
    </Card>
  );
}

// The lowest urgency each choice lets through.
const LEVELS: { value: Severity; label: string }[] = [
  { value: "low", label: "Everything" },
  { value: "normal", label: "Normal and high" },
  { value: "high", label: "High only" },
];

function DeviceRow({
  device,
  isThis,
}: {
  device: PushSubscriptionDto;
  isThis: boolean;
}) {
  const reloadDevices = useReloadDevices();
  const save = useMutation({
    mutationFn: (changes: UpdatePushSubscriptionBody) =>
      api(`/push/subscriptions/${device.id}`, {
        method: "PATCH",
        body: changes,
      }),
    onSettled: reloadDevices,
  });
  // Each test is the next kind of notification, so trying them all shows each one.
  const [nextTest, setNextTest] = useState(0);
  // Both reload after a failure too. A test can find the device gone, and a removal can
  // fail after the server dropped the device.
  const test = useMutation({
    mutationFn: (sample: number) =>
      api(`/push/subscriptions/${device.id}/test`, {
        method: "POST",
        body: { sample } satisfies TestPushBody,
      }),
    onSuccess: (_, sample) => setNextTest((sample + 1) % TEST_PUSHES.length),
    onSettled: reloadDevices,
  });
  const remove = useMutation({
    mutationFn: async () => {
      await api(`/push/subscriptions/${device.id}`, { method: "DELETE" });
      // Otherwise this browser keeps a subscription the server no longer knows.
      if (isThis) await unsubscribeThisDevice();
    },
    onSettled: reloadDevices,
  });
  const name = device.label ?? "Unnamed device";
  // Shows the new choice while it saves.
  const minSeverity =
    (save.isPending && save.variables.minSeverity) || device.minSeverity;
  const error = save.error ?? test.error ?? remove.error;

  return (
    <CardRow>
      <span className={styles.name}>
        <DeviceName
          key={device.label}
          name={name}
          onSave={(label, revert) =>
            save.mutate({ label }, { onError: revert })
          }
          disabled={save.isPending}
        />
        <span className={styles.hint}>
          {isThis && "This device. "}
          <LastSent at={device.lastSuccessAt} />
        </span>
        <span className={styles.hint}>
          Next test: {TEST_PUSHES[nextTest]!.name}.
        </span>
      </span>
      <Select
        aria-label={`Notifications on ${name}`}
        value={minSeverity}
        onChange={(e) =>
          save.mutate({ minSeverity: e.target.value as Severity })
        }
        disabled={save.isPending}
      >
        {LEVELS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Button
        aria-label={`Send a test to ${name}`}
        onClick={() => test.mutate(nextTest)}
        disabled={test.isPending}
      >
        Send test
      </Button>
      <Button
        aria-label={`Remove ${name}`}
        onClick={() => remove.mutate()}
        disabled={remove.isPending}
      >
        Remove
      </Button>
      {error && <Alert>{error.message}</Alert>}
    </CardRow>
  );
}

// The device's name in a text box. Saves when the box loses focus. A blank name, or one
// that fails to save, goes back to the old one.
function DeviceName({
  name,
  onSave,
  disabled,
}: {
  name: string;
  onSave: (label: string, revert: () => void) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <Input
      className={styles.label}
      aria-label={`Name for ${name}`}
      maxLength={MAX_DEVICE_LABEL}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const label = draft.trim();
        if (label && label !== name) onSave(label, () => setDraft(name));
        else setDraft(name);
      }}
      disabled={disabled}
    />
  );
}

function LastSent({ at }: { at: string | null }) {
  const now = useNow();
  if (!at) return "Nothing sent yet.";
  const age = formatAge(at, now);
  return age === "0m" ? "Last sent just now." : `Last sent ${age} ago.`;
}
