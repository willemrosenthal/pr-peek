import { api } from "./api";
import { forgetIosPush } from "./iosPush";
import { dropWebPush, thisDeviceEndpoint } from "./push";

// Signs out, and this device stops getting the user's notifications: this iPhone, if
// it is one, and this browser's web push. The server deletes the browser's device as
// it signs out, then the browser drops its subscription. A browser whose push can't be
// read still signs out.
export async function requestSignOut() {
  await forgetIosPush();
  const endpoint = await thisDeviceEndpoint().catch(() => null);
  await api("/auth/signout", {
    method: "POST",
    body: endpoint ? { endpoint } : {},
  });
  await dropWebPush();
}
