interface GraphQLErrorShape {
  data?: unknown;
  errors?: { type?: string }[];
}

// True if `err` is a GraphQL error and every error in it is one of `types`.
export function hasOnlyErrorTypes(err: unknown, types: string[]): boolean {
  const { errors } = err as GraphQLErrorShape;
  return (
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every((e) => e.type !== undefined && types.includes(e.type))
  );
}

// GitHub answers an unknown or hidden item with a GraphQL error of type NOT_FOUND.
export function isNotFound(err: unknown): boolean {
  const { errors } = err as GraphQLErrorShape;
  return Array.isArray(errors) && errors.some((e) => e.type === "NOT_FOUND");
}

// The data GitHub sent along with errors of `types`, when the rest of the query worked.
// Octokit throws on any GraphQL error, even when the other results are fine.
export function partialDataOrThrow(
  err: unknown,
  types: string[] = ["NOT_FOUND"],
): unknown {
  const { data } = err as GraphQLErrorShape;
  if (hasOnlyErrorTypes(err, types) && data) return data;
  throw err;
}
