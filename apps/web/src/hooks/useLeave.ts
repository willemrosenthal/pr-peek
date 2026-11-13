import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { setAppBadge } from "../appBadge";
import { clearTrayState } from "../desktop";

// What the sign in page is told on the way there.
export interface SignInState {
  // GitHub didn't confirm it took back Git Buddy's access. Asks to revoke it there.
  githubAccessKept?: boolean;
}

// After signing out or deleting the account: nothing of theirs stays on this device,
// and they land on sign in.
export function useLeave() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (state: SignInState = {}) => {
    queryClient.clear();
    void setAppBadge(0);
    clearTrayState();
    await navigate("/signin", { replace: true, state });
  };
}
