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

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

// Calls `/api<path>` and returns the JSON answer. Throws ApiError for error answers.
export async function api<T>(
  path: string,
  { method = "GET", body }: RequestOptions = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!res.ok) throw await toApiError(res);
  // 204 No Content and 202 with no body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function toApiError(res: Response): Promise<ApiError> {
  const fallback = "Something went wrong. Try again.";
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
