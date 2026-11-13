import type { SignOutResponse } from "@pr-peek/core";
import { api } from "./api";
import { forgetIosPush } from "./iosPush";
import { dropWebPush, pauseWebPush, thisDeviceEndpoint } from "./push";

// Signs out, and this device stops getting the user's notifications: this iPhone, if
// it is one, and this browser's web push. The server removes the browser's device as it
// signs out. The browser keeps its subscription, so signing in again as the same user
// turns notifications back on. Otherwise, like an old one from someone else, it's
// dropped. A browser whose push can't be read still signs out.
export async function requestSignOut(userId: string) {
  await forgetIosPush();
  const endpoint = await thisDeviceEndpoint().catch(() => null);
  const { deviceRemoved } = await api<SignOutResponse>("/auth/signout", {
    method: "POST",
    body: endpoint ? { endpoint } : {},
  });
  if (deviceRemoved) pauseWebPush(userId);
  else await dropWebPush();
}
