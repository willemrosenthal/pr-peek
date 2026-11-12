import { api } from "./api";
import { forgetIosPush } from "./iosPush";

// Signs out. First this iPhone, if it is one, stops getting the user's notifications.
export async function requestSignOut() {
  await forgetIosPush();
  await api("/auth/signout", { method: "POST" });
}
