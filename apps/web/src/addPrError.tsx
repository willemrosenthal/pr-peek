import type { ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "./api";

// What the app says when a PR can't be looked up or added by its link: in the dialog,
// or in the toast after a paste or drop.
export function addPrError(err: Error): ReactNode {
  if (!(err instanceof ApiError)) return err.message;
  if (err.code === "not_found") {
    return (
      <>
        Your GitHub token can't see this PR. Check its repo access in{" "}
        <Link to="/settings/account">Settings</Link>.
      </>
    );
  }
  return err.message;
}
