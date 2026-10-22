import type { MeResponse } from "@pr-peek/core";
import { useQuery } from "@tanstack/react-query";
import { api, isUnauthorized } from "./api";

export const queryKeys = {
  me: ["me"],
} as const;

// The signed in user. Fails with a 401 ApiError when signed out.
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api<MeResponse>("/me"),
    // Signed out is an answer, not a failure to retry.
    retry: (count, err) => !isUnauthorized(err) && count < 2,
  });
}
