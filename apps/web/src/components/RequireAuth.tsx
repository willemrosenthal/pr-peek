import { Navigate } from "react-router";
import { isUnauthorized } from "../api";
import { useMe } from "../queries";
import { Button } from "./Button";
import { PageMessage } from "./PageMessage";
import { SignedIn } from "./SignedIn";

// Shows its child routes only when signed in. Otherwise goes to sign in.
export function RequireAuth() {
  const me = useMe();

  if (me.isPending) return <PageMessage title="Loading" />;
  if (isUnauthorized(me.error)) return <Navigate to="/signin" replace />;
  // Keeps the page up when a later check fails for another reason.
  if (me.isError && !me.data) {
    return (
      <PageMessage title="Can't reach Git Buddy">
        <p>{me.error.message}</p>
        <Button onClick={() => void me.refetch()}>Try again</Button>
      </PageMessage>
    );
  }
  return <SignedIn />;
}
