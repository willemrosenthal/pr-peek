import { Navigate, Outlet } from "react-router";
import { isUnauthorized } from "../api";
import { useMe } from "../queries";
import { Button } from "./Button";
import { PageMessage } from "./PageMessage";

// Shows its child routes only when signed in. Otherwise goes to sign in.
export function RequireAuth() {
  const me = useMe();

  if (me.isPending) return <PageMessage title="Loading" />;
  if (me.isError) {
    if (isUnauthorized(me.error)) return <Navigate to="/signin" replace />;
    return (
      <PageMessage title="Can't reach pr-peek">
        <p>{me.error.message}</p>
        <Button onClick={() => void me.refetch()}>Try again</Button>
      </PageMessage>
    );
  }
  return <Outlet />;
}
