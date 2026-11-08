import { Navigate } from "react-router";
import { isUnauthorized } from "../api";
import { useMe } from "../queries";
import { Button } from "./Button";
import { PageMessage } from "./PageMessage";
import { SignedIn } from "./SignedIn";
import { SignUpPending } from "./SignUpPending";

// Shows its child routes only when signed in and approved. Otherwise goes to sign in,
// or shows the waiting screen.
export function RequireAuth() {
  const me = useMe();

  if (me.isPending) return <PageMessage title="Loading" />;
  if (isUnauthorized(me.error)) return <Navigate to="/signin" replace />;
  // Keeps the page up when a later check fails for another reason.
  if (me.isError && !me.data) {
    return (
      <PageMessage title="Couldn't load Git Buddy">
        <p>{me.error.message}</p>
        <Button onClick={() => void me.refetch()}>Try again</Button>
      </PageMessage>
    );
  }
  // Waiting for an admin: the only page they can use.
  if (me.data.pending) {
    return (
      <SignUpPending
        user={me.data.user}
        checking={me.isFetching}
        onCheck={() => void me.refetch()}
      />
    );
  }
  return <SignedIn />;
}
