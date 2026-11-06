import { describe, expect, it, vi } from "vitest";
import { topQueries } from "./admin";
import type { Db } from "./db";

// $queryRaw is a tagged template: the SQL comes in as its parts.
const sqlOf = (parts: TemplateStringsArray, ...values: unknown[]) =>
  parts.reduce(
    (sql, part, i) =>
      sql +
      part +
      (i < values.length
        ? String((values[i] as { sql?: string }).sql ?? "$")
        : ""),
    "",
  );

describe("topQueries", () => {
  const row = { query: "SELECT 1", calls: 12n, meanMs: 0.5, rows: 12n };

  it("reads the stats from the extensions schema when they aren't on the search path", async () => {
    const queryRaw = vi.fn(
      (parts: TemplateStringsArray, ...values: unknown[]) => {
        const sql = sqlOf(parts, ...values);
        if (!sql.includes("extensions.")) {
          return Promise.reject(new Error("relation does not exist"));
        }
        return Promise.resolve(
          sql.includes("_info")
            ? [{ since: new Date("2026-10-01T00:00:00Z") }]
            : [row],
        );
      },
    );

    expect(await topQueries({ $queryRaw: queryRaw } as unknown as Db)).toEqual({
      since: "2026-10-01T00:00:00.000Z",
      top: [{ query: "SELECT 1", calls: 12, meanMs: 0.5, rows: 12 }],
    });
  });

  it("is null when the stats can't be read anywhere", async () => {
    const queryRaw = vi.fn(() => Promise.reject(new Error("not loaded")));
    expect(
      await topQueries({ $queryRaw: queryRaw } as unknown as Db),
    ).toBeNull();
  });
});
