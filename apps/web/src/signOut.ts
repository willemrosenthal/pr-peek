import type { DeleteAccountResponse } from "@pr-peek/core";
import { api } from "./api";
import { forgetIosPush } from "./iosPush";

// Signs out. First this iPhone, if it is one, stops getting the user's notifications.
export async function requestSignOut() {
  await forgetIosPush();
  await api("/auth/signout", { method: "POST" });
}

// The sign in page's notice when GitHub didn't confirm it took back Git Buddy's access.
export const GITHUB_ACCESS_KEPT = "github-access-kept";

// Deletes the account, or a waiting sign-up request. Returns the sign in page to go to
// after, asking the user to revoke Git Buddy on GitHub when GitHub didn't confirm it.
export async function requestAccountDeletion() {
  const { githubRevoked } = await api<DeleteAccountResponse>("/me", {
    method: "DELETE",
  });
  return githubRevoked ? "/signin" : `/signin?notice=${GITHUB_ACCESS_KEPT}`;
}
