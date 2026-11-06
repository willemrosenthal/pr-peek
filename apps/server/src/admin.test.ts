import { describe, expect, it, vi } from "vitest";
import { topQueries } from "./admin";
import type { Db } from "./db";

describe("topQueries", () => {
  const row = { query: "SELECT 1", calls: 12n, meanMs: 0.5, rows: 12n };

  it("reads the stats from the extensions schema when they aren't on the search path", async () => {
    // The first try, on the search path, fails. The ones in "extensions" answer.
    const queryRaw = vi
      .fn()
      .mockRejectedValueOnce(new Error("relation does not exist"))
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ since: new Date("2026-10-01T00:00:00Z") }]);

    expect(await topQueries({ $queryRaw: queryRaw } as unknown as Db)).toEqual({
      since: "2026-10-01T00:00:00.000Z",
      top: [{ query: "SELECT 1", calls: 12, meanMs: 0.5, rows: 12 }],
    });
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });

  it("is null when the stats can't be read anywhere", async () => {
    const queryRaw = vi.fn(() => Promise.reject(new Error("not loaded")));
    expect(
      await topQueries({ $queryRaw: queryRaw } as unknown as Db),
    ).toBeNull();
  });
});
