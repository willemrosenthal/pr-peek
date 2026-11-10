import { useMutation } from "@tanstack/react-query";
import { pushSupport, turnOnPush } from "../push";
import {
  isPushOff,
  useDevices,
  usePushKey,
  useReloadDevices,
  useThisDevice,
} from "../queries";

// "unavailable": this device can't get them. A browser without push, an iPhone outside
// the Home Screen app, or push turned off on the server.
export type PushStatus = "unavailable" | "blocked" | "off" | "on";

// Whether this device gets notifications, and a way to turn them on. `status` is
// undefined while it loads.
export function usePushSetup() {
  const supported = pushSupport() === "supported";
  const key = usePushKey(supported);
  const devices = useDevices(supported);
  const thisDevice = useThisDevice();
  const reloadDevices = useReloadDevices();
  const turnOn = useMutation({
    mutationFn: (publicKey: string) => turnOnPush(publicKey),
    onSuccess: reloadDevices,
  });

  let status: PushStatus | undefined;
  if (!supported || isPushOff(key.error)) status = "unavailable";
  else if (devices.isPending || thisDevice.isPending) status = undefined;
  // A list that failed to load counts as off, so the button still shows.
  else if (
    devices.data?.subscriptions.some((d) => d.endpoint === thisDevice.data)
  ) {
    status = "on";
  } else status = Notification.permission === "denied" ? "blocked" : "off";

  const publicKey = key.data?.publicKey;
  return {
    status,
    // Undefined until the key loads. Call it straight from a tap: iOS only asks then.
    turnOn: publicKey ? () => turnOn.mutate(publicKey) : undefined,
    turningOn: turnOn.isPending,
    error: turnOn.error ?? (isPushOff(key.error) ? null : key.error),
  };
}
