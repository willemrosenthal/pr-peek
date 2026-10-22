interface GraphQLErrorShape {
  data?: unknown;
  errors?: { type?: string }[];
}

// GitHub answers an unknown or hidden item with a GraphQL error of type NOT_FOUND.
export function isNotFound(err: unknown): boolean {
  const { errors } = err as GraphQLErrorShape;
  return Array.isArray(errors) && errors.some((e) => e.type === "NOT_FOUND");
}

// The data GitHub sent along with NOT_FOUND errors, when the rest of the query worked.
// Octokit throws on any GraphQL error, even when the other results are fine.
export function partialDataOrThrow(err: unknown): unknown {
  const { data, errors } = err as GraphQLErrorShape;
  const allNotFound =
    Array.isArray(errors) && errors.every((e) => e.type === "NOT_FOUND");
  if (allNotFound && data) return data;
  throw err;
}
