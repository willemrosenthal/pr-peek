import type { z } from "zod";

// An error that's safe to show the client. The error handler turns it into JSON.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Checks request input against a schema, or throws a 400 that says what's wrong.
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) =>
        [issue.path.join("."), issue.message].filter(Boolean).join(": "),
      )
      .join("; ");
    throw new HttpError(400, "invalid_input", message);
  }
  return result.data;
}
