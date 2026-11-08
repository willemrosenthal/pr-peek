import { LOOKING_HEADER } from "@pr-peek/core";

// An error answer from the API, `{ error: { code, message } }`.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The request got no answer: offline, or Git Buddy can't be reached. Not an ApiError,
// so queries still retry it.
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(UNREACHABLE, { cause });
    this.name = "NetworkError";
  }
}

export const UNREACHABLE =
  "Can't reach Git Buddy. Check your connection, then try again.";
// Render answers these itself while a deploy starts or the server restarts.
export const RESTARTING = "Git Buddy is restarting. Try again in a minute.";
const RESTART_STATUSES = new Set([502, 503, 504]);
export const UNKNOWN_ERROR = "Something went wrong. Try again.";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  // Lets the request finish after the page closes.
  keepalive?: boolean;
}

// True while someone is using the app. Focus, not visibility: the Mac app's page counts
// as visible while its window is hidden, even before it's first shown.
const isLooking = () => document.hasFocus();

// Calls `/api<path>` and returns the JSON answer. Throws ApiError for error answers.
export async function api<T>(
  path: string,
  { method = "GET", body, keepalive = false }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (isLooking()) headers[LOOKING_HEADER] = "1";
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      keepalive,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch (err) {
    throw new NetworkError(err);
  }
  if (!res.ok) throw await toApiError(res);
  // 204 No Content and 202 with no body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function toApiError(res: Response): Promise<ApiError> {
  const fallback = RESTART_STATUSES.has(res.status)
    ? RESTARTING
    : UNKNOWN_ERROR;
  try {
    const { error } = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    return new ApiError(
      res.status,
      error?.code ?? "unknown",
      error?.message ?? fallback,
    );
  } catch {
    return new ApiError(res.status, "unknown", fallback);
  }
}

export const isUnauthorized = (err: unknown) =>
  err instanceof ApiError && err.status === 401;
