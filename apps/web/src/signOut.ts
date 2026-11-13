import { api } from "./api";
import { forgetIosPush } from "./iosPush";
import { forgetWebPush } from "./push";

// Signs out. First this device stops getting the user's notifications: this iPhone, if
// it is one, and this browser's web push.
export async function requestSignOut() {
  await forgetIosPush();
  await forgetWebPush();
  await api("/auth/signout", { method: "POST" });
}
