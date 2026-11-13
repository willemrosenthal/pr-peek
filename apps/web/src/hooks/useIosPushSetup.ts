import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { iosPushStatus, openIosSettings, turnOnIosPush } from "../iosPush";

const STATUS_KEY = ["ios-push-status"];

export type IosPushSetup = ReturnType<typeof useIosPushSetup>;

// Notifications in the iPhone app (plan 12): whether they're on, and ways to turn them
// on and open iPhone Settings. The status checks again when the app comes back, like
// from iPhone Settings.
export function useIosPushSetup() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: iosPushStatus });
  const turnOn = useMutation({
    mutationFn: turnOnIosPush,
    onSettled: () => queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
  });

  return {
    // Undefined while it loads. "unavailable" when the app couldn't say.
    status: status.isError ? ("unavailable" as const) : status.data,
    // Call it straight from a tap.
    turnOn: () => turnOn.mutate(),
    turningOn: turnOn.isPending,
    turnOnError: turnOn.error,
    openSettings: () => void openIosSettings().catch(() => undefined),
  };
}
