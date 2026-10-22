import { formatAge, type PushSubscriptionDto } from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../../api";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Card, CardRow } from "../../components/Card";
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
        Where pr-peek sends notifications. Turn them on from each device.
      </TabHeading>
      {!isTray && <TurnOnNotifications />}
      <DeviceList />
      {!isTray && (
        <p>
          <Link to="/install">Install pr-peek on your devices</Link>
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

function DeviceRow({
  device,
  isThis,
}: {
  device: PushSubscriptionDto;
  isThis: boolean;
}) {
  const reloadDevices = useReloadDevices();
  // Both reload after a failure too. A test can find the device gone, and a removal can
  // fail after the server dropped the device.
  const test = useMutation({
    mutationFn: () =>
      api(`/push/subscriptions/${device.id}/test`, { method: "POST" }),
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
  const error = test.error ?? remove.error;

  return (
    <CardRow>
      <span className={styles.name}>
        {name}
        <span className={styles.hint}>
          {isThis && "This device. "}
          <LastSent at={device.lastSuccessAt} />
        </span>
      </span>
      <Button
        aria-label={`Send a test to ${name}`}
        onClick={() => test.mutate()}
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

function LastSent({ at }: { at: string | null }) {
  const now = useNow();
  if (!at) return "Nothing sent yet.";
  const age = formatAge(at, now);
  return age === "0m" ? "Last sent just now." : `Last sent ${age} ago.`;
}
