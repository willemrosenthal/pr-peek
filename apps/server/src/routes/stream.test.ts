import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ITEMS_CHANGED_EVENT,
  NOTIFY_EVENT,
  type SummaryResponse,
} from "@pr-peek/core";
import session from "express-session";
import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { APP_URL, makeTestApp, signIn } from "../../test/app";
import { createTestDb, resetDb, TEST_DATABASE_URL } from "../../test/db";
import { NOW } from "../../test/fakes";
import { itemRows } from "../../test/items";
import { publishItemsChanged } from "../items";
import { listenForItemChanges, type ItemsListener } from "../items-listener";
import { createLogger } from "../logger";
import { DESKTOP_CHANNEL } from "../push";
import { streamRouter } from "./stream";

const db = createTestDb();
afterAll(() => db.$disconnect());
const { makePr, makeItem } = itemRows(db);

let listener: ItemsListener;
let server: Server | undefined;
let shutdown: AbortController;
// Streams still subscribed to the listener.
let listening = 0;

beforeEach(async () => {
  await resetDb(db);
  shutdown = new AbortController();
  listening = 0;
  listener = await listenForItemChanges({
    connectionString: TEST_DATABASE_URL,
    logger: createLogger({ LOG_LEVEL: "silent" }),
  });
});
afterEach(async () => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
  await listener.stop();
});

interface StreamTimes {
  keepAliveMs?: number;
  sessionCheckMs?: number;
}

function makeApp(times: StreamTimes = {}) {
  return makeTestApp(db, {
    routers: [
      streamRouter({
        db,
        listener: {
          subscribe(userId, handler) {
            listening++;
            const unsubscribe = listener.subscribe(userId, handler);
            return () => {
              listening--;
              unsubscribe();
            };
          },
        },
        signal: shutdown.signal,
        ...times,
        now: () => NOW,
      }),
    ],
  });
}

// Signs in and opens the stream on a real port, since supertest can't read a stream
// that never ends.
async function openStream(times: StreamTimes = {}) {
  const { app, agent } = makeApp(times);
  const signedIn = await signIn(agent);
  const cookie = (signedIn.headers["set-cookie"] as unknown as string[])
    .map((header) => header.split(";")[0])
    .join("; ");
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;

  const client = new AbortController();
  const res = await fetch(`http://localhost:${port}/api/stream`, {
    headers: { cookie },
    signal: client.signal,
  });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";

  // Reads the next event or comment. Each ends with a blank line.
  async function next(): Promise<string> {
    while (!text.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("The stream ended");
      text += value;
    }
    const end = text.indexOf("\n\n") + 2;
    const message = text.slice(0, end);
    text = text.slice(end);
    return message;
  }

  const user = await db.user.findFirstOrThrow();
  return {
    headers: res.headers,
    next,
    user,
    agent,
    leave: () => client.abort(),
  };
}

const publish = (userId: string) =>
  db.$transaction((tx) => publishItemsChanged(tx, userId));

const itemsChanged = (summary: Partial<SummaryResponse>) =>
  `event: ${ITEMS_CHANGED_EVENT}\ndata: ${JSON.stringify({
    total: 0,
    review: 0,
    replies: 0,
    assigned: 0,
    mine: 0,
    hasStale: false,
    hasFailing: false,
    ...summary,
  })}\n\n`;

it("needs sign in", async () => {
  const res = await makeApp().agent.get("/api/stream");
  expect(res.status).toBe(401);
});

it("sends the new summary to the right user only", async () => {
  const stream = await openStream();
  const other = await db.user.create({
    data: { githubId: 43, login: "other" },
  });
  expect(stream.headers.get("content-type")).toMatch(/^text\/event-stream/);
  expect(stream.headers.get("cache-control")).toBe("no-cache");

  // If the other user's change leaked, the second message would still say 0.
  await publish(other.id);
  await publish(stream.user.id);
  expect(await stream.next()).toBe(itemsChanged({}));

  const pr = await makePr(stream.user.id);
  await makeItem(stream.user.id, pr.id, "reply");
  await publish(stream.user.id);
  expect(await stream.next()).toBe(itemsChanged({ total: 1, replies: 1 }));
});

it("passes notifications on for the Mac menu bar app", async () => {
  const stream = await openStream();
  const payload = {
    title: "jlee asked for your review",
    body: "b",
    url: "/",
    tag: "i",
  };
  const message = JSON.stringify({ userId: stream.user.id, payload });
  await db.$executeRaw`SELECT pg_notify(${DESKTOP_CHANNEL}, ${message})`;
  expect(await stream.next()).toBe(
    `event: ${NOTIFY_EVENT}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
});

it("sends a keep-alive comment while quiet", async () => {
  const stream = await openStream({ keepAliveMs: 10 });
  expect(await stream.next()).toBe(": ping\n\n");
});

it("keeps the stream open while the session is signed in", async () => {
  const stream = await openStream({ keepAliveMs: 30, sessionCheckMs: 10 });
  // Several session checks pass before each ping.
  expect(await stream.next()).toBe(": ping\n\n");
  expect(await stream.next()).toBe(": ping\n\n");
  expect(listening).toBe(1);
});

it("ends the stream once its session signs out", async () => {
  const stream = await openStream({ sessionCheckMs: 10 });
  const res = await stream.agent
    .post("/api/auth/signout")
    .set("Origin", APP_URL);
  expect(res.status).toBe(200);
  await expect(stream.next()).rejects.toThrow("The stream ended");
  await vi.waitFor(() => expect(listening).toBe(0));
});

it("keeps the stream open when the session store can't be read", async () => {
  const stream = await openStream({ keepAliveMs: 30, sessionCheckMs: 10 });
  // The test app keeps sessions in express-session's memory store.
  const get = vi
    .spyOn(session.MemoryStore.prototype, "get")
    .mockImplementation((_sid, callback) =>
      callback(new Error("database down")),
    );
  onTestFinished(() => get.mockRestore());
  expect(await stream.next()).toBe(": ping\n\n");
  expect(await stream.next()).toBe(": ping\n\n");
  expect(get).toHaveBeenCalled();
  expect(listening).toBe(1);
});

it("stops listening when the client leaves", async () => {
  const stream = await openStream();
  expect(listening).toBe(1);
  stream.leave();
  await vi.waitFor(() => expect(listening).toBe(0));
});

it("ends open streams on shutdown", async () => {
  const stream = await openStream();
  shutdown.abort();
  await expect(stream.next()).rejects.toThrow("The stream ended");
  await vi.waitFor(() => expect(listening).toBe(0));
});

it("ends a stream that opens after shutdown started", async () => {
  shutdown.abort();
  const stream = await openStream();
  await expect(stream.next()).rejects.toThrow("The stream ended");
  await vi.waitFor(() => expect(listening).toBe(0));
});
