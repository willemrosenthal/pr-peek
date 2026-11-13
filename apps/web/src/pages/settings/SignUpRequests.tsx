import { formatAge, type SignUpRequestDto } from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../../api";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Card, CardRow } from "../../components/Card";
import { RowText } from "../../components/RowText";
import { Switch } from "../../components/Switch";
import { useNow } from "../../hooks/useNow";
import { queryKeys, useSignUpRequests } from "../../queries";
import styles from "./SignUpRequests.module.css";

// Whether new users wait for an admin, and the people waiting, with Approve and Decline.
// Hidden until the list loads. With approval off, the list shows only while someone still
// waits from before.
export function SignUpRequests() {
  const requests = useSignUpRequests();
  const queryClient = useQueryClient();
  // What the last Approve or Decline did, for a screen reader and a glance.
  const [done, setDone] = useState("");
  const decide = useMutation({
    mutationFn: ({ request, approve }: Decision) =>
      approve
        ? api(`/admin/requests/${request.id}/approve`, { method: "POST" })
        : api(`/admin/requests/${request.id}`, { method: "DELETE" }),
    onSuccess: (_data, { request, approve }) =>
      setDone(
        approve
          ? `Approved ${request.login}. They can come in now.`
          : `Declined ${request.login}.`,
      ),
    // Also after a 404: someone else got to it first.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.signUpRequests }),
  });

  // A 404 means this isn't an admin. The page says so already.
  if (requests.error && !isNotFound(requests.error)) {
    return <Alert>{requests.error.message}</Alert>;
  }
  if (!requests.data) return null;
  const list = requests.data.requests;
  return (
    <>
      <ApprovalSwitch on={requests.data.approveSignUps} />
      {(requests.data.approveSignUps || list.length > 0) && (
        <section className={styles.section} aria-label="Sign-up requests">
          <div className={styles.top}>
            <h3 className={styles.title}>Sign-up requests</h3>
            <span className={styles.hint}>{list.length} waiting</span>
          </div>
          <p className={styles.hint}>
            People here can't see anything yet, and Git Buddy doesn't sync for
            them.
          </p>
          {decide.isError && <Alert>{decide.error.message}</Alert>}
          {list.length > 0 ? (
            <ul className={styles.list}>
              {list.map((request) => (
                <Row
                  key={request.id}
                  request={request}
                  busy={decide.isPending}
                  onDecide={(approve) => decide.mutate({ request, approve })}
                />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No requests waiting.</p>
          )}
          <p className={styles.hint} role="status">
            {done}
          </p>
          <p className={styles.hint}>
            Declining deletes what Git Buddy has on them. They can ask again
            later.
          </p>
        </section>
      )}
    </>
  );
}

// Turns approving new users on or off. Shows the new state while it saves.
function ApprovalSwitch({ on }: { on: boolean }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (next: boolean) =>
      api("/admin/sign-up-approval", { method: "PUT", body: { on: next } }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.signUpRequests }),
  });
  const shown = save.isPending ? save.variables : on;
  const label = "Approve new users";
  return (
    <Card label="Sign-ups">
      <CardRow>
        <RowText
          label={label}
          hint={`${
            shown
              ? "New users wait below until you approve them."
              : "Anyone can sign up and start right away."
          } You get a push for each new user.`}
        />
        <Switch
          label={label}
          checked={shown}
          onChange={(next) => save.mutate(next)}
          disabled={save.isPending}
        />
        {save.isError && <Alert>{save.error.message}</Alert>}
      </CardRow>
    </Card>
  );
}

interface Decision {
  request: SignUpRequestDto;
  approve: boolean;
}

function Row({
  request,
  busy,
  onDecide,
}: {
  request: SignUpRequestDto;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const now = useNow();
  return (
    <li className={styles.row}>
      {request.avatarUrl && (
        <img className={styles.avatar} src={request.avatarUrl} alt="" />
      )}
      <div className={styles.who}>
        <span>
          <strong>{request.login}</strong>
          {request.name && <span className={styles.hint}> {request.name}</span>}
        </span>
        <span className={styles.hint}>
          Asked {formatAge(request.askedAt, now)} ago ·{" "}
          <a
            href={`https://github.com/${encodeURIComponent(request.login)}`}
            target="_blank"
            rel="noreferrer"
          >
            GitHub profile
          </a>
        </span>
      </div>
      <div className={styles.buttons}>
        <Button
          onClick={() => onDecide(false)}
          disabled={busy}
          aria-label={`Decline ${request.login}`}
        >
          Decline
        </Button>
        <Button
          variant="primary"
          onClick={() => onDecide(true)}
          disabled={busy}
          aria-label={`Approve ${request.login}`}
        >
          Approve
        </Button>
      </div>
    </li>
  );
}

const isNotFound = (err: Error) =>
  err instanceof ApiError && err.status === 404;
