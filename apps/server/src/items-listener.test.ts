import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb, TEST_DATABASE_URL } from "../test/db";
import { publishItemsChanged } from "./items";
import { listenForItemChanges, type ItemsListener } from "./items-listener";
import { createLogger } from "./logger";

const db = createTestDb();
afterAll(() => db.$disconnect());

let listener: ItemsListener;
beforeEach(async () => {
  listener = await listenForItemChanges({
    connectionString: TEST_DATABASE_URL,
    logger: createLogger({ LOG_LEVEL: "silent" }),
    reconnectMs: 10,
  });
});
afterEach(() => listener.stop());

const publish = (userId: string) =>
  db.$transaction((tx) => publishItemsChanged(tx, userId));

it("calls only the changed user's handlers", async () => {
  const mine = vi.fn();
  const theirs = vi.fn();
  listener.subscribe("me", mine);
  listener.subscribe("them", theirs);

  await publish("them");
  await publish("me");
  await vi.waitFor(() => expect(mine).toHaveBeenCalledOnce());
  expect(theirs).toHaveBeenCalledOnce();
});

it("stops calling a handler once unsubscribed", async () => {
  const first = vi.fn();
  const second = vi.fn();
  const unsubscribe = listener.subscribe("me", first);
  listener.subscribe("me", second);

  unsubscribe();
  // A second call does nothing.
  unsubscribe();
  await publish("me");
  await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
  expect(first).not.toHaveBeenCalled();
});

it("reconnects after losing its connection and tells every subscriber", async () => {
  const handler = vi.fn();
  listener.subscribe("me", handler);

  await db.$executeRaw`
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE query = 'LISTEN user_items_changed'`;
  await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

  await publish("me");
  await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
});
