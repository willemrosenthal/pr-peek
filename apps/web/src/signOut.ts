import type { DeleteAccountResponse } from "@pr-peek/core";
import { api } from "./api";
import { forgetIosPush } from "./iosPush";

// Signs out. First this iPhone, if it is one, stops getting the user's notifications.
export async function requestSignOut() {
  await forgetIosPush();
  await api("/auth/signout", { method: "POST" });
}

// Deletes the account, or a waiting sign-up request. Says whether GitHub confirmed it
// took back Git Buddy's access.
export const requestAccountDeletion = () =>
  api<DeleteAccountResponse>("/me", { method: "DELETE" });
